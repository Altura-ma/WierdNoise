/* =========================================================
   audio.js — Web Audio engine (mic capture + FFT)
   100% local. Uses getUserMedia + AnalyserNode.
   No audio leaves the device; nothing is recorded to disk.
   ========================================================= */
(function (global) {
  'use strict';

  // Engine band of interest for an idling engine: 20 Hz – 2000 Hz.
  var MIN_HZ = 20;
  var MAX_HZ = 2000;
  var FFT_SIZE = 4096; // good frequency resolution (~10–12 Hz/bin)

  function AudioEngine() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.filterHP = null;
    this.filterLP = null;
    this.freqData = null;     // Uint8Array, full spectrum
    this.running = false;
    this.minBin = 0;
    this.maxBin = 0;
    this.binHz = 0;           // Hz per bin
  }

  /**
   * Request mic permission and start the audio graph.
   * Must be called from a user gesture (button tap).
   * @returns {Promise<void>}
   */
  AudioEngine.prototype.start = function () {
    var self = this;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(makeErr('unsupported',
        "Le microphone n'est pas accessible sur cet appareil ou ce navigateur."));
    }

    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    }).then(function (stream) {
      self.stream = stream;

      var Ctx = global.AudioContext || global.webkitAudioContext;
      self.ctx = new Ctx();

      // iOS may start the context suspended until resumed in a gesture.
      if (self.ctx.state === 'suspended' && self.ctx.resume) {
        self.ctx.resume();
      }

      self.source = self.ctx.createMediaStreamSource(stream);

      // --- Band-pass the obvious noise out (keep engine band) ---
      self.filterHP = self.ctx.createBiquadFilter();
      self.filterHP.type = 'highpass';
      self.filterHP.frequency.value = MIN_HZ;

      self.filterLP = self.ctx.createBiquadFilter();
      self.filterLP.type = 'lowpass';
      self.filterLP.frequency.value = MAX_HZ;

      // --- Analyser / FFT ---
      self.analyser = self.ctx.createAnalyser();
      self.analyser.fftSize = FFT_SIZE;
      self.analyser.smoothingTimeConstant = 0.7;
      self.analyser.minDecibels = -95;
      self.analyser.maxDecibels = -20;

      self.source.connect(self.filterHP);
      self.filterHP.connect(self.filterLP);
      self.filterLP.connect(self.analyser);
      // Note: analyser is NOT connected to destination → no audio playback / feedback.

      self.freqData = new Uint8Array(self.analyser.frequencyBinCount);
      self.binHz = self.ctx.sampleRate / self.analyser.fftSize;
      self.minBin = Math.max(1, Math.floor(MIN_HZ / self.binHz));
      self.maxBin = Math.min(self.analyser.frequencyBinCount - 1, Math.ceil(MAX_HZ / self.binHz));
      self.running = true;
    }).catch(function (err) {
      // Normalise permission errors into something the UI can show.
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError' ||
                  err.name === 'PermissionDeniedError')) {
        throw makeErr('denied',
          "Accès au micro refusé. Autorisez le microphone dans les réglages de votre " +
          "appareil pour permettre l'analyse du moteur.");
      }
      if (err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
        throw makeErr('nodevice', "Aucun microphone détecté sur cet appareil.");
      }
      if (err && err.__em) throw err;
      throw makeErr('unknown',
        "Impossible de démarrer l'écoute. " + (err && err.message ? err.message : ''));
    });
  };

  /** Capture the current frequency spectrum into the band of interest.
   *  @returns {Uint8Array} slice [minBin..maxBin] of byte magnitudes (0–255) */
  AudioEngine.prototype.getSpectrum = function () {
    if (!this.running || !this.analyser) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData.subarray(this.minBin, this.maxBin + 1);
  };

  /** Convert a band-relative bin index to its centre frequency in Hz. */
  AudioEngine.prototype.binToHz = function (relIndex) {
    return Math.round((this.minBin + relIndex) * this.binHz);
  };

  AudioEngine.prototype.getMeta = function () {
    return {
      sampleRate: this.ctx ? this.ctx.sampleRate : 0,
      fftSize: FFT_SIZE,
      binHz: this.binHz,
      minBin: this.minBin,
      maxBin: this.maxBin,
      binCount: this.maxBin - this.minBin + 1,
      minHz: MIN_HZ,
      maxHz: MAX_HZ
    };
  };

  /** Stop the mic and tear down the audio graph cleanly. */
  AudioEngine.prototype.stop = function () {
    this.running = false;
    try { if (this.source) this.source.disconnect(); } catch (e) {}
    try { if (this.filterHP) this.filterHP.disconnect(); } catch (e) {}
    try { if (this.filterLP) this.filterLP.disconnect(); } catch (e) {}
    try { if (this.analyser) this.analyser.disconnect(); } catch (e) {}
    if (this.stream) {
      this.stream.getTracks().forEach(function (t) { t.stop(); });
    }
    if (this.ctx && this.ctx.state !== 'closed' && this.ctx.close) {
      try { this.ctx.close(); } catch (e) {}
    }
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.ctx = null;
  };

  function makeErr(code, message) {
    var e = new Error(message);
    e.code = code;
    e.__em = true;
    return e;
  }

  global.AudioEngine = AudioEngine;
})(window);
