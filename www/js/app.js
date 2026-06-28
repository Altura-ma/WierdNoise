/* =========================================================
   app.js — screen routing + UI controller
   Wires storage, audio engine, analysis and visualizer together.
   ========================================================= */
(function () {
  'use strict';

  var MIN_RECORD_SECONDS = 12; // reference must be at least this long

  // ---- DOM helpers ----
  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

  // ---- App state ----
  var state = {
    screen: 'home',
    currentProfileId: null,
    engine: null,
    viz: null,
    rafId: null,
    mode: null,            // 'record' | 'diagnose'
    accumulator: null,
    recordStart: 0,
    recordTimer: null,
    lastDiagnostic: null,
    diagSmoothScore: 0
  };

  // ====================================================
  // Navigation
  // ====================================================
  var SCREENS = ['home', 'profile', 'record', 'diagnose'];
  var TITLES = { home: 'Écoute Moteur', profile: 'Véhicule', record: 'Référence', diagnose: 'Diagnostic' };

  function navigate(screen, profileId) {
    // Always tear down audio when leaving an audio screen.
    stopAudio();
    if (profileId !== undefined) state.currentProfileId = profileId;
    state.screen = screen;

    SCREENS.forEach(function (s) {
      var el = $('screen-' + s);
      if (el) el.hidden = (s !== screen);
    });

    $('header-title').textContent = TITLES[screen] || 'Écoute Moteur';
    if (screen === 'home') hide($('btn-back')); else show($('btn-back'));

    if (screen === 'home') renderHome();
    else if (screen === 'profile') renderProfile();
    else if (screen === 'record') initRecordScreen();
    else if (screen === 'diagnose') initDiagnoseScreen();
  }

  function goBack() {
    if (state.screen === 'profile') navigate('home');
    else if (state.screen === 'record' || state.screen === 'diagnose') navigate('profile');
    else navigate('home');
  }

  // ====================================================
  // HOME screen
  // ====================================================
  function renderHome() {
    var list = $('profile-list');
    clear(list);
    var profiles = EMStorage.getProfiles();

    if (!profiles.length) {
      show($('empty-profiles'));
    } else {
      hide($('empty-profiles'));
    }

    profiles.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'profile-card';

      var main = document.createElement('div');
      main.className = 'pc-main';
      var name = document.createElement('span');
      name.className = 'pc-name';
      name.textContent = p.name;
      var meta = document.createElement('span');
      meta.className = 'pc-meta';
      var count = (p.history || []).length;
      meta.textContent = p.cylinders + ' cyl · ' + count + ' écoute' + (count > 1 ? 's' : '');
      main.appendChild(name);
      main.appendChild(meta);

      var badge = document.createElement('span');
      if (p.reference) {
        badge.className = 'pc-badge ok';
        badge.textContent = 'Réf. ✓';
      } else {
        badge.className = 'pc-badge none';
        badge.textContent = 'Sans réf.';
      }

      li.appendChild(main);
      li.appendChild(badge);
      on(li, 'click', function () { navigate('profile', p.id); });
      list.appendChild(li);
    });
  }

  // ====================================================
  // PROFILE detail screen
  // ====================================================
  function renderProfile() {
    var p = EMStorage.getProfile(state.currentProfileId);
    if (!p) { navigate('home'); return; }
    $('header-title').textContent = p.name;

    var summary = $('profile-summary');
    clear(summary);
    var h = document.createElement('h2');
    h.textContent = p.name;
    summary.appendChild(h);

    var row = document.createElement('div');
    row.className = 'ps-row';
    row.appendChild(stat('Cylindres', p.cylinders));
    if (p.reference) {
      row.appendChild(stat('Ralenti réf.', p.reference.idleHz ? p.reference.idleHz + ' Hz' : '—'));
      var rpm = EMAnalysis.estimateRpm(p.reference.idleHz, p.cylinders);
      row.appendChild(stat('RPM estimé', rpm ? '~' + rpm : '—'));
    } else {
      row.appendChild(stat('Référence', 'Aucune'));
    }
    summary.appendChild(row);

    // Diagnose button only enabled once a reference exists.
    $('btn-diagnose').disabled = !p.reference;

    // Tolerance slider
    var slider = $('tolerance-slider');
    slider.value = p.tolerance || 25;
    updateToleranceLabel(slider.value);

    renderHistory(p);
  }

  function stat(label, value) {
    var d = document.createElement('div');
    d.className = 'ps-stat';
    var b = document.createElement('b');
    b.textContent = value;
    d.appendChild(b);
    d.appendChild(document.createTextNode(label));
    return d;
  }

  function updateToleranceLabel(v) {
    var label = $('tolerance-label');
    var n = Number(v);
    var word = n < 20 ? 'haute sensibilité' : (n < 40 ? 'équilibré' : 'permissif');
    label.textContent = word + ' (' + n + ')';
  }

  function renderHistory(p) {
    var list = $('history-list');
    clear(list);
    var hist = p.history || [];
    if (!hist.length) { show($('empty-history')); return; }
    hide($('empty-history'));

    hist.forEach(function (e) {
      var li = document.createElement('li');
      li.className = 'history-item';

      var left = document.createElement('div');
      var date = document.createElement('div');
      date.className = 'hi-date';
      date.textContent = formatDate(e.at);
      var sub = document.createElement('div');
      sub.className = 'hi-date';
      sub.textContent = (e.dominantHz ? e.dominantHz + ' Hz · ' : '') +
        (e.anomalies && e.anomalies.length ? e.anomalies.length + ' anomalie(s)' : 'spectre conforme');
      left.appendChild(date);
      left.appendChild(sub);

      var res = document.createElement('span');
      res.className = 'hi-result ' + e.level;
      res.textContent = e.level === 'ok' ? 'Normal' : (e.level === 'warn' ? 'Écart léger' : 'Anomalie');

      li.appendChild(left);
      li.appendChild(res);
      list.appendChild(li);
    });
  }

  // ====================================================
  // Audio lifecycle (shared)
  // ====================================================
  function startAudio(canvas, onError) {
    state.engine = new AudioEngine();
    state.viz = new Visualizer(canvas);
    return state.engine.start().then(function () {
      return true;
    }).catch(function (err) {
      state.engine = null;
      if (onError) onError(err);
      return false;
    });
  }

  function stopAudio() {
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
    if (state.recordTimer) { clearInterval(state.recordTimer); state.recordTimer = null; }
    if (state.engine) { state.engine.stop(); state.engine = null; }
    state.accumulator = null;
    state.mode = null;
  }

  // ====================================================
  // RECORD reference screen
  // ====================================================
  function initRecordScreen() {
    var p = EMStorage.getProfile(state.currentProfileId);
    if (!p) { navigate('home'); return; }
    $('header-title').textContent = 'Référence · ' + p.name;

    $('btn-record-start').disabled = false;
    $('btn-record-start').textContent = "Démarrer l'écoute";
    $('btn-record-validate').disabled = true;
    $('record-timer').textContent = '00:00';
    $('record-freq').textContent = '— Hz';
    $('record-hint').textContent =
      'Posez le téléphone près du moteur tournant au ralenti, puis démarrez.';
    hide($('record-error'));
    $('rec-dot').classList.remove('live');

    var viz = new Visualizer($('record-canvas'));
    viz.clear();
  }

  function startRecording() {
    hide($('record-error'));
    var btn = $('btn-record-start');
    btn.disabled = true;
    btn.textContent = 'Initialisation…';

    startAudio($('record-canvas'), function (err) {
      showError('record-error', err.message);
      btn.disabled = false;
      btn.textContent = "Démarrer l'écoute";
    }).then(function (ok) {
      if (!ok) return;
      var meta = state.engine.getMeta();
      state.accumulator = new EMAnalysis.SpectrumAccumulator(meta.binCount);
      state.recordStart = Date.now();
      state.mode = 'record';
      btn.textContent = 'Écoute en cours…';
      $('rec-dot').classList.add('live');
      $('record-hint').textContent =
        'Laissez tourner au ralenti. Minimum ' + MIN_RECORD_SECONDS + ' s pour valider.';

      state.recordTimer = setInterval(updateRecordTimer, 250);
      loopRecord();
    });
  }

  function updateRecordTimer() {
    var elapsed = (Date.now() - state.recordStart) / 1000;
    $('record-timer').textContent = fmtClock(elapsed);
    if (elapsed >= MIN_RECORD_SECONDS) {
      $('btn-record-validate').disabled = false;
    }
  }

  function loopRecord() {
    if (state.mode !== 'record' || !state.engine) return;
    var spectrum = state.engine.getSpectrum();
    if (spectrum) {
      state.accumulator.add(spectrum);
      var dom = EMAnalysis.dominantBin(spectrum);
      if (dom) $('record-freq').textContent = state.engine.binToHz(dom.bin) + ' Hz';
      state.viz.render(spectrum, { color: '#19c2ff' });
    }
    state.rafId = requestAnimationFrame(loopRecord);
  }

  function validateReference() {
    if (!state.engine || !state.accumulator) return;
    var meta = state.engine.getMeta();
    var avg = state.accumulator.average();
    var roundedAvg = avg.map(function (v) { return Math.round(v); });

    var dom = EMAnalysis.dominantBin(roundedAvg);
    var idleHz = dom ? state.engine.binToHz(dom.bin) : null;

    var reference = {
      spectrum: roundedAvg,
      sampleRate: meta.sampleRate,
      fftSize: meta.fftSize,
      binCount: meta.binCount,
      binHz: meta.binHz,
      minBin: meta.minBin,
      idleHz: idleHz,
      frames: state.accumulator.frames,
      recordedAt: Date.now()
    };
    EMStorage.setReference(state.currentProfileId, reference);
    stopAudio();
    navigate('profile');
  }

  // ====================================================
  // DIAGNOSE screen
  // ====================================================
  function initDiagnoseScreen() {
    var p = EMStorage.getProfile(state.currentProfileId);
    if (!p) { navigate('home'); return; }
    if (!p.reference) { navigate('profile'); return; }
    $('header-title').textContent = 'Diagnostic · ' + p.name;

    $('btn-diagnose-start').disabled = false;
    $('btn-diagnose-start').textContent = "Démarrer l'écoute";
    $('btn-diagnose-save').disabled = true;
    $('diagnose-freq').textContent = '— Hz';
    hide($('diagnose-error'));
    setStatus('idle', 'En attente…');
    setGauge(0);
    clear($('anomaly-list'));
    show($('no-anomaly'));
    state.lastDiagnostic = null;
    state.diagSmoothScore = 0;

    var viz = new Visualizer($('diagnose-canvas'));
    viz.render(p.reference.spectrum, { reference: p.reference.spectrum, color: '#19c2ff' });
  }

  function startDiagnose() {
    hide($('diagnose-error'));
    var p = EMStorage.getProfile(state.currentProfileId);
    var btn = $('btn-diagnose-start');
    btn.disabled = true;
    btn.textContent = 'Initialisation…';

    startAudio($('diagnose-canvas'), function (err) {
      showError('diagnose-error', err.message);
      btn.disabled = false;
      btn.textContent = "Démarrer l'écoute";
    }).then(function (ok) {
      if (!ok) return;
      state.mode = 'diagnose';
      btn.textContent = 'Écoute en cours…';
      $('btn-diagnose-save').disabled = false;
      // Live-averaging accumulator gives a stable comparison window (~1s).
      state.diagWindow = new EMAnalysis.SpectrumAccumulator(p.reference.binCount);
      state.diagWindowStart = Date.now();
      loopDiagnose(p);
    });
  }

  function loopDiagnose(p) {
    if (state.mode !== 'diagnose' || !state.engine) return;
    var spectrum = state.engine.getSpectrum();
    if (spectrum) {
      state.diagWindow.add(spectrum);

      var dom = EMAnalysis.dominantBin(spectrum);
      var domHz = dom ? state.engine.binToHz(dom.bin) : null;
      if (domHz) $('diagnose-freq').textContent = domHz + ' Hz';

      // Recompute the comparison roughly every ~700ms on the averaged window.
      var now = Date.now();
      if (now - state.diagWindowStart >= 700 && state.diagWindow.frames > 4) {
        var liveAvg = state.diagWindow.average();
        var result = EMAnalysis.compare(liveAvg, p.reference.spectrum, p.tolerance || 25);
        var clusters = EMAnalysis.clusterAnomalies(result.anomalies, function (b) {
          return state.engine.binToHz(b);
        });

        // Smooth the gauge so it doesn't flicker.
        state.diagSmoothScore = Math.round(state.diagSmoothScore * 0.5 + result.score * 0.5);
        applyDiagnostic(result.level, state.diagSmoothScore, clusters, domHz);

        state.lastDiagnostic = {
          level: result.level,
          score: state.diagSmoothScore,
          dominantHz: domHz,
          clusters: clusters
        };

        state.diagWindow = new EMAnalysis.SpectrumAccumulator(p.reference.binCount);
        state.diagWindowStart = now;
      }

      var anomSet = buildAnomalySet(spectrum, p.reference.spectrum, p.tolerance || 25);
      state.viz.render(spectrum, {
        reference: p.reference.spectrum,
        color: '#00e0a4',
        anomalies: anomSet
      });
    }
    state.rafId = requestAnimationFrame(function () { loopDiagnose(p); });
  }

  // Lightweight per-frame anomaly highlight for the visualizer (red bars).
  function buildAnomalySet(live, ref, tolerance) {
    var set = new Set();
    var threshold = 18 + tolerance * 1.2;
    var n = Math.min(live.length, ref.length);
    for (var i = 0; i < n; i++) {
      if (live[i] - ref[i] > threshold) set.add(i);
    }
    return set;
  }

  function applyDiagnostic(level, score, clusters, domHz) {
    if (level === 'ok') setStatus('ok', 'Normal — spectre conforme');
    else if (level === 'warn') setStatus('warn', 'Écart léger détecté');
    else setStatus('alert', 'Anomalie importante détectée');

    setGauge(score);
    renderAnomalies(clusters);
  }

  function setStatus(level, text) {
    var ind = $('status-indicator');
    ind.className = 'status-indicator status-' + level;
    $('status-text').textContent = text;
  }

  function setGauge(score) {
    var fill = $('gauge-fill');
    fill.style.width = Math.min(100, score) + '%';
    var color = score < 18 ? '#00e0a4' : (score < 45 ? '#ffce3a' : '#ff4d5e');
    fill.style.background = color;
    $('gauge-value').textContent = score + '%';
  }

  function renderAnomalies(clusters) {
    var list = $('anomaly-list');
    clear(list);
    if (!clusters || !clusters.length) { show($('no-anomaly')); return; }
    hide($('no-anomaly'));
    clusters.forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'anomaly-item' + (c.excess > 60 ? ' high' : '');
      var txt = document.createElement('span');
      var ratioTxt = c.ratio && isFinite(c.ratio) ? ' (×' + c.ratio.toFixed(1) + ')' : '';
      txt.innerHTML = 'Fréquence inhabituelle autour de <span class="ai-freq">' +
        c.hz + ' Hz</span>' + ratioTxt;
      li.appendChild(txt);
      list.appendChild(li);
    });
  }

  function saveDiagnostic() {
    var d = state.lastDiagnostic;
    if (!d) return;
    var entry = {
      at: Date.now(),
      level: d.level,
      score: d.score,
      dominantHz: d.dominantHz,
      anomalies: (d.clusters || []).map(function (c) {
        return { hz: c.hz, ratio: c.ratio };
      })
    };
    EMStorage.addHistory(state.currentProfileId, entry);
    stopAudio();
    navigate('profile');
  }

  // ====================================================
  // Modals
  // ====================================================
  function openModal(id) { show($(id)); }
  function closeModal(id) { hide($(id)); }

  function openNewProfile() {
    $('input-profile-name').value = '';
    $('input-cylinders').value = '4';
    openModal('modal-profile');
    setTimeout(function () { $('input-profile-name').focus(); }, 50);
  }

  function createProfile() {
    var name = ($('input-profile-name').value || '').trim();
    if (!name) { $('input-profile-name').focus(); return; }
    var cyl = parseInt($('input-cylinders').value, 10) || 4;
    var p = EMStorage.createProfile(name, cyl);
    closeModal('modal-profile');
    navigate('profile', p.id);
  }

  function deleteCurrentProfile() {
    var p = EMStorage.getProfile(state.currentProfileId);
    if (!p) return;
    if (confirm('Supprimer le profil « ' + p.name + ' » et tout son historique ?')) {
      EMStorage.deleteProfile(p.id);
      navigate('home');
    }
  }

  // ====================================================
  // Utils
  // ====================================================
  function showError(id, msg) {
    var el = $(id);
    el.textContent = msg;
    show(el);
  }

  function fmtClock(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return pad2(m) + ':' + pad2(s);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function formatDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString('fr-FR') + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // ====================================================
  // Wire up events
  // ====================================================
  function init() {
    on($('btn-back'), 'click', goBack);
    on($('btn-about'), 'click', function () { openModal('modal-about'); });
    on($('btn-about-close'), 'click', function () { closeModal('modal-about'); });

    on($('btn-new-profile'), 'click', openNewProfile);
    on($('btn-profile-cancel'), 'click', function () { closeModal('modal-profile'); });
    on($('btn-profile-create'), 'click', createProfile);
    on($('input-profile-name'), 'keydown', function (e) {
      if (e.key === 'Enter') createProfile();
    });

    on($('btn-record-ref'), 'click', function () { navigate('record'); });
    on($('btn-diagnose'), 'click', function () { navigate('diagnose'); });
    on($('btn-delete-profile'), 'click', deleteCurrentProfile);

    on($('tolerance-slider'), 'input', function (e) {
      updateToleranceLabel(e.target.value);
    });
    on($('tolerance-slider'), 'change', function (e) {
      EMStorage.updateProfile(state.currentProfileId, { tolerance: Number(e.target.value) });
    });

    on($('btn-record-start'), 'click', startRecording);
    on($('btn-record-validate'), 'click', validateReference);

    on($('btn-diagnose-start'), 'click', startDiagnose);
    on($('btn-diagnose-save'), 'click', saveDiagnostic);

    // Close modals on backdrop tap.
    [['modal-profile', 'btn-profile-cancel'], ['modal-about', 'btn-about-close']]
      .forEach(function (pair) {
        var m = $(pair[0]);
        on(m, 'click', function (e) { if (e.target === m) hide(m); });
      });

    // Pause audio if the app is backgrounded (saves battery, releases mic).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state.engine) {
        stopAudio();
        if (state.screen === 'record') initRecordScreen();
        else if (state.screen === 'diagnose') initDiagnoseScreen();
      }
    });

    window.addEventListener('resize', function () {
      if (state.viz) state.viz.resize();
    });

    navigate('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
