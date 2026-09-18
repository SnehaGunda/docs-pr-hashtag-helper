(function (root) {
  "use strict";

  function commandForReadyState(readyToMerge) {
    return readyToMerge ? "#hold-off" : "#sign-off";
  }

  function mergeBoxAction(labels, checksComplete = true, commandOverride = null) {
    const normalizedLabels = Array.from(labels || []).map((label) =>
      String(label || "").trim().toLowerCase()
    );
    if (
      commandOverride === "#hold-off" ||
      (!commandOverride && normalizedLabels.includes("ready-to-merge"))
    ) {
      return {
        command: "#hold-off",
        title: "Hold off merge",
        description: "Comment #hold-off to cancel merge.",
        icon: "hand"
      };
    }
    if (
      commandOverride === "#sign-off" ||
      normalizedLabels.includes("do-not-merge")
    ) {
      if (!checksComplete) {
        return {
          command: "#sign-off",
          title: "Not ready for sign-off",
          description:
            "Wait for OpenPublishing.Build, PoliCheck, and Authoring Assistant to complete before signing off.",
          icon: "hourglass",
          disabled: true
        };
      }
      const description = normalizedLabels.includes("needs-human-review")
        ? "Comment #sign-off to request review and merge."
        : normalizedLabels.includes("qualifies-for-auto-merge")
          ? "Comment #sign-off to merge automatically."
          : "Comment #sign-off to merge.";
      return {
        command: "#sign-off",
        title: "Merge with PRMerger",
        description,
        icon: "check",
        disabled: false
      };
    }
    return null;
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

  function assignmentCommands(action, usernames) {
    const commands = new Map();
    Array.from(usernames || []).forEach((username) => {
      const command = assignmentCommand(action, username);
      const key = String(username || "").trim().replace(/^@/, "").toLowerCase();
      if (command && !commands.has(key)) commands.set(key, command);
    });
    return Array.from(commands.values()).join("\n") || null;
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

  function labelCommands(action, labels) {
    const commands = new Map();
    Array.from(labels || []).forEach((label) => {
      const command = labelCommand(action, label);
      const key = String(label || "").trim().toLowerCase();
      if (command && !commands.has(key)) commands.set(key, command);
    });
    return Array.from(commands.values()).join("\n") || null;
  }

  function nextPickerOptionIndex(currentIndex, optionCount, key) {
    if (optionCount < 1) return -1;
    if (key === "Home") return 0;
    if (key === "End") return optionCount - 1;
    if (key === "ArrowDown") {
      return currentIndex < 0 ? 0 : (currentIndex + 1) % optionCount;
    }
    if (key === "ArrowUp") {
      return currentIndex < 0
        ? optionCount - 1
        : (currentIndex - 1 + optionCount) % optionCount;
    }
    return currentIndex;
  }

  function nextDialogFocusIndex(currentIndex, focusableCount, shiftKey) {
    if (focusableCount < 1) return -1;
    if (currentIndex < 0) return shiftKey ? focusableCount - 1 : 0;
    return shiftKey
      ? (currentIndex - 1 + focusableCount) % focusableCount
      : (currentIndex + 1) % focusableCount;
  }

  function labelColorFromStyle(style) {
    const values = ["r", "g", "b"].map((channel) => {
      const match = String(style || "").match(
        new RegExp(
          `--label-${channel}\\s*:\\s*(\\d{1,3})(?=\\s*;|\\s*$)`,
          "i"
        )
      );
      return match ? Number(match[1]) : NaN;
    });
    if (values.some((value) => !Number.isInteger(value) || value > 255)) {
      return null;
    }
    return `rgb(${values.join(", ")})`;
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

  function areChecksComplete(statuses) {
    const values = Array.from(statuses || []).map((status) =>
      String(status || "").trim().replace(/\s+/g, " ")
    );
    const allPassed = values.some((status) =>
      /^all checks (?:have )?passed[.!]?$/i.test(status)
    );
    if (allPassed) return true;

    const incomplete = values.some((status) =>
      /\bchecks?\b/i.test(status) &&
      /\b(?:pending|queued|in progress|waiting|expected|failed|failing|failure|cancelled|timed out|warning|action required)\b/i.test(status)
    );
    const successful = values.some((status) =>
      /^(?:\d+ successful checks?|\d+ checks? passed)[.!]?$/i.test(
        status
      )
    );
    return successful && !incomplete;
  }

  const api = {
    commandForReadyState,
    mergeBoxAction,
    isClosedUnmergedText,
    isReopenControlLabel,
    isAssigneeControlLabel,
    assignmentCommand,
    assignmentCommands,
    isLearnBuildBot,
    hasPRMergerLabel,
    labelCommand,
    labelCommands,
    labelColorFromStyle,
    nextPickerOptionIndex,
    nextDialogFocusIndex,
    nextWorkflowCommand,
    commandForLatestComment,
    latestWorkflowCommand,
    containsCommand,
    areChecksComplete
  };
  root.DocsPRWorkflow = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
