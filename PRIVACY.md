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
- When you select **Assign**, activates GitHub's native assignee picker. GitHub
  displays eligible users and performs the assignment after you select one.

## Data handling

- **No data collection.** The extension does not read, store, or send the
  content of your comments, PRs, issues, or any page content anywhere.
- **No independent network requests.** The extension has no analytics,
  tracking, telemetry, or external service calls. The sign-off and hold-off
  buttons initiate GitHub's own comment submission on your behalf, and the
  Assign button delegates selection and assignment to GitHub's own controls.
- **Settings storage only.** Your scope preference (run everywhere vs. an
  org/repo allowlist) is stored with the browser's `storage.sync` API so it
  roams with your signed-in browser profile. The extension also stores the last
  submitted sign-off or hold-off command and its next button action for each
  pull request in `storage.local` so the state survives a refresh. This contains
  repository names, pull request numbers, and command names, but no comment
  content.

## Permissions

- `storage` — to save your scope preference and per-PR workflow button state.
- Host access to `https://github.com/*` — so the autocomplete can appear in
  GitHub comment boxes.

## Contact

For questions or issues, open an issue in the project repository.
