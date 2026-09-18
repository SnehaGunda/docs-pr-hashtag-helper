# Docs PR Hashtag Helper

A lightweight browser extension for Microsoft Edge, Google Chrome, and Mozilla
Firefox that adds ease-of-use capabilities for pull requests in repos that use the PRMerger app.

## Problem statement

Many MicrosoftDocs repos use **comment automation**: contributors type special
hashtag comments in a GitHub PR to trigger label changes and state transitions
(sign off, hold, close, reopen). The commands are documented at
[Process a pull request — Sign-off and comment automation](https://learn.microsoft.com/contribute/content/process-pull-request#sign-off-and-comment-automation), but:

- They're easy to forget or misspell (`#sign-off` vs `#signoff`).
- Discoverability: you have to leave the PR to look them up.
- A wrong command doesn't trigger the intended automation, which slows down merges.

## Supported commands

Sourced from the Microsoft Learn contributor guidance on GitHub comment
automation.

| Command | What it does | Repo availability |
| --- | --- | --- |
| `#sign-off` | Adds the **ready-to-merge** label so reviewers know the PR is ready for review/merge. In private repos, any contributor can sign off (usually the author or article owner). In public repos, only listed authors of files in the PR can sign off. | Public and private |
| `#hold-off` | Removes the **ready-to-merge** label. In a private repo, assigns the **do-not-merge** label. | Public and private |
| `#please-close` | Closes the PR or issue. | Public and private |
| `#please-open` | Reopens a closed PR or issue. | Public and private |
| `#label:"custom label text"` | Adds a custom label up to 200 characters (shorter recommended). | Public and private |
| `#remove-label:"custom label text"` | Removes a custom label. | Public and private |
| `#assign:<GitHub account>` | Adds a GitHub account to **Assignees**. The account must be a valid contributor in the repo. | Public and private |
| `#unassign:<GitHub account>` | Removes a GitHub account from **Assignees**. | Public and private |
| `#reassign:<GitHub account>` | Removes all current assignees, then adds a GitHub account to **Assignees**. | Public and private |
| `#assign-reviewer:<GitHub account>` | Adds a GitHub account to **Reviewers**. The account must be a valid contributor in the repo. | Public and private |
| `#unassign-reviewer:<GitHub account>` | Removes a GitHub account from **Reviewers**. | Public and private |

> Source: <https://learn.microsoft.com/contribute/content/process-pull-request#sign-off-and-comment-automation>

## Solution approach

A **Manifest V3 content script** that:

1. Shows a green **Merge with PRMerger** shortcut directly beside GitHub's
  **Merging is blocked** status after all required checks pass. The button adds
  `#sign-off` to the comment editor and submits it through GitHub's normal
  **Comment** button, then immediately becomes a green **Hold off merge** action
  in the same location. Selecting `#hold-off` immediately turns it back into
  **Merge with PRMerger**. On initial load, the extension finds the
  latest posted `#sign-off` or `#hold-off` comment and displays the opposite
  action. A newly submitted command and its next action are stored locally per
  pull request, so the state survives a refresh until the comment appears in
  the timeline. When no workflow comment or pending action exists, passed
  checks display **Merge with PRMerger**. The button never bypasses GitHub
  permissions or PRMerger authorization.
2. Shows **reopen pull request** immediately before GitHub's **Comment** button
  when a pull request is closed without being merged and GitHub doesn't already
  provide its native Reopen action. Selecting it posts `#please-open` through
  GitHub's normal comment workflow. Merged pull requests never show the reopen
  control.
3. Adds **Assign** controls beside **Assignees** and **Reviewers**. Entering a
  search term displays matching GitHub accounts with their avatar, public full
  name when available, and username. Selecting an account posts the
  corresponding `#assign` or `#assign-reviewer` PRMerger comment. Compact
  remove buttons beside people post `#unassign` or `#unassign-reviewer`
  comments.
4. Adds an **Add** control beside **Labels**. The expandable menu lists
  available repository labels with their colors and supports filtering. Select
  one or more labels, then choose **Apply** to post all corresponding
  `#label:"label name"` commands in one comment. Use the arrow keys to move
  through results, **Enter** to select, and **Escape** to close the menu and
  return focus to **Add**. Use **Add custom label** for a label that isn't in
  the repository list. A remove button appears beside labels added through the
  extension and posts `#remove-label:"label name"`. Pending changes appear
  immediately and are stored locally per pull request.

Design choices:

- **No build step, no dependencies.** Plain JavaScript and CSS so it's easy to
  audit and load unpacked.
- **Least privilege.** Only requests `github.com` host access plus `storage` for
  settings. User search stays within GitHub, and the extension doesn't call
  external services or store PR content.
- **Data-driven reference.** The command list shown on the options page lives
  in `src/commands.js`, so updating it when the docs change is a one-file edit.

## Scalable for any contributor and eligible repo

The helper is built to be shared across the whole MicrosoftDocs contributor
community, not hardwired to one repo:

- **Label-gated.** It runs only when the current pull request has a
  `do-not-merge` or `ready-to-merge` label.
- **Configurable scope.** An options page (`storage`-backed and roaming via
  `chrome.storage.sync`) lets each person choose:
  - **All eligible GitHub repositories** (default), or
  - **Only specific orgs or repos** — an allowlist such as `MicrosoftDocs` or
    `MicrosoftDocs/fabric-docs-pr`, one entry per line.
- **SPA-safe gating.** GitHub navigates between repos without full reloads, so
  the active-repo check always reflects the current page.
- **One place to maintain commands.** When the official command set changes,
  edit `src/commands.js` to update the options-page reference.

Open the options page from `edge://extensions` → the extension → **Details** →
**Extension options** (or right-click the toolbar icon → **Options**).

## Project structure

```text
docs-pr-hashtag-helper/
├── manifest.json        # MV3 extension manifest
├── manifest.firefox.json # Firefox-specific MV3 manifest
├── src/
│   ├── commands.js      # Options-page command reference
│   ├── config.js        # Settings + per-repo activation logic
│   ├── content.js       # PR controls injected into GitHub
│   └── content.css      # Injected control styling
├── options/
│   ├── options.html     # Settings page (scope configuration)
│   ├── options.js
│   └── options.css
├── icons/               # Generated PNG icons (16/32/48/128)
├── tests/
│   ├── config.test.js     # Repository-scope and storage tests
│   └── workflow.test.js   # Command and workflow tests
├── tools/
│   ├── generate_icons.py  # Regenerates the icon set
│   └── package.py         # Builds the store-ready ZIP into dist/
├── PRIVACY.md           # Privacy policy (required by stores)
├── README.md
└── .gitignore
```

## Install and try it (anyone)

No build step, no account, no store listing needed. It takes about two minutes.

### Step 1 — Get the files

Pick either option:

- **Download a ZIP:** On the GitHub page for this project, select
  **Code** > **Download ZIP**, then unzip it somewhere you'll remember (for
  example your Desktop). You should end up with a `docs-pr-hashtag-helper`
  folder that contains `manifest.json`.
