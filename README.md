# Docs PR Hashtag Helper

A lightweight browser extension for Microsoft Edge, Google Chrome, and Mozilla
Firefox that adds an
autocomplete dropdown for **Microsoft Learn pull-request hashtag comments** on
GitHub. When you type `#` in a PR comment box, the supported commands appear in a
filterable menu so you can pick the right one without memorizing them.

Works on any `github.com` repository, including `MicrosoftDocs/fabric-docs-pr`,
`MicrosoftDocs/powerbi-docs-pr`, and other Microsoft Docs repos.

## Problem statement

Microsoft Docs repos use **comment automation**: contributors type special
hashtag comments in a GitHub PR to trigger label changes and state transitions
(sign off, hold, close, reopen). The commands are documented at
[Process a pull request — Sign-off and comment automation](https://learn.microsoft.com/contribute/content/process-pull-request#sign-off-and-comment-automation),
but:

- They're easy to forget or misspell (`#sign-off` vs `#signoff`).
- You have to leave the PR to look them up.
- A wrong command doesn't trigger the intended automation, which slows down
  merges.

There's no native GitHub autocomplete for these commands (GitHub only
autocompletes `@mentions`, `#issues`, and `:emoji:`).

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
| `#reassign:<GitHub account>` | Removes all current assignees, then adds a GitHub account to **Assignees**. | Public and private |
| `#assign-reviewer:<GitHub account>` | Adds a GitHub account to **Reviewers**. The account must be a valid contributor in the repo. | Public and private |
| `#unassign-reviewer:<GitHub account>` | Removes a GitHub account from **Reviewers**. | Public and private |

Commands that take an argument (labels and accounts) are inserted with the caret
placed where you type the value — for example `#label:"|"` or `#assign:|`.

> Source: <https://learn.microsoft.com/contribute/content/process-pull-request#sign-off-and-comment-automation>

## Solution approach

A **Manifest V3 content script** that:

1. Detects GitHub comment text areas on PR pages (new comment box, review
   comments, and edit boxes).
2. Watches what you type. When the token under the caret starts with `#`, it
   shows a positioned dropdown filtered against the supported commands.
3. Lets you navigate with the keyboard (Up/Down to move, Enter/Tab to insert,
   Esc to dismiss) or click to select.
4. Inserts the chosen command in place of the partial token.
5. Shows a green **sign-off to merge** shortcut directly beside GitHub's
  **Merging is blocked** status after all required checks pass. It adds
  `#sign-off` to the comment editor and submits it through GitHub's normal
  **Comment** button, then immediately becomes a light-yellow **hold-off
  merge** button in the same location. Posting `#hold-off` immediately turns
  it back into **sign-off to merge**. On initial load, the extension finds the
  latest posted `#sign-off` or `#hold-off` comment and displays the opposite
  action. A newly submitted command and its next action are stored locally per
  pull request, so the state survives a refresh until the comment appears in
  the timeline. When no workflow comment or pending action exists, passed
  checks display **sign-off to merge**. The button never bypasses GitHub
  permissions or PRMerger authorization.
6. Shows **reopen pull request** immediately before GitHub's **Comment** button
  when a pull request is closed without being merged. Selecting it posts
  `#please-open` through GitHub's normal comment workflow. Merged pull requests
  never show the reopen control.
7. Adds **Assign** controls beside **Assignees** and **Reviewers**. Entering a
  GitHub username posts the corresponding `#assign` or `#assign-reviewer`
  PRMerger comment. Compact remove buttons beside people post `#unassign` or
  `#unassign-reviewer` comments.
8. Adds an **Add** control beside **Labels**. Entering a custom label posts
  `#label:"label name"`; the remove button appears only beside custom labels
  added through the extension and posts `#remove-label:"label name"`.
  Predefined repository labels never receive a remove control. Pending changes
  appear immediately and are stored locally per pull request until GitHub
  reflects the update.

Design choices:

- **No build step, no dependencies.** Plain JavaScript and CSS so it's easy to
  audit and load unpacked.
- **Least privilege.** Only requests `github.com` host access plus `storage` for
  settings; no network calls, no storage of PR content.
- **Data-driven.** The command list lives in `src/commands.js`, so updating it
  when the docs change is a one-file edit.

## Scalable for any contributor and any repo

The helper is built to be shared across the whole Microsoft Docs contributor
community, not hardwired to one repo:

- **Universal by default.** It runs on every `github.com` repository, so it works
  on `fabric-docs-pr`, `powerbi-docs-pr`, `azure-docs-pr`, `dotnet/docs`, and any
  other repo that uses the same comment automation.
- **Configurable scope.** An options page (`storage`-backed and roaming via
  `chrome.storage.sync`) lets each person choose:
  - **All GitHub repositories** (default), or
  - **Only specific orgs or repos** — an allowlist such as `MicrosoftDocs` or
    `MicrosoftDocs/fabric-docs-pr`, one entry per line.
- **SPA-safe gating.** GitHub navigates between repos without full reloads, so
  the active-repo check runs on each keystroke and always reflects the current
  page.
- **One place to maintain commands.** When the official command set changes,
  edit `src/commands.js` only — the menu, options page, and README-style command
  list all read from it.

Open the options page from `edge://extensions` → the extension → **Details** →
**Extension options** (or right-click the toolbar icon → **Options**).

## Project structure

```text
docs-pr-hashtag-helper/
├── manifest.json        # MV3 extension manifest
├── src/
│   ├── commands.js      # Command definitions (single source of truth)
│   ├── config.js        # Settings + per-repo activation logic
│   ├── content.js       # Autocomplete logic injected into GitHub
│   └── content.css      # Dropdown styling
├── options/
│   ├── options.html     # Settings page (scope configuration)
│   ├── options.js
│   └── options.css
├── icons/               # Generated PNG icons (16/32/48/128)
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

1. Open any GitHub pull request or issue.
2. Click into a comment box (the **Write** tab, not **Preview**).
3. Type `#`. A dropdown of the supported commands appears.
4. Filter by typing (for example `#sign`), move with the Up/Down arrow keys, and
   press **Enter** or **Tab** to insert. Press **Esc** to dismiss.

> Tip: Don't submit test comments on a real docs PR — commands like `#sign-off`
> and `#please-close` trigger live automation. Just confirm the text inserts,
> then clear the box. To test end to end, use a throwaway PR in your own repo.
>
> [!IMPORTANT]
> The **sign-off to merge** and **hold-off merge** buttons submit their commands
> immediately. If the comment editor already contains a draft, that draft is
> submitted together with the command. Autocomplete selections remain
> insert-only and don't submit comments.

### Step 4 (optional) — Choose where it runs

1. On the extensions page, select **Details** on the card, then **Extension
   options**.
2. Choose **All GitHub repositories** (default) or **Only specific orgs or
   repositories** and list entries like `MicrosoftDocs` or
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
