(function (root) {
  "use strict";

  function commandForReadyState(readyToMerge) {
    return readyToMerge ? "#hold-off" : "#sign-off";
  }

  function shouldShowWorkflowButton(readyToMerge, allChecksPassed) {
    return readyToMerge || allChecksPassed;
  }

  function isPassedChecksText(value) {
    const text = String(value || "")
      .trim()
      .replace(/\s+/g, " ");
    return /^(?:all|\d+)(?: required)? checks? (?:have |were |are )?(?:passed|successful)[.!]?$/i.test(
      text
    );
  }

  function isClosedUnmergedText(value) {
    const text = String(value || "")
      .trim()
      .replace(/\s+/g, " ");
    return (
      /^(?:closed|closed with unmerged commits|this pull request is closed)[.!]?$/i.test(
        text
      ) && !/\bmerged\b/i.test(text)
    );
  }

  function isReopenControlLabel(value) {
    return /^(?:reopen|reopen pull request)$/i.test(String(value || "").trim());
  }

  function isAssigneeControlLabel(value) {
    const text = String(value || "");
    return (
      !/\bassign yourself\b/i.test(text) &&
      /\b(?:assign|assignee|assignees)\b/i.test(text)
    );
  }

  function assignmentCommand(action, username) {
    const login = String(username || "").trim().replace(/^@/, "");
    if (
      ![
        "assign",
        "unassign",
        "assign-reviewer",
        "unassign-reviewer"
      ].includes(action) ||
      !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login)
    ) {
      return null;
    }
    return `#${action}: @${login}`;
  }

  function isLearnBuildBot(username, displayName = "") {
    return [username, displayName].some((value) =>
      /(?:^|[^a-z])learn[\s_-]*build(?:[^a-z]|$)/i.test(String(value || ""))
    );
  }

  function hasPRMergerLabel(labels) {
    return Array.from(labels || []).some((label) =>
      ["do-not-merge", "ready-to-merge"].includes(
        String(label || "").trim().toLowerCase()
      )
    );
  }

  function labelCommand(action, label) {
    const name = String(label || "").trim();
    if (
      !["label", "remove-label"].includes(action) ||
      !name ||
      name.length > 200 ||
      /[\r\n"]/.test(name)
    ) {
      return null;
    }
    return `#${action}:"${name}"`;
  }

  function labelInputValidation(label) {
    const name = String(label || "").trim();
    const count = name.length;
    if (!name) {
      return { valid: false, count, message: "Enter a label name." };
    }
    if (count > 200) {
      return {
        valid: false,
        count,
        message: `Label names can contain up to 200 characters (${count - 200} over).`
      };
    }
    if (/[\r\n"]/.test(name)) {
      return {
        valid: false,
        count,
        message: "Label names cannot contain quotes or new lines."
      };
    }
    return { valid: true, count, message: "" };
  }

  function filterLabelSuggestions(labels, query, excludedLabels = [], limit = 8) {
    const search = String(query || "").trim().toLowerCase();
    const excluded = new Set(
      Array.from(excludedLabels || [], (label) =>
        String(label || "").trim().toLowerCase()
      )
    );
    const unique = new Map();
    Array.from(labels || []).forEach((label) => {
      const name = String(label || "").trim();
      const key = name.toLowerCase();
      if (!name || excluded.has(key) || unique.has(key)) return;
      if (!search || key.includes(search)) unique.set(key, name);
    });
    return Array.from(unique.values())
      .sort((left, right) => {
        const leftStarts = left.toLowerCase().startsWith(search);
        const rightStarts = right.toLowerCase().startsWith(search);
        if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
        return left.localeCompare(right, undefined, { sensitivity: "base" });
      })
      .slice(0, Math.max(0, limit));
  }

  function nextWorkflowCommand(command) {
    return command === "#sign-off" ? "#hold-off" : "#sign-off";
  }

  function commandForLatestComment(command) {
    return command ? nextWorkflowCommand(command) : "#sign-off";
  }

  function latestWorkflowCommand(comments) {
    for (let index = comments.length - 1; index >= 0; index -= 1) {
      const matches = Array.from(
        String(comments[index] || "").matchAll(
          /(^|\s)(#sign-off|#hold-off)(?=\s|$)/gi
        )
      );
      if (matches.length > 0) {
        return matches[matches.length - 1][2].toLowerCase();
      }
    }
    return null;
  }

  function containsCommand(value, command) {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${escaped}(?:\\s|$)`, "i").test(value || "");
  }

  const api = {
    commandForReadyState,
    shouldShowWorkflowButton,
    isPassedChecksText,
    isClosedUnmergedText,
    isReopenControlLabel,
    isAssigneeControlLabel,
    assignmentCommand,
    isLearnBuildBot,
    hasPRMergerLabel,
    labelCommand,
    labelInputValidation,
    filterLabelSuggestions,
    nextWorkflowCommand,
    commandForLatestComment,
    latestWorkflowCommand,
    containsCommand
  };
  root.DocsPRWorkflow = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