- **Or clone it:**

  ```bash
  git clone <repository-url> docs-pr-hashtag-helper
  ```

> Make sure the folder you keep is the one that has `manifest.json` directly
> inside it (not a folder that contains another folder).

### Step 2 — Load it in your browser

#### Microsoft Edge

1. Go to `edge://extensions`.
2. Turn on **Developer mode** (toggle on the left).
3. Select **Load unpacked**.
4. Choose the `docs-pr-hashtag-helper` folder.

#### Google Chrome

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Select **Load unpacked**.
4. Choose the `docs-pr-hashtag-helper` folder.

#### Mozilla Firefox

Firefox requires the Firefox manifest to be named `manifest.json`. Build the
browser packages first:

```bash
python tools/package.py
```

Then:

1. Go to `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**.
3. Choose `dist/docs-pr-hashtag-helper-0.1.0-firefox.zip`.

Temporary add-ons are removed when Firefox closes. Publish and sign the Firefox
package through Mozilla Add-ons for permanent installation.

The **Docs PR Hashtag Helper** card appears. If it shows a red **Errors**
button, open it and share the message.

### Step 3 — Try it

1. Open a GitHub pull request on a repo that uses the PRMerger app.
1. Look for the **Assign** and **Add** buttons and try them out.
1. If the status checks have passed, look for the **Merge with PRMerger** action and, if you're ready to actually sign off on the PR, select `#sign-off`.

### Step 4 (optional) — Choose where it runs

1. On the extensions page, select **Details** on the card, then **Extension
   options**.
2. Choose **All eligible GitHub repositories** (default) or **Only specific
  orgs or repositories** and list entries like `MicrosoftDocs` or
   `MicrosoftDocs/fabric-docs-pr`.
3. Select **Save**.

### Keeping it updated

After you pull or download a newer version of the files, go back to the
extensions page and select the **reload** icon on the card.

### Uninstalling

On the extensions page, select **Remove** on the card.

## Build assets (maintainers)

The runtime code needs no build step. Two helper scripts prepare store assets
(they require Python with Pillow: `pip install pillow`):

```bash
# Regenerate icons/icon-{16,32,48,128}.png
python tools/generate_icons.py

# Build separate Chromium and Firefox ZIPs in dist/
python tools/package.py
```

## Publishing to a store

Once testing passes, publish so anyone can install with one click and get
automatic updates (no Developer mode needed).

1. **Bump the version** in `manifest.json` if needed.
2. **Build the packages:** `python tools/package.py` produces Chromium and
  Firefox ZIP files in `dist/`.
3. Submit the Chromium package to **Microsoft Edge Add-ons** at
  <https://partner.microsoft.com/dashboard/microsoftedge>.
4. Submit the Chromium package to the **Chrome Web Store** at
  <https://chrome.google.com/webstore/devconsole> (one-time $5 fee).
5. Submit the Firefox package to **Firefox Browser Add-ons** at
  <https://addons.mozilla.org/developers/>.
6. Provide the listing details: description (from this README), at least one
   screenshot, the `128` icon, and a privacy policy link (`PRIVACY.md`). Declare
   **no data collected**.
7. Submit for review. After approval, share the store link.

> The audience here is Microsoft Docs contributors. If you plan to brand this as
> an official docs tool or publish under Microsoft's name, confirm internal
> review/branding requirements with your team first. You can also publish an
> **unlisted** listing (install by direct link only) or deploy via **Edge for
> Business** policy for org-wide distribution.

## Roadmap

- [ ] Screenshots and a polished store listing.
- [ ] Support GitHub's newer rich-text comment editor if/when it replaces the
      markdown text area.
