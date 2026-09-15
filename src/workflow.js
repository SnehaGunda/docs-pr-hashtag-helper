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
    isAssigneeControlLabel,
    assignmentCommand,
    isLearnBuildBot,
    labelCommand,
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
