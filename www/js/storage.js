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
    },

    /** Serialize all profiles into a portable backup object. */
    exportAll: function () {
      return {
        app: 'ecoute-moteur',
        version: 1,
        exportedAt: Date.now(),
        profiles: load()
      };
    },

    /**
     * Import a backup produced by exportAll().
     * @param {object} data parsed backup
     * @param {string} mode 'merge' (default) keeps existing + adds new ids,
     *                       'replace' overwrites everything
     * @returns {{imported:number}}
     */
    importAll: function (data, mode) {
      if (!data || data.app !== 'ecoute-moteur' || !Array.isArray(data.profiles)) {
        throw new Error('Fichier de sauvegarde invalide.');
      }
      var incoming = data.profiles.filter(function (p) { return p && p.id && p.name; });
      if (mode === 'replace') {
        persist(incoming);
        return { imported: incoming.length };
      }
      var existing = load();
      var seen = {};
      existing.forEach(function (p) { seen[p.id] = true; });
      var added = 0;
      incoming.forEach(function (p) {
        if (seen[p.id]) {
          // Re-key duplicates so we never clobber an existing vehicle.
          p.id = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
          p.name = p.name + ' (importé)';
        }
        existing.push(p);
        added++;
      });
      persist(existing);
      return { imported: added };
    }
  };

  global.EMStorage = Storage;
})(window);
