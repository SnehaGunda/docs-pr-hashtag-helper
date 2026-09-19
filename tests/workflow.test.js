const test = require("node:test");
const assert = require("node:assert/strict");

const {
  commandForReadyState,
  mergeBoxAction,
  isClosedUnmergedText,
  isReopenControlLabel,
  isClosureControlLabel,
  shouldHideNativeReopenControl,
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
  workflowCommandHistory,
  closureCommandHistory,
  nextClosureCommand,
  latestWorkflowCommand,
  hasNewPostedWorkflowCommand,
  workflowStateAfterPost,
  resolveWorkflowCommand,
  closureStateAfterPost,
  resolveClosureCommand,
  isPullRequestAuthor,
  isDraftPullRequestState,
  containsCommand,
  areChecksComplete
} = require("../src/workflow.js");

test("derives the workflow command from the current PR state", () => {
  assert.equal(commandForReadyState(false), "#sign-off");
  assert.equal(commandForReadyState(true), "#hold-off");
});

test("describes the merge box action from PRMerger labels", () => {
  assert.deepEqual(mergeBoxAction(["do-not-merge"]), {
    command: "#sign-off",
    title: "Merge with PRMerger",
    description: "Comment #sign-off to merge.",
    icon: "check",
    disabled: false
  });
  assert.deepEqual(mergeBoxAction(["Ready-To-Merge"]), {
    command: "#hold-off",
    title: "Hold off merge",
    description: "Comment #hold-off to cancel merge.",
    icon: "hand"
  });
  assert.equal(
    mergeBoxAction(["do-not-merge", "qualifies-for-auto-merge"]).description,
    "Comment #sign-off to merge automatically."
  );
  assert.equal(
    mergeBoxAction(["do-not-merge", "needs-human-review"]).description,
    "Comment #sign-off to request review and merge."
  );
  assert.equal(
    mergeBoxAction([
      "do-not-merge",
      "qualifies-for-auto-merge",
      "needs-human-review"
    ]).description,
    "Comment #sign-off to request review and merge."
  );
  assert.equal(mergeBoxAction(["documentation"]), null);
  assert.equal(mergeBoxAction([]), null);
});

test("uses a pending workflow command before GitHub updates labels", () => {
  assert.deepEqual(
    mergeBoxAction(["do-not-merge"], true, "#hold-off"),
    {
      command: "#hold-off",
      title: "Hold off merge",
      description: "Comment #hold-off to cancel merge.",
      icon: "hand"
    }
  );
  assert.equal(
    mergeBoxAction(["ready-to-merge"], true, "#sign-off").command,
    "#sign-off"
  );
});

test("hides sign-off until GitHub reports all checks passed", () => {
  assert.equal(mergeBoxAction(["do-not-merge"], false), null);
  assert.equal(
    mergeBoxAction(["do-not-merge"], false, "#hold-off").command,
    "#hold-off"
  );
  assert.equal(areChecksComplete(["All checks have passed"]), true);
  assert.equal(areChecksComplete(["All checks passed."]), true);
  assert.equal(
    areChecksComplete(["Merging is blocked", "All checks have passed"]),
    true
  );
  assert.equal(
    areChecksComplete(["1 pending review", "All checks have passed"]),
    true
  );
  assert.equal(
    areChecksComplete(["1 pending review", "4 successful checks"]),
    false
  );
  assert.equal(
    areChecksComplete(["4 successful checks", "1 pending check"]),
    false
  );
  assert.equal(areChecksComplete(["1 successful check"]), false);
  assert.equal(areChecksComplete(["3 checks passed"]), false);
  assert.equal(areChecksComplete(["Checks are in progress"]), false);
  assert.equal(areChecksComplete([]), false);
});

test("detects a standalone workflow command in a draft", () => {
  assert.equal(containsCommand("Notes\n#sign-off", "#sign-off"), true);
  assert.equal(containsCommand("#HOLD-OFF\n", "#hold-off"), true);
});

