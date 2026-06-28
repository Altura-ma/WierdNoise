/* =========================================================
   analysis.js — spectrum averaging, RPM estimation, comparison
   Pure functions over byte-spectrum arrays. No I/O.
   ========================================================= */
(function (global) {
  'use strict';

  /**
   * Accumulates spectra to build a reference average over a recording window.
   */
  function SpectrumAccumulator(binCount) {
    this.binCount = binCount;
    this.sum = new Float32Array(binCount);
    this.frames = 0;
  }
  SpectrumAccumulator.prototype.add = function (spectrum) {
    if (!spectrum) return;
    var n = Math.min(this.binCount, spectrum.length);
    for (var i = 0; i < n; i++) this.sum[i] += spectrum[i];
    this.frames++;
  };
  SpectrumAccumulator.prototype.average = function () {
    var out = new Array(this.binCount);
    var f = this.frames || 1;
    for (var i = 0; i < this.binCount; i++) out[i] = this.sum[i] / f;
    return out;
  };

  /**
   * Find the dominant fundamental frequency in a spectrum slice.
   * @returns {{bin:number, value:number}|null}
   */
  function dominantBin(spectrum) {
    var best = -1, bestVal = 0;
    for (var i = 0; i < spectrum.length; i++) {
      if (spectrum[i] > bestVal) { bestVal = spectrum[i]; best = i; }
    }
    if (best < 0 || bestVal < 12) return null; // too quiet → no reliable peak
    return { bin: best, value: bestVal };
  }

  /**
   * Estimate engine RPM from a firing/fundamental frequency.
   * 4-stroke: firing frequency (Hz) = RPM/60 * cylinders/2
   *   => RPM = hz * 120 / cylinders
   * @returns {number|null} rounded RPM (to nearest 50)
   */
  function estimateRpm(hz, cylinders) {
    if (!hz || !cylinders) return null;
    var rpm = (hz * 120) / cylinders;
    if (rpm < 300 || rpm > 6000) return null; // outside a plausible idle/rev range
    return Math.round(rpm / 50) * 50;
  }

  /**
   * Compare a live spectrum against the stored reference.
   *
   * @param {number[]} live      current averaged byte-spectrum (band slice)
   * @param {number[]} reference stored reference byte-spectrum (band slice)
   * @param {number}   tolerance 0..100 (higher = more permissive)
   * @returns {{score:number, level:string, anomalies:Array}}
   *   score: 0..100 overall deviation
   *   level: 'ok' | 'warn' | 'alert'
   *   anomalies: [{ binIndex, ratio, excess }]
   */
  function compare(live, reference, tolerance) {
    var n = Math.min(live.length, reference.length);
    if (n === 0) return { score: 0, level: 'ok', anomalies: [] };

    // tolerance (5..60 from UI) → per-bin excess threshold in byte units.
    // Lower tolerance ⇒ smaller threshold ⇒ more sensitive.
    var threshold = 18 + tolerance * 1.2;

    var anomalies = [];
    var weightedExcess = 0;
    var refEnergy = 0;

    for (var i = 0; i < n; i++) {
      var r = reference[i];
      var l = live[i];
      refEnergy += r;

      // Only flag NEW or LOUDER content (clicks, whistles, new harmonics).
      var excess = l - r;
      if (excess > threshold) {
        weightedExcess += (excess - threshold);
        anomalies.push({
          binIndex: i,
          excess: excess,
          ratio: r > 4 ? l / r : (l / 4)
        });
      }
    }

    // Normalise the overall deviation score to 0..100.
    var denom = Math.max(40, refEnergy * 0.12);
    var score = Math.min(100, Math.round((weightedExcess / denom) * 100));

    // Keep only the most significant anomalies.
    anomalies.sort(function (a, b) { return b.excess - a.excess; });
    anomalies = anomalies.slice(0, 8);

    var level = score < 18 ? 'ok' : (score < 45 ? 'warn' : 'alert');
    return { score: score, level: level, anomalies: anomalies };
  }

  /** Merge adjacent anomaly bins into frequency clusters for readable output.
   *  @param {Array} anomalies  from compare()
   *  @param {function(number):number} binToHz  maps band bin index → Hz
   *  @returns {Array<{hz:number, ratio:number}>}
   */
  function clusterAnomalies(anomalies, binToHz) {
    if (!anomalies.length) return [];
    var byBin = anomalies.slice().sort(function (a, b) { return a.binIndex - b.binIndex; });
    var clusters = [];
    var cur = null;
    for (var i = 0; i < byBin.length; i++) {
      var a = byBin[i];
      if (cur && a.binIndex - cur.lastBin <= 2) {
        cur.lastBin = a.binIndex;
        if (a.excess > cur.peakExcess) { cur.peakExcess = a.excess; cur.peakBin = a.binIndex; cur.ratio = a.ratio; }
      } else {
        if (cur) clusters.push(cur);
        cur = { peakBin: a.binIndex, lastBin: a.binIndex, peakExcess: a.excess, ratio: a.ratio };
      }
    }
    if (cur) clusters.push(cur);
    return clusters.map(function (c) {
      return { hz: binToHz(c.peakBin), ratio: c.ratio, excess: c.peakExcess };
    }).sort(function (a, b) { return b.excess - a.excess; });
  }

  global.EMAnalysis = {
    SpectrumAccumulator: SpectrumAccumulator,
    dominantBin: dominantBin,
    estimateRpm: estimateRpm,
    compare: compare,
    clusterAnomalies: clusterAnomalies
  };
})(window);
