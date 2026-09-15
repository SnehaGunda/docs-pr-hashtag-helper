/**
 * Configuration for Docs PR Hashtag Helper.
 *
 * Lets any Microsoft Docs contributor control where the helper runs:
 *   - mode "all":       active on every GitHub repository (default).
 *   - mode "allowlist": active only on the listed orgs or "org/repo" entries.
 *
 * Settings persist in storage.sync so they roam with the signed-in
 * browser profile. Everything degrades gracefully if storage is unavailable.
 */
(function () {
  "use strict";

  const DEFAULT_SETTINGS = {
    mode: "all",
    allowlist: ["MicrosoftDocs"]
  };

  const extensionApi =
    (typeof browser !== "undefined" && browser) ||
    (typeof chrome !== "undefined" && chrome) ||
    null;
  const storage = extensionApi && extensionApi.storage;
  const api = (storage && storage.sync) || null;
  const localApi = (storage && storage.local) || null;
  const WORKFLOW_COMMANDS_KEY = "workflowCommands";
  const ASSIGNMENT_STATES_KEY = "assignmentStates";
  const REVIEWER_STATES_KEY = "reviewerStates";

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

    async getWorkflowCommand(prKey) {
      if (!localApi || !prKey) return null;
      try {
        const stored = await localApi.get(WORKFLOW_COMMANDS_KEY);
        const state = stored[WORKFLOW_COMMANDS_KEY]?.[prKey];
        if (state === "#sign-off" || state === "#hold-off") {
          return { command: state, postedCommand: null };
        }
        if (
          state &&
          (state.command === "#sign-off" || state.command === "#hold-off")
        ) {
          return {
            command: state.command,
            postedCommand:
              state.postedCommand === "#sign-off" ||
              state.postedCommand === "#hold-off"
                ? state.postedCommand
                : null
          };
        }
        return null;
      } catch (e) {
        return null;
      }
    },

    async setWorkflowCommand(prKey, command, postedCommand = null) {
      if (!localApi || !prKey) return;
      const stored = await localApi.get(WORKFLOW_COMMANDS_KEY);
      const commands = { ...(stored[WORKFLOW_COMMANDS_KEY] || {}) };
      if (command === "#sign-off" || command === "#hold-off") {
        commands[prKey] = { command, postedCommand };
      } else {
        delete commands[prKey];
      }
      await localApi.set({ [WORKFLOW_COMMANDS_KEY]: commands });
    },

    async getAssignmentState(prKey) {
      if (!localApi || !prKey) return null;
      try {
        const stored = await localApi.get(ASSIGNMENT_STATES_KEY);
        const state = stored[ASSIGNMENT_STATES_KEY]?.[prKey];
        if (!state) return null;
        return {
          assignedUsers: Array.isArray(state.assignedUsers)
            ? state.assignedUsers
            : [],
          unassignedUsers: Array.isArray(state.unassignedUsers)
            ? state.unassignedUsers
            : []
        };
      } catch (e) {
        return null;
      }
    },

    async setAssignmentState(prKey, assignedUsers, unassignedUsers) {
      if (!localApi || !prKey) return;
      const stored = await localApi.get(ASSIGNMENT_STATES_KEY);
      const states = { ...(stored[ASSIGNMENT_STATES_KEY] || {}) };
      if (assignedUsers.length || unassignedUsers.length) {
        states[prKey] = { assignedUsers, unassignedUsers };
      } else {
        delete states[prKey];
      }
      await localApi.set({ [ASSIGNMENT_STATES_KEY]: states });
    },

    async getReviewerState(prKey) {
      if (!localApi || !prKey) return null;
      try {
        const stored = await localApi.get(REVIEWER_STATES_KEY);
        const state = stored[REVIEWER_STATES_KEY]?.[prKey];
        if (!state) return null;
        return {
          assignedUsers: Array.isArray(state.assignedUsers)
            ? state.assignedUsers
            : [],
          unassignedUsers: Array.isArray(state.unassignedUsers)
            ? state.unassignedUsers
            : []
        };
      } catch (e) {
        return null;
      }
    },

    async setReviewerState(prKey, assignedUsers, unassignedUsers) {
      if (!localApi || !prKey) return;
      const stored = await localApi.get(REVIEWER_STATES_KEY);
      const states = { ...(stored[REVIEWER_STATES_KEY] || {}) };
      if (assignedUsers.length || unassignedUsers.length) {
        states[prKey] = { assignedUsers, unassignedUsers };
      } else {
        delete states[prKey];
      }
      await localApi.set({ [REVIEWER_STATES_KEY]: states });
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
      if (!api || !storage.onChanged) return;
      storage.onChanged.addListener((changes, area) => {
        if (area === "sync" && changes.settings) {
          callback({ ...DEFAULT_SETTINGS, ...changes.settings.newValue });
        }
      });
    }
  };

  window.DocsPRHelperConfig = DocsPRHelperConfig;
})();