test("does not confuse partial or embedded text for a command", () => {
  assert.equal(containsCommand("#sign-off-later", "#sign-off"), false);
  assert.equal(containsCommand("text#sign-off", "#sign-off"), false);
  assert.equal(containsCommand("", "#sign-off"), false);
});

test("toggles between sign-off and hold-off after posting", () => {
  assert.equal(nextWorkflowCommand("#sign-off"), "#hold-off");
  assert.equal(nextWorkflowCommand("#hold-off"), "#sign-off");
});

test("defaults to sign-off when no workflow comment exists", () => {
  assert.equal(commandForLatestComment(null), "#sign-off");
  assert.equal(commandForLatestComment("#sign-off"), "#hold-off");
  assert.equal(commandForLatestComment("#hold-off"), "#sign-off");
});

test("uses the latest posted workflow command", () => {
  assert.equal(
    latestWorkflowCommand(["#sign-off", "Other update", "#hold-off"]),
    "#hold-off"
  );
  assert.equal(latestWorkflowCommand(["Earlier #hold-off"]), null);
  assert.equal(latestWorkflowCommand(["#sign-off\nThanks"]), null);
  assert.equal(latestWorkflowCommand(["No workflow command"]), null);
});

test("returns workflow command history in timeline order", () => {
  assert.deepEqual(
    workflowCommandHistory([
      "  #sign-off\n",
      "No command here",
      "#hold-off"
    ]),
    ["#sign-off", "#hold-off"]
  );
});

test("ignores workflow command mentions that are not exact comments", () => {
  assert.deepEqual(
    workflowCommandHistory([
      "#signoff",
      "Use #sign-off when ready.",
      "#sign-off\n#hold-off",
      "`#sign-off`"
    ]),
    []
  );
});

test("ignores PR template guidance and misspelled sign-off comments", () => {
  const timelineBodies = [
    "Once the pull request is finalized, type #sign-off in a new comment.",
    "If needed, type #hold-off instead.",
    "#signoff"
  ];

  assert.deepEqual(workflowCommandHistory(timelineBodies), []);
  assert.equal(
    resolveWorkflowCommand(workflowCommandHistory(timelineBodies)).command,
    "#sign-off"
  );
});

test("recognizes only a newly posted pending workflow command", () => {
  assert.equal(
    hasNewPostedWorkflowCommand(["#sign-off", "#hold-off"], "#sign-off", 1),
    false
  );
  assert.equal(
    hasNewPostedWorkflowCommand(
      ["#sign-off", "#hold-off", "#sign-off"],
      "#sign-off",
      1
    ),
    true
  );
  assert.equal(
    hasNewPostedWorkflowCommand(["#hold-off"], "#hold-off", null),
    true
  );
});

test("keeps workflow command transitions stable across clicks and refreshes", () => {
  let comments = ["#signoff", "Use #sign-off when ready."];
  let resolved = resolveWorkflowCommand(workflowCommandHistory(comments));
  assert.deepEqual(resolved, {
    command: "#sign-off",
    clearPendingState: false
  });

  const pendingSignOff = workflowStateAfterPost(
    resolved.command,
    workflowCommandHistory(comments)
  );
  assert.deepEqual(pendingSignOff, {
    command: "#hold-off",
    postedCommand: "#sign-off",
    postedCommandCount: 0
  });
  assert.deepEqual(
    resolveWorkflowCommand(workflowCommandHistory(comments), pendingSignOff),
    { command: "#hold-off", clearPendingState: false }
  );

  comments = [...comments, "#sign-off"];
  resolved = resolveWorkflowCommand(
    workflowCommandHistory(comments),
    pendingSignOff
  );
  assert.deepEqual(resolved, {
    command: "#hold-off",
    clearPendingState: true
  });
  assert.equal(
    resolveWorkflowCommand(workflowCommandHistory(comments)).command,
    "#hold-off"
  );

  const pendingHoldOff = workflowStateAfterPost(
    resolved.command,
    workflowCommandHistory(comments)
  );
  assert.equal(
    resolveWorkflowCommand(
      workflowCommandHistory(comments),
      pendingHoldOff
    ).command,
    "#sign-off"
  );

  comments = [...comments, "#hold-off"];
  assert.deepEqual(
    resolveWorkflowCommand(
      workflowCommandHistory(comments),
      pendingHoldOff
    ),
    { command: "#sign-off", clearPendingState: true }
  );
  assert.equal(
    resolveWorkflowCommand(workflowCommandHistory(comments)).command,
    "#sign-off"
  );
});

