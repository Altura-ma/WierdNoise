/* =========================================================
   visualizer.js — canvas spectrum/oscilloscope rendering
   Draws live FFT bars, optional reference overlay, and grid.
   ========================================================= */
(function (global) {
  'use strict';

  function Visualizer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = global.devicePixelRatio || 1;
    this.w = 0;
    this.h = 0;
    this._resize();
  }

  Visualizer.prototype._resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, rect.width);
    var h = Math.max(1, rect.height);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.w = w;
    this.h = h;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  Visualizer.prototype._grid = function () {
    var ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#03060a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(20,32,44,0.9)';
    ctx.lineWidth = 1;
    var rows = 4, cols = 8, i;
    for (i = 1; i < rows; i++) {
      var y = (h / rows) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (i = 1; i < cols; i++) {
      var x = (w / cols) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
  };

  /**
   * Render a spectrum frame.
   * @param {Uint8Array|number[]} spectrum   live band spectrum (0..255)
   * @param {object} opts
   *   - reference: number[]   optional reference spectrum to overlay
   *   - color: string         live bar colour
   *   - anomalies: Set<number> bin indices to highlight in red
   */
  Visualizer.prototype.render = function (spectrum, opts) {
    opts = opts || {};
    var ctx = this.ctx, w = this.w, h = this.h;
    this._grid();
    if (!spectrum || !spectrum.length) return;

    var n = spectrum.length;
    var barW = w / n;
    var color = opts.color || '#00e0a4';
    var ref = opts.reference;
    var anomalies = opts.anomalies;
    var pad = 6;
    var usableH = h - pad;

    // --- Reference overlay (filled translucent area) ---
    if (ref && ref.length) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (var r = 0; r < n && r < ref.length; r++) {
        var ry = h - (ref[r] / 255) * usableH;
        ctx.lineTo(r * barW + barW / 2, ry);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(25,194,255,0.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(25,194,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var s = 0; s < n && s < ref.length; s++) {
        var sy = h - (ref[s] / 255) * usableH;
        if (s === 0) ctx.moveTo(0, sy); else ctx.lineTo(s * barW + barW / 2, sy);
      }
      ctx.stroke();
    }

    // --- Live bars ---
    for (var i = 0; i < n; i++) {
      var mag = spectrum[i] / 255;
      var barH = mag * usableH;
      var x = i * barW;
      var isAnom = anomalies && anomalies.has && anomalies.has(i);
      if (isAnom) {
        ctx.fillStyle = '#ff4d5e';
      } else {
        var grad = ctx.createLinearGradient(0, h, 0, h - barH);
        grad.addColorStop(0, color);
        grad.addColorStop(1, mag > 0.7 ? '#ffffff' : color);
        ctx.fillStyle = grad;
      }
      ctx.fillRect(x + 0.5, h - barH, Math.max(0.7, barW - 0.7), barH);
    }

    // --- Peak glow line on top ---
    ctx.shadowBlur = 0;
  };

  Visualizer.prototype.clear = function () {
    this._grid();
  };

  Visualizer.prototype.resize = function () { this._resize(); };

  global.Visualizer = Visualizer;
})(window);
