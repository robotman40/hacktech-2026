/* utils/storage.js — profile management + report storage, loaded first in content scripts */
(function () {
  const DEFAULT_PROFILE = {
    enabled: true,
    pollInterval: 60,          // seconds
    apiEndpoint: "http://localhost:8000/v1/evaluate",
    apiKey: "",
    preFilterEnabled: true,    // run local regex before hitting API
    minDangerRating: 4,        // 1–10; only alert above this
    sensitivity: "medium",     // low | medium | high
    notifyOnDanger: true,
    showInPageBanner: true,
  };

  const GLOBAL_KEY = "__global__";

  const StorageUtils = {
    // ── profiles (per hostname) ──────────────────────────────────────────────

    async getProfile(hostname) {
      const key = hostname || GLOBAL_KEY;
      const data = await chrome.storage.sync.get("profiles");
      const profiles = data.profiles || {};
      // Merge global defaults → stored global → stored per-host
      return Object.assign(
        {},
        DEFAULT_PROFILE,
        profiles[GLOBAL_KEY] || {},
        profiles[key] || {}
      );
    },

    async setProfile(hostname, patch) {
      const key = hostname || GLOBAL_KEY;
      const data = await chrome.storage.sync.get("profiles");
      const profiles = data.profiles || {};
      profiles[key] = Object.assign({}, profiles[key] || {}, patch);
      await chrome.storage.sync.set({ profiles });
    },

    async getAllProfiles() {
      const data = await chrome.storage.sync.get("profiles");
      return data.profiles || {};
    },

    async deleteProfile(hostname) {
      const data = await chrome.storage.sync.get("profiles");
      const profiles = data.profiles || {};
      delete profiles[hostname];
      await chrome.storage.sync.set({ profiles });
    },

    // ── reports (local, larger quota) ───────────────────────────────────────

    async saveReport(report) {
      const data = await chrome.storage.local.get("reports");
      const reports = data.reports || [];
      reports.unshift(report);
      // Keep latest 500 reports
      if (reports.length > 500) reports.length = 500;
      await chrome.storage.local.set({ reports });
    },

    async getReports({ hostname, limit = 50 } = {}) {
      const data = await chrome.storage.local.get("reports");
      let reports = data.reports || [];
      if (hostname) reports = reports.filter((r) => r.hostname === hostname);
      return reports.slice(0, limit);
    },

    async clearReports(hostname) {
      const data = await chrome.storage.local.get("reports");
      let reports = data.reports || [];
      if (hostname) {
        reports = reports.filter((r) => r.hostname !== hostname);
      } else {
        reports = [];
      }
      await chrome.storage.local.set({ reports });
    },

    // ── seen-hash dedup (per tab, session only) ──────────────────────────────
    _seen: new Map(),

    markSeen(tabKey, hash) {
      this._seen.set(tabKey, hash);
    },

    isSeen(tabKey, hash) {
      return this._seen.get(tabKey) === hash;
    },
  };

  window.StorageUtils = StorageUtils;
  window.DEFAULT_PROFILE = DEFAULT_PROFILE;
})();
