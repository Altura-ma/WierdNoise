/* =========================================================
   storage.js — local persistence (localStorage)
   No backend, no network. Profiles + history live on-device.
   ========================================================= */
(function (global) {
  'use strict';

  var KEY = 'ecoute-moteur.profiles.v1';

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('Storage load failed', e);
      return [];
    }
  }

  function persist(profiles) {
    try {
      localStorage.setItem(KEY, JSON.stringify(profiles));
      return true;
    } catch (e) {
      console.warn('Storage save failed', e);
      return false;
    }
  }

  function uid() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  var Storage = {
    /** @returns {Array} all stored profiles */
    getProfiles: function () {
      return load();
    },

    getProfile: function (id) {
      return load().filter(function (p) { return p.id === id; })[0] || null;
    },

    /**
     * Create a new vehicle profile.
     * @param {string} name
     * @param {number} cylinders
     * @returns {object} the created profile
     */
    createProfile: function (name, cylinders) {
      var profiles = load();
      var profile = {
        id: uid(),
        name: name,
        cylinders: cylinders || 4,
        createdAt: Date.now(),
        reference: null,      // { spectrum:[...], sampleRate, binCount, fftSize, idleHz, recordedAt }
        tolerance: 25,        // 0..100, lower = more sensitive
        history: []           // [{ at, level, score, dominantHz, anomalies:[{hz, ratio}] }]
      };
      profiles.push(profile);
      persist(profiles);
      return profile;
    },

    updateProfile: function (id, patch) {
      var profiles = load();
      for (var i = 0; i < profiles.length; i++) {
        if (profiles[i].id === id) {
          for (var k in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, k)) {
              profiles[i][k] = patch[k];
            }
          }
          persist(profiles);
          return profiles[i];
        }
      }
      return null;
    },

    /** Persist a reference sound profile for a vehicle. */
    setReference: function (id, reference) {
      return this.updateProfile(id, { reference: reference });
    },

    /** Prepend a diagnostic result to the profile history (cap at 50). */
    addHistory: function (id, entry) {
      var profiles = load();
      for (var i = 0; i < profiles.length; i++) {
        if (profiles[i].id === id) {
          profiles[i].history = profiles[i].history || [];
          profiles[i].history.unshift(entry);
          if (profiles[i].history.length > 50) {
            profiles[i].history = profiles[i].history.slice(0, 50);
          }
          persist(profiles);
          return profiles[i];
        }
      }
      return null;
    },

    deleteProfile: function (id) {
      var profiles = load().filter(function (p) { return p.id !== id; });
      persist(profiles);
    }
  };

  global.EMStorage = Storage;
})(window);
