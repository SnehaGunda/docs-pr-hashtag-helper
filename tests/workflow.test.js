const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
  nextWorkflowCommand,
  commandForLatestComment,
  latestWorkflowCommand,
  containsCommand
} = require("../src/workflow.js");

test("uses sign-off until the PR is ready to merge", () => {
  assert.equal(commandForReadyState(false), "#sign-off");
  assert.equal(commandForReadyState(true), "#hold-off");
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

test("shows sign-off only after checks pass and always allows hold-off", () => {
  assert.equal(shouldShowWorkflowButton(false, false), false);
  assert.equal(shouldShowWorkflowButton(false, true), true);
  assert.equal(shouldShowWorkflowButton(true, false), true);
  assert.equal(shouldShowWorkflowButton(true, true), true);
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

test("recognizes GitHub passed-check status variants", () => {
  assert.equal(isPassedChecksText("All checks have passed"), true);
  assert.equal(isPassedChecksText("3 checks passed."), true);
  assert.equal(isPassedChecksText("All required checks were successful"), true);
  assert.equal(isPassedChecksText("Some checks are still pending"), false);
  assert.equal(isPassedChecksText("2 checks failed"), false);
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

test("recognizes PRMerger repository labels", () => {
  assert.equal(hasPRMergerLabel(["do-not-merge"]), true);
  assert.equal(hasPRMergerLabel(["Ready-To-Merge"]), true);
  assert.equal(hasPRMergerLabel(["documentation", "triage"]), false);
  assert.equal(hasPRMergerLabel([]), false);
});