test("does not resolve pending state from an older duplicate command", () => {
  const comments = ["#sign-off", "#hold-off"];
  const pendingState = workflowStateAfterPost("#sign-off", comments);

  assert.deepEqual(resolveWorkflowCommand(comments, pendingState), {
    command: "#hold-off",
    clearPendingState: false
  });
  assert.deepEqual(
    resolveWorkflowCommand([...comments, "#sign-off"], pendingState),
    { command: "#hold-off", clearPendingState: true }
  );
});

test("clears legacy overrides and derives state from exact comments", () => {
  assert.deepEqual(
    resolveWorkflowCommand([], { command: "#hold-off" }),
    { command: "#sign-off", clearPendingState: true }
  );
  assert.deepEqual(
    resolveWorkflowCommand(["#sign-off"], { command: "#sign-off" }),
    { command: "#hold-off", clearPendingState: true }
  );
});

test("keeps close and reopen transitions stable across clicks and refreshes", () => {
  let comments = ["Use #please-open to reopen.", "#pleaseopen"];
  let history = closureCommandHistory(comments);
  assert.deepEqual(history, []);
  assert.equal(resolveClosureCommand(history).command, "#please-open");
  assert.equal(
    resolveClosureCommand(history, null, "#please-close").command,
    "#please-close"
  );

  const pendingOpen = closureStateAfterPost("#please-open", history);
  assert.deepEqual(pendingOpen, {
    command: "#please-close",
    postedCommand: "#please-open",
    postedCommandCount: 0
  });
  assert.equal(
    resolveClosureCommand(history, pendingOpen).command,
    "#please-close"
  );

  comments = [...comments, "#please-open"];
  history = closureCommandHistory(comments);
  assert.deepEqual(resolveClosureCommand(history, pendingOpen), {
    command: "#please-close",
    clearPendingState: true
  });
  assert.equal(resolveClosureCommand(history).command, "#please-close");

  const pendingClose = closureStateAfterPost("#please-close", history);
  assert.equal(
    resolveClosureCommand(history, pendingClose).command,
    "#please-open"
  );

  comments = [...comments, "#please-close"];
  history = closureCommandHistory(comments);
  assert.deepEqual(resolveClosureCommand(history, pendingClose), {
    command: "#please-open",
    clearPendingState: true
  });
  assert.equal(resolveClosureCommand(history).command, "#please-open");
});

test("requires exact close and reopen comments", () => {
  assert.deepEqual(
    closureCommandHistory([
      "#please-open ",
      "#PLEASE-CLOSE",
      "#pleaseopen",
      "Text #please-close",
      "#please-open\n#please-close"
    ]),
    ["#please-open", "#please-close"]
  );
  assert.equal(nextClosureCommand("#please-open"), "#please-close");
  assert.equal(nextClosureCommand("#please-close"), "#please-open");
});

test("matches PR authors by exact case-insensitive login", () => {
  assert.equal(isPullRequestAuthor("SnehaGunda", "snehagunda"), true);
  assert.equal(isPullRequestAuthor("SnehaGunda", "other-user"), false);
  assert.equal(isPullRequestAuthor("", "snehagunda"), false);
  assert.equal(isPullRequestAuthor("SnehaGunda", null), false);
});

test("requires one exact workflow command per comment", () => {
  assert.equal(latestWorkflowCommand(["#sign-off\n#hold-off"]), null);
  assert.equal(latestWorkflowCommand(["text#sign-off"]), null);
});

