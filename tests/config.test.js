const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadConfig() {
  const store = {};
  const context = {
    window: {},
    chrome: {
      storage: {
        sync: {
          async get(key) {
            return { [key]: store[key] };
          },
          async set(values) {
            Object.assign(store, values);
          }
        },
        local: {
          async get(key) {
            return { [key]: store[key] };
          },
          async set(values) {
            Object.assign(store, values);
          }
        },
        onChanged: { addListener() {} }
      }
    }
  };
  const source = fs.readFileSync(
    path.join(__dirname, "../src/config.js"),
    "utf8"
  );
  vm.runInNewContext(source, context);
  return { config: context.window.DocsPRHelperConfig, store };
}

test("persists assignment command state by pull request", async () => {
  const { config } = loadConfig();
  const prKey = "microsoftdocs/repo#42";

  await config.setAssignmentState(prKey, ["octocat"], ["hubot"]);

  const state = await config.getAssignmentState(prKey);
  assert.deepEqual(Array.from(state.assignedUsers), ["octocat"]);
  assert.deepEqual(Array.from(state.unassignedUsers), ["hubot"]);
});

test("removes empty assignment command state", async () => {
  const { config, store } = loadConfig();
  const prKey = "microsoftdocs/repo#42";

  await config.setAssignmentState(prKey, ["octocat"], []);
  await config.setAssignmentState(prKey, [], []);

  assert.equal(store.assignmentStates[prKey], undefined);
  assert.equal(await config.getAssignmentState(prKey), null);
});

test("persists reviewer command state separately by pull request", async () => {
  const { config, store } = loadConfig();
  const prKey = "microsoftdocs/repo#42";

  await config.setAssignmentState(prKey, ["assignee"], []);
  await config.setReviewerState(prKey, ["reviewer"], ["former-reviewer"]);

  const state = await config.getReviewerState(prKey);
  assert.deepEqual(Array.from(state.assignedUsers), ["reviewer"]);
  assert.deepEqual(Array.from(state.unassignedUsers), ["former-reviewer"]);
  assert.deepEqual(Array.from(store.assignmentStates[prKey].assignedUsers), [
    "assignee"
  ]);
});

test("persists custom label state separately by pull request", async () => {
  const { config, store } = loadConfig();
  const prKey = "microsoftdocs/repo#42";

  await config.setLabelState(prKey, ["needs review"], ["do not merge"]);

  const state = await config.getLabelState(prKey);
  assert.deepEqual(Array.from(state.addedLabels), ["needs review"]);
  assert.deepEqual(Array.from(state.removedLabels), ["do not merge"]);
  assert.equal(store.assignmentStates, undefined);
  assert.equal(store.reviewerStates, undefined);
});

test("persists pending workflow command history baseline", async () => {
  const { config } = loadConfig();
  const prKey = "microsoftdocs/repo#42";

  await config.setWorkflowCommand(prKey, "#hold-off", "#sign-off", 2);

  assert.deepEqual(
    JSON.parse(JSON.stringify(await config.getWorkflowCommand(prKey))),
    {
      command: "#hold-off",
      postedCommand: "#sign-off",
      postedCommandCount: 2
    }
  );
});

test("isolates workflow state by pull request and clears it independently", async () => {
  const { config } = loadConfig();
  const firstPr = "microsoftdocs/repo#41";
  const secondPr = "microsoftdocs/repo#42";

  await config.setWorkflowCommand(firstPr, "#hold-off", "#sign-off", 0);
  await config.setWorkflowCommand(secondPr, "#sign-off", "#hold-off", 1);
  await config.setWorkflowCommand(firstPr, null);

  assert.equal(await config.getWorkflowCommand(firstPr), null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await config.getWorkflowCommand(secondPr))),
    {
      command: "#sign-off",
      postedCommand: "#hold-off",
      postedCommandCount: 1
    }
  );
});

test("persists and isolates close and reopen state by pull request", async () => {
  const { config } = loadConfig();
  const firstPr = "microsoftdocs/repo#41";
  const secondPr = "microsoftdocs/repo#42";

  await config.setClosureCommand(firstPr, "#please-close", "#please-open", 0);
  await config.setClosureCommand(secondPr, "#please-open", "#please-close", 1);
  await config.setClosureCommand(firstPr, null);

  assert.equal(await config.getClosureCommand(firstPr), null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await config.getClosureCommand(secondPr))),
    {
      command: "#please-open",
      postedCommand: "#please-close",
      postedCommandCount: 1
    }
  );
});