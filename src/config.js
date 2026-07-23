/**
 * Configuration for Docs PR Hashtag Helper.
 *
 * Lets any Microsoft Docs contributor control where the helper runs:
 *   - mode "all":       active on every GitHub repository (default).
 *   - mode "allowlist": active only on the listed orgs or "org/repo" entries.
 *
 * Settings persist in chrome.storage.sync so they roam with the signed-in
 * browser profile. Everything degrades gracefully if storage is unavailable.
 */
(function () {
  "use strict";

  const DEFAULT_SETTINGS = {
    mode: "all",
    allowlist: ["MicrosoftDocs"]
  };

  const api =
    (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) ||
    null;

  const DocsPRHelperConfig = {
    DEFAULT_SETTINGS,

    /** Reads merged settings, falling back to defaults on any error. */
    async get() {
      if (!api) return { ...DEFAULT_SETTINGS };
      try {
        const stored = await api.get("settings");
        return { ...DEFAULT_SETTINGS, ...(stored && stored.settings) };
      } catch (e) {
        return { ...DEFAULT_SETTINGS };
      }
    },

    /** Persists settings. */
    async set(settings) {
      if (!api) return;
      await api.set({ settings });
    },

    /**
     * Parses the current GitHub location into { owner, repo, full }.
     * Returns null when not on a repository page.
     */
    currentRepo() {
      const reserved = new Set([
        "orgs",
        "settings",
        "marketplace",
        "notifications",
        "explore",
        "topics",
        "search",
        "pulls",
        "issues",
        "codespaces",
        "sponsors"
      ]);
      const parts = window.location.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return null;
      if (reserved.has(parts[0].toLowerCase())) return null;
      return { owner: parts[0], repo: parts[1], full: `${parts[0]}/${parts[1]}` };
    },

    /** Decides whether the helper should run for the given repo + settings. */
    isEnabledFor(settings, repo) {
      if (!repo) return false;
      if (!settings || settings.mode === "all") return true;
      const owner = repo.owner.toLowerCase();
      const full = repo.full.toLowerCase();
      return (settings.allowlist || []).some((raw) => {
        const entry = String(raw).trim().toLowerCase();
        return entry !== "" && (entry === owner || entry === full);
      });
    },

    /** Subscribes to live settings changes; calls back with new settings. */
    onChange(callback) {
      if (!api || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "sync" && changes.settings) {
          callback({ ...DEFAULT_SETTINGS, ...changes.settings.newValue });
        }
      });
    }
  };

  window.DocsPRHelperConfig = DocsPRHelperConfig;
})();
