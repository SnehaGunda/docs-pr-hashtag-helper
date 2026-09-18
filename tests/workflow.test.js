const test = require("node:test");
const assert = require("node:assert/strict");

const {
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

test("disables sign-off until GitHub reports completed checks", () => {
  assert.deepEqual(mergeBoxAction(["do-not-merge"], false), {
    command: "#sign-off",
    title: "Not ready for sign-off",
    description:
      "Wait for OpenPublishing.Build, PoliCheck, and Authoring Assistant to complete before signing off.",
    icon: "hourglass",
    disabled: true
  });
  assert.equal(areChecksComplete(["All checks have passed"]), true);
  assert.equal(areChecksComplete(["4 successful checks"]), true);
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
    true
  );
  assert.equal(
    areChecksComplete(["4 successful checks", "1 pending check"]),
    false
  );
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
  assert.equal(
    latestWorkflowCommand(["Earlier #hold-off", "#sign-off\nThanks"]),
    "#sign-off"
  );
  assert.equal(latestWorkflowCommand(["No workflow command"]), null);
});

test("uses the last workflow command within the latest comment", () => {
  assert.equal(
    latestWorkflowCommand(["#sign-off\n#hold-off"]),
    "#hold-off"
  );
  assert.equal(latestWorkflowCommand(["text#sign-off"]), null);
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
