/**
 * Single source of truth for the supported Microsoft Learn PR hashtag commands.
 *
 * Source: "Process a pull request" / GitHub comment automation (PRMerger).
 * https://learn.microsoft.com/contribute/content/process-pull-request#sign-off-and-comment-automation
 *
 * Schema per command:
 *   trigger      Searchable text the menu filters on (always starts with "#").
 *   display      Label shown in the options-page command list.
 *   insert       Text inserted when chosen. "${CURSOR}" marks where the caret
 *                lands (for commands that take an argument). If it's absent, the
 *                caret goes to the end of the inserted text.
 *   summary      Short label shown next to the command.
 *   description  Full explanation shown under the command.
 *
 * To add or change a command, edit this list only.
 */
window.DOCS_PR_COMMANDS = [
  {
    trigger: "#sign-off",
    display: "#sign-off",
    insert: "#sign-off ",
    summary: "Ready to merge",
    description: "Adds the ready-to-merge label."
  },
  {
    trigger: "#hold-off",
    display: "#hold-off",
    insert: "#hold-off ",
    summary: "Not ready",
    description: "Removes the ready-to-merge label."
  },
  {
    trigger: "#please-close",
    display: "#please-close",
    insert: "#please-close ",
    summary: "Close",
    description: "Closes the PR or issue."
  },
  {
    trigger: "#please-open",
    display: "#please-open",
    insert: "#please-open ",
    summary: "Reopen",
    description: "Reopens a closed PR or issue."
  },
  {
    trigger: "#label:",
    display: '#label:"custom label text"',
    insert: '#label:"${CURSOR}"',
    summary: "Add custom label",
    description: "Adds a custom label (max 200 characters)."
  },
  {
    trigger: "#remove-label:",
    display: '#remove-label:"custom label text"',
    insert: '#remove-label:"${CURSOR}"',
    summary: "Remove custom label",
    description: "Removes a custom label."
  },
  {
    trigger: "#assign:",
    display: "#assign:<GitHub account>",
    insert: "#assign:${CURSOR}",
    summary: "Assign",
    description: "Adds a GitHub account to Assignees."
  },
  {
    trigger: "#unassign:",
    display: "#unassign:<GitHub account>",
    insert: "#unassign:${CURSOR}",
    summary: "Unassign",
    description: "Removes a GitHub account from Assignees."
  },
  {
    trigger: "#reassign:",
    display: "#reassign:<GitHub account>",
    insert: "#reassign:${CURSOR}",
    summary: "Reassign",
    description: "Replaces all current assignees with a GitHub account."
  },
  {
    trigger: "#assign-reviewer:",
    display: "#assign-reviewer:<GitHub account>",
    insert: "#assign-reviewer:${CURSOR}",
    summary: "Assign reviewer",
    description: "Adds a GitHub account to Reviewers."
  },
  {
    trigger: "#unassign-reviewer:",
    display: "#unassign-reviewer:<GitHub account>",
    insert: "#unassign-reviewer:${CURSOR}",
    summary: "Unassign reviewer",
    description: "Removes a GitHub account from Reviewers."
  }
];
