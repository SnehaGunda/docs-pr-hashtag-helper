# Privacy policy

**Docs PR Hashtag Helper** does not collect, transmit, or sell any personal
data.

## What the extension does

- Runs only on `github.com` pages.
- Reads the GitHub pull request page **locally in your browser** to show
  Microsoft Learn PR workflow controls.
- When you select **sign-off to merge** or **hold-off merge**, inserts the
  corresponding command and activates GitHub's normal **Comment** button. This
  explicit action submits the comment to GitHub, just as selecting **Comment**
  yourself would.
- When you use an assignee, reviewer, or custom-label control, inserts the
  corresponding PRMerger hashtag command and activates GitHub's normal
  **Comment** button.
- When you search for an assignee or reviewer, queries GitHub and displays the
  matching accounts' avatars, public full names, and usernames. These search
  results aren't stored by the extension.

## Data handling

- **No data collection.** The extension reads the GitHub page locally to provide
  its controls, but doesn't collect or transmit page content to the extension
  author or any external service.
- **GitHub-only requests.** The extension has no analytics, tracking, telemetry,
  or external service calls. User searches query GitHub, and workflow,
  assignee, reviewer, and label controls initiate GitHub's own comment
  submission on your behalf.
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
- Host access to `https://github.com/*` — so the controls can appear on GitHub
  pull request pages.

## Contact

For questions or issues, open an issue in the project repository.
