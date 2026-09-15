# Privacy policy

**Docs PR Hashtag Helper** does not collect, transmit, or sell any personal
data.

## What the extension does

- Runs only on `github.com` pages.
- Watches text you type in a comment box **locally in your browser** to show an
  autocomplete menu for Microsoft Learn PR hashtag commands.
- Inserts the command you pick into the comment box.
- When you select **sign-off to merge** or **hold-off merge**, inserts the
  corresponding command and activates GitHub's normal **Comment** button. This
  explicit action submits the comment to GitHub, just as selecting **Comment**
  yourself would.
- When you use an assignee, reviewer, or custom-label control, inserts the
  corresponding PRMerger hashtag command and activates GitHub's normal
  **Comment** button.

## Data handling

- **No data collection.** The extension does not read, store, or send the
  content of your comments, PRs, issues, or any page content anywhere.
- **No independent network requests.** The extension has no analytics,
  tracking, telemetry, or external service calls. Workflow, assignee, reviewer,
  and label controls initiate GitHub's own comment submission on your behalf.
- **Settings storage only.** Your scope preference (run everywhere vs. an
  org/repo allowlist) is stored with the browser's `storage.sync` API so it
  roams with your signed-in browser profile. The extension also stores the last
  pending workflow, assignee, reviewer, and custom-label actions for each pull
  request in `storage.local` so the interface survives a refresh while GitHub
  processes the submitted comment. This data can contain repository names,
  pull request numbers, GitHub usernames, custom label names, and command
  states, but no comment drafts or other PR content.

## Permissions

- `storage` — to save your scope preference and pending per-PR action state.
- Host access to `https://github.com/*` — so the autocomplete can appear in
  GitHub comment boxes.

## Contact

For questions or issues, open an issue in the project repository.