test("recognizes GitHub draft pull request indicators", () => {
  assert.equal(isDraftPullRequestState(["Draft"]), true);
  assert.equal(isDraftPullRequestState(["draft"]), true);
  assert.equal(isDraftPullRequestState(["Draft Pull Request"]), true);
  assert.equal(isDraftPullRequestState(["State State--draft"]), true);
  assert.equal(isDraftPullRequestState(["Open"]), false);
  assert.equal(isDraftPullRequestState(["Ready for review"]), false);
  assert.equal(isDraftPullRequestState(["Draft documentation update"]), false);
});

test("recognizes closed unmerged pull requests without matching merged ones", () => {
  assert.equal(isClosedUnmergedText("Closed with unmerged commits"), true);
  assert.equal(isClosedUnmergedText("This pull request is closed."), true);
  assert.equal(isClosedUnmergedText("Closed"), true);
  assert.equal(isClosedUnmergedText("Merged and closed"), false);
  assert.equal(isClosedUnmergedText("This pull request was merged"), false);
  assert.equal(isClosedUnmergedText("Open"), false);
});

test("recognizes native GitHub reopen controls without matching status text", () => {
  assert.equal(isReopenControlLabel("Reopen"), true);
  assert.equal(isReopenControlLabel("Reopen pull request"), true);
  assert.equal(isReopenControlLabel(" REOPEN PULL REQUEST "), true);
  assert.equal(isReopenControlLabel("Reopen requested"), false);
  assert.equal(isReopenControlLabel("This pull request is closed"), false);
});

test("recognizes native GitHub close and reopen controls", () => {
  assert.equal(isClosureControlLabel("Reopen pull request"), true);
  assert.equal(isClosureControlLabel("Close pull request"), true);
  assert.equal(isClosureControlLabel("Close"), true);
  assert.equal(isClosureControlLabel("Reopen requested"), false);
  assert.equal(isClosureControlLabel("This pull request is closed"), false);
});

test("hides only a disabled native reopen control while please-open is available", () => {
  assert.equal(
    shouldHideNativeReopenControl(
      "#please-open",
      "Reopen pull request",
      true,
      null
    ),
    true
  );
  assert.equal(
    shouldHideNativeReopenControl("#please-open", "Reopen", false, "true"),
    true
  );
  assert.equal(
    shouldHideNativeReopenControl(
      "#please-open",
      "Reopen pull request",
      false,
      "false"
    ),
    false
  );
  assert.equal(
    shouldHideNativeReopenControl(
      "#please-close",
      "Reopen pull request",
      true,
      "true"
    ),
    false
  );
  assert.equal(
    shouldHideNativeReopenControl(
      "#please-open",
      "Close pull request",
      true,
      "true"
    ),
    false
  );
});

test("recognizes native GitHub assignee controls", () => {
  assert.equal(isAssigneeControlLabel("Edit assignees"), true);
  assert.equal(isAssigneeControlLabel("Assign up to 10 people"), true);
  assert.equal(isAssigneeControlLabel("assign yourself"), false);
  assert.equal(isAssigneeControlLabel("Reviewers"), false);
});

test("formats assignee automation commands with GitHub mentions", () => {
  assert.equal(assignmentCommand("assign", "octocat"), "#assign: @octocat");
  assert.equal(
    assignmentCommand("unassign", "@github-user"),
    "#unassign: @github-user"
  );
  assert.equal(assignmentCommand("remove", "octocat"), null);
  assert.equal(assignmentCommand("assign", "invalid user"), null);
});

test("formats reviewer automation commands with GitHub mentions", () => {
  assert.equal(
    assignmentCommand("assign-reviewer", "octocat"),
    "#assign-reviewer: @octocat"
  );
  assert.equal(
    assignmentCommand("unassign-reviewer", "@github-user"),
    "#unassign-reviewer: @github-user"
  );
});

test("formats multiple assignments as one deduplicated comment", () => {
  assert.equal(
    assignmentCommands("assign", ["octocat", "@hubot", "Octocat"]),
    "#assign: @octocat\n#assign: @hubot"
  );
  assert.equal(
    assignmentCommands("assign-reviewer", ["octocat", "hubot"]),
    "#assign-reviewer: @octocat\n#assign-reviewer: @hubot"
  );
  assert.equal(assignmentCommands("assign", []), null);
  assert.equal(assignmentCommands("remove", ["octocat"]), null);
});

test("identifies Learn Build reviewer bots without excluding users", () => {
  assert.equal(isLearnBuildBot("learn-build-service-prod-03[bot]"), true);
  assert.equal(isLearnBuildBot("learn_build_release"), true);
  assert.equal(isLearnBuildBot("service-account", "Learn Build Service"), true);
  assert.equal(isLearnBuildBot("gewarren", "Genevieve Warren"), false);
  assert.equal(isLearnBuildBot("build-reviewer", "Learn contributor"), false);
});

test("formats custom label automation commands", () => {
  assert.equal(labelCommand("label", "needs review"), '#label:"needs review"');
  assert.equal(
    labelCommand("remove-label", "needs review"),
    '#remove-label:"needs review"'
  );
  assert.equal(labelCommand("label", ""), null);
  assert.equal(labelCommand("label", 'bad"label'), null);
  assert.equal(labelCommand("remove", "needs review"), null);
  assert.equal(labelCommand("label", "x".repeat(201)), null);
});

test("formats multiple labels as one deduplicated comment", () => {
  assert.equal(
    labelCommands("label", ["documentation", "needs review", "Documentation"]),
    '#label:"documentation"\n#label:"needs review"'
  );
  assert.equal(labelCommands("label", []), null);
  assert.equal(labelCommands("remove", ["documentation"]), null);
});

test("moves through picker options with wrapping keyboard navigation", () => {
  assert.equal(nextPickerOptionIndex(-1, 3, "ArrowDown"), 0);
  assert.equal(nextPickerOptionIndex(-1, 3, "ArrowUp"), 2);
  assert.equal(nextPickerOptionIndex(2, 3, "ArrowDown"), 0);
  assert.equal(nextPickerOptionIndex(0, 3, "ArrowUp"), 2);
  assert.equal(nextPickerOptionIndex(1, 3, "Home"), 0);
  assert.equal(nextPickerOptionIndex(1, 3, "End"), 2);
  assert.equal(nextPickerOptionIndex(1, 3, "Enter"), 1);
  assert.equal(nextPickerOptionIndex(0, 0, "ArrowDown"), -1);
});

test("cycles focus within an open dialog", () => {
  assert.equal(nextDialogFocusIndex(0, 3, false), 1);
  assert.equal(nextDialogFocusIndex(2, 3, false), 0);
  assert.equal(nextDialogFocusIndex(0, 3, true), 2);
  assert.equal(nextDialogFocusIndex(-1, 3, false), 0);
  assert.equal(nextDialogFocusIndex(-1, 3, true), 2);
  assert.equal(nextDialogFocusIndex(0, 0, false), -1);
});

test("extracts repository label colors from GitHub styles", () => {
  assert.equal(
    labelColorFromStyle("--label-r:215;--label-g:58;--label-b:74"),
    "rgb(215, 58, 74)"
  );
  assert.equal(labelColorFromStyle("--label-r:256;--label-g:0;--label-b:0"), null);
  assert.equal(labelColorFromStyle("--label-r:1000;--label-g:0;--label-b:0"), null);
  assert.equal(labelColorFromStyle("color: red"), null);
});

test("recognizes PRMerger repository labels", () => {
  assert.equal(hasPRMergerLabel(["do-not-merge"]), true);
  assert.equal(hasPRMergerLabel(["Ready-To-Merge"]), true);
  assert.equal(hasPRMergerLabel(["documentation", "triage"]), false);
  assert.equal(hasPRMergerLabel([]), false);
});
