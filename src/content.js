/**
 * Docs PR Hashtag Helper — content script.
 *
 * Injects an autocomplete dropdown into GitHub comment text areas. When the
 * token under the caret starts with "#", it offers the supported Microsoft
 * Learn PR hashtag commands.
 */
(function () {
  "use strict";

  const COMMANDS = window.DOCS_PR_COMMANDS || [];
  const CONFIG = window.DocsPRHelperConfig;
  const WORKFLOW = window.DocsPRWorkflow;
  const TRIGGER = /(^|\s)(#[a-z-]*)$/i;

  /** @type {HTMLTextAreaElement | null} */
  let activeField = null;
  let matches = [];
  let activeIndex = 0;
  let menu = null;
  let signOffSyncQueued = false;
  let workflowCommandOverride = null;
  let pendingPostedWorkflowCommand = null;
  let loadedWorkflowKey = null;
  let loadingWorkflowKey = null;
  let assignmentPicker = null;
  let assignmentPickerAction = "assign";
  let assignmentSearchTimer = null;
  let assignmentSearchController = null;
  let loadedAssignmentKey = null;
  let loadingAssignmentKey = null;
  let loadedReviewerKey = null;
  let loadingReviewerKey = null;
  const pendingAssignedUsers = new Map();
  const pendingUnassignedUsers = new Set();
  const pendingReviewers = new Map();
  const pendingUnassignedReviewers = new Set();

  // Current settings, refreshed live. Gating is evaluated per keystroke so it
  // stays correct as GitHub navigates between repos without a full reload.
  let settings = CONFIG ? CONFIG.DEFAULT_SETTINGS : { mode: "all" };
  if (CONFIG) {
    CONFIG.get().then((s) => {
      settings = s;
      queueSignOffSync();
    });
    CONFIG.onChange((s) => {
      settings = s;
      queueSignOffSync();
    });
  }

  /** True when the helper is allowed to run on the current repository. */
  function isActiveRepo() {
    if (!CONFIG) return true;
    return CONFIG.isEnabledFor(settings, CONFIG.currentRepo());
  }

  /**
   * Returns true if the element is a GitHub comment text area we should hook.
   * GitHub comment boxes are markdown <textarea> elements. We match on the
   * common class names / attributes GitHub uses across new-comment, review, and
   * edit surfaces, and fall back to any textarea whose accessible name mentions
   * a comment.
   */
  function isCommentField(el) {
    if (!el || el.tagName !== "TEXTAREA") return false;
    if (
      el.classList.contains("comment-form-textarea") ||
      el.classList.contains("js-comment-field") ||
      el.id === "new_comment_field" ||
      el.name === "comment[body]" ||
      el.name === "pull_request[body]" ||
      el.name === "issue[body]"
    ) {
      return true;
    }
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    return label.includes("comment") || label.includes("markdown value");
  }

  /** Builds (once) and returns the dropdown container element. */
  function getMenu() {
    if (menu) return menu;
    menu = document.createElement("div");
    menu.className = "docs-pr-hh-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    // Prevent the textarea from losing focus (and closing the menu) on click.
    menu.addEventListener("mousedown", (e) => e.preventDefault());
    document.body.appendChild(menu);
    return menu;
  }

  function hideMenu() {
    activeField = null;
    matches = [];
    activeIndex = 0;
    if (menu) menu.hidden = true;
  }

  /** Extracts the "#..." token immediately before the caret, if any. */
  function currentToken(field) {
    const upToCaret = field.value.slice(0, field.selectionStart);
    const m = upToCaret.match(TRIGGER);
    if (!m) return null;
    return { text: m[2], start: field.selectionStart - m[2].length };
  }

  function renderMenu() {
    const el = getMenu();
    el.innerHTML = "";
    matches.forEach((cmd, i) => {
      const item = document.createElement("div");
      item.className =
        "docs-pr-hh-item" + (i === activeIndex ? " is-active" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === activeIndex));

      const title = document.createElement("div");
      title.className = "docs-pr-hh-title";
      const code = document.createElement("span");
      code.className = "docs-pr-hh-command";
      code.textContent = cmd.display;
      const summary = document.createElement("span");
      summary.className = "docs-pr-hh-summary";
      summary.textContent = cmd.summary;
      title.appendChild(code);
      title.appendChild(summary);

      const desc = document.createElement("div");
      desc.className = "docs-pr-hh-desc";
      desc.textContent = cmd.description;

      item.appendChild(title);
      item.appendChild(desc);

      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        insertCommand(i);
      });
      el.appendChild(item);
    });
    el.hidden = false;
  }

  /**
   * Positions the menu relative to the caret. By default it opens ABOVE the
   * caret so it doesn't cover GitHub's own "#" issue/PR suggester, which opens
   * just below the caret — that way both lists stay fully visible. If there
   * isn't enough room above (near the top of the page), it falls back to below.
   */
  function positionMenu(field, tokenStart) {
    const el = getMenu();
    const coords = caretCoordinates(field, tokenStart);
    const rect = field.getBoundingClientRect();
    const caretTop = window.scrollY + rect.top + coords.top - field.scrollTop;
    const caretBottom = caretTop + coords.height;
    const left = window.scrollX + rect.left + coords.left - field.scrollLeft;

    const GAP = 6;
    const menuHeight = el.offsetHeight;
    let top = caretTop - menuHeight - GAP;
    if (top < window.scrollY + 8) {
      top = caretBottom + GAP;
    }
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  }

  function updateFor(field) {
    if (!isActiveRepo()) {
      hideMenu();
      return;
    }
    const token = currentToken(field);
    if (!token) {
      hideMenu();
      return;
    }
    const query = token.text.toLowerCase();
    // Match either direction so "#lab" finds "#label:" and "#sign" finds
    // "#sign-off", while a bare "#" lists everything.
    matches = COMMANDS.filter((c) => {
      const trigger = c.trigger.toLowerCase();
      return trigger.startsWith(query) || query.startsWith(trigger);
    });
    if (matches.length === 0) {
      hideMenu();
      return;
    }
    activeField = field;
    activeIndex = 0;
    renderMenu();
    positionMenu(field, token.start);
  }

  function insertCommand(index) {
    if (!activeField) return;
    const field = activeField;
    const token = currentToken(field);
    if (!token) {
      hideMenu();
      return;
    }
    const cmd = matches[index];
    if (!cmd) return;

    const before = field.value.slice(0, token.start);
    const after = field.value.slice(field.selectionStart);

    // "${CURSOR}" marks where the caret should land for commands that take an
    // argument (for example inside the quotes of #label:"").
    const CURSOR = "${CURSOR}";
    const cursorIndex = cmd.insert.indexOf(CURSOR);
    const insertText = cmd.insert.replace(CURSOR, "");
    const caret =
      cursorIndex >= 0
        ? before.length + cursorIndex
        : before.length + insertText.length;
    const newValue = before + insertText + after;

    setFieldValue(field, newValue, caret);
    hideMenu();
    field.focus();
  }

  /**
   * Sets a text area's value via the native setter and dispatches an input
   * event so any framework listeners (and GitHub's own draft handling) update.
   */
  function setFieldValue(field, value, caret) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;
    field.focus();
    setter.call(field, value);
    field.setSelectionRange(caret, caret);
    const inputEvent =
      typeof InputEvent === "function"
        ? new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertText",
            data: null
          })
        : new Event("input", { bubbles: true, composed: true });
    field.dispatchEvent(inputEvent);
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isPullRequestPage() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(
      window.location.pathname
    );
  }

  function findCommentField() {
    const fields = Array.from(document.querySelectorAll("textarea")).filter(
      isCommentField
    );
    return (
      fields.find(
        (field) => field.id === "new_comment_field" && field.offsetParent
      ) || fields.find((field) => field.offsetParent)
    );
  }

  function findAssigneesHeading() {
    return Array.from(
      document.querySelectorAll("summary, h2, h3, h4, [role='heading']")
    ).find((heading) => {
      if (!heading.offsetParent) return false;
      const copy = heading.cloneNode(true);
      copy
        .querySelectorAll(".docs-pr-hh-assign, .docs-pr-hh-unassign")
        .forEach((button) => button.remove());
      return /^assignees$/i.test(copy.textContent.trim());
    });
  }

  function assigneeSection(heading = findAssigneesHeading()) {
    return (
      heading &&
      (heading.closest(".discussion-sidebar-item") ||
        heading.closest("form[aria-label*='assignee' i]") ||
        heading.parentElement)
    );
  }

  function findReviewersHeading() {
    return Array.from(
      document.querySelectorAll("summary, h2, h3, h4, [role='heading']")
    ).find((heading) => {
      if (!heading.offsetParent) return false;
      const copy = heading.cloneNode(true);
      copy
        .querySelectorAll(
          ".docs-pr-hh-assign-reviewer, .docs-pr-hh-unassign-reviewer"
        )
        .forEach((button) => button.remove());
      return /^reviewers$/i.test(copy.textContent.trim());
    });
  }

  function reviewerSection(heading = findReviewersHeading()) {
    return (
      heading &&
      (heading.closest(".discussion-sidebar-item") ||
        heading.closest("form[aria-label*='reviewer' i]") ||
        heading.parentElement)
    );
  }

  function hideAssignmentPicker() {
    if (assignmentPicker) assignmentPicker.hidden = true;
    if (assignmentSearchController) assignmentSearchController.abort();
  }

  function assignmentPickerMessage(message) {
    const list = assignmentPicker.querySelector(".docs-pr-hh-user-list");
    list.replaceChildren();
    const item = document.createElement("div");
    item.className = "docs-pr-hh-user-message";
    item.textContent = message;
    list.appendChild(item);
  }

  function githubUsernameFromPath(path) {
    const match = String(path || "").match(/^\/([^/]+)\/?$/);
    return match && WORKFLOW.assignmentCommand("assign", match[1])
      ? match[1]
      : null;
  }

  async function searchGitHubUsers(query) {
    if (assignmentSearchController) assignmentSearchController.abort();
    assignmentSearchController = new AbortController();
    const response = await fetch(
      `/search?q=${encodeURIComponent(query)}&type=users`,
      {
        credentials: "same-origin",
        signal: assignmentSearchController.signal
      }
    );
    if (!response.ok) throw new Error(`GitHub search returned ${response.status}`);
    const html = await response.text();
    const result = new DOMParser().parseFromString(html, "text/html");
    const users = new Map();
    result.querySelectorAll(".search-title a[href]").forEach((link) => {
      const username = githubUsernameFromPath(link.getAttribute("href"));
      if (!username || users.has(username.toLowerCase())) return;
      users.set(username.toLowerCase(), username);
    });
    return Array.from(users.values()).slice(0, 10);
  }

  function renderAssignmentUsers(usernames) {
    const list = assignmentPicker.querySelector(".docs-pr-hh-user-list");
    list.replaceChildren();
    if (usernames.length === 0) {
      assignmentPickerMessage("No GitHub users found.");
      return;
    }
    usernames.forEach((username) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "docs-pr-hh-user-option";
      option.setAttribute("role", "option");
      option.textContent = `@${username}`;
      option.addEventListener("click", () => {
        hideAssignmentPicker();
        const reviewer = assignmentPickerAction === "assign-reviewer";
        postAssignmentCommand(
          document.querySelector(
            reviewer
              ? ".docs-pr-hh-assign-reviewer"
              : ".docs-pr-hh-assign"
          ),
          assignmentPickerAction,
          username
        );
      });
      list.appendChild(option);
    });
  }

  function getAssignmentPicker() {
    if (assignmentPicker) return assignmentPicker;
    assignmentPicker = document.createElement("div");
    assignmentPicker.className = "docs-pr-hh-assignment-picker";
    assignmentPicker.hidden = true;
    assignmentPicker.setAttribute("role", "dialog");
    assignmentPicker.setAttribute("aria-label", "Assign a GitHub user");

    const input = document.createElement("input");
    input.type = "search";
    input.className = "docs-pr-hh-user-search";
    input.placeholder = "Search GitHub users";
    input.setAttribute("aria-label", "Search GitHub users");
    input.addEventListener("input", () => {
      window.clearTimeout(assignmentSearchTimer);
      const query = input.value.trim();
      if (!query) {
        assignmentPickerMessage("Type a GitHub username.");
        return;
      }
      assignmentPickerMessage("Searching...");
      assignmentSearchTimer = window.setTimeout(async () => {
        try {
          renderAssignmentUsers(await searchGitHubUsers(query));
        } catch (error) {
          if (error.name !== "AbortError") {
            assignmentPickerMessage("GitHub user search failed.");
          }
        }
      }, 250);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideAssignmentPicker();
    });
    assignmentPicker.appendChild(input);

    const list = document.createElement("div");
    list.className = "docs-pr-hh-user-list";
    list.setAttribute("role", "listbox");
    assignmentPicker.appendChild(list);
    document.body.appendChild(assignmentPicker);
    assignmentPickerMessage("Type a GitHub username.");
    return assignmentPicker;
  }

  function showAssignmentPicker(button, action = "assign") {
    const picker = getAssignmentPicker();
    assignmentPickerAction = action;
    const reviewer = action === "assign-reviewer";
    picker.setAttribute(
      "aria-label",
      reviewer ? "Assign a GitHub reviewer" : "Assign a GitHub user"
    );
    picker.querySelector(".docs-pr-hh-user-search").placeholder = reviewer
      ? "Search GitHub reviewers"
      : "Search GitHub users";
    const rect = button.getBoundingClientRect();
    picker.style.top = `${window.scrollY + rect.bottom + 6}px`;
    picker.style.left = `${Math.max(
      8,
      Math.min(window.scrollX + rect.left, document.documentElement.clientWidth - 328)
    )}px`;
    picker.hidden = false;
    picker.querySelector(".docs-pr-hh-user-search").focus();
  }

  function assignedUsers(section) {
    const users = new Map();
    section
      .querySelectorAll(
        ".js-issue-assignees a[href^='/'], " +
          "a[href^='/'][data-hovercard-type='user'], " +
          "a[href^='/'][data-hovercard-url*='/users/']"
      )
      .forEach((link) => {
        if (
          link.closest(
            "details-menu, .select-menu-modal, .docs-pr-hh-assignment-picker"
          ) ||
          /assign yourself/i.test(link.textContent || "")
        ) {
          return;
        }
        const username = githubUsernameFromPath(link.getAttribute("href"));
        if (!username || users.has(username.toLowerCase())) return;
        const assignees = link.closest(".js-issue-assignees") || section;
        let host = link;
        while (
          host.parentElement &&
          host.parentElement !== assignees &&
          host.parentElement !== section
        ) {
          host = host.parentElement;
        }
        if (host.tagName === "A") host = assignees;
        host.classList.add("docs-pr-hh-assignee-row");
        users.set(username.toLowerCase(), {
          username,
          host
        });
      });
    return Array.from(users.values());
  }

  function reviewerUsers(section) {
    const users = new Map();
    section
      .querySelectorAll(
        ".js-issue-reviewers a[href^='/'], .js-reviewers a[href^='/'], " +
          "a[href^='/'][data-hovercard-type='user'], " +
          "a[href^='/'][data-hovercard-url*='/users/'], " +
          "img[alt^='@'], [data-login], [data-username]"
      )
      .forEach((identity) => {
        if (
          !identity.offsetParent ||
          identity.closest(
            "details-menu, .select-menu-modal, " +
              ".docs-pr-hh-assignment-picker, .docs-pr-hh-reviewer-action-row"
          )
        ) {
          return;
        }
        const hovercardUrl = identity.getAttribute("data-hovercard-url") || "";
        const username =
          identity.getAttribute("data-login") ||
          identity.getAttribute("data-username") ||
          (identity.tagName === "IMG"
            ? (identity.getAttribute("alt") || "").replace(/^@/, "")
            : null) ||
          githubUsernameFromPath(identity.getAttribute("href")) ||
          (hovercardUrl.match(/\/users\/([^/?]+)/) || [])[1];
        if (!username || users.has(username.toLowerCase())) {
          return;
        }
        const reviewers =
          identity.closest(".js-issue-reviewers, .js-reviewers") || section;
        let host = identity;
        while (
          host.parentElement &&
          host.parentElement !== reviewers &&
          host.parentElement !== section
        ) {
          host = host.parentElement;
          if (host.textContent.toLowerCase().includes(username.toLowerCase())) {
            break;
          }
        }
        if (
          WORKFLOW.isLearnBuildBot(username, host.textContent) ||
          !WORKFLOW.assignmentCommand("assign-reviewer", username)
        ) {
          return;
        }
        host.classList.add("docs-pr-hh-reviewer-row");
        users.set(username.toLowerCase(), { username, host });
      });
    return Array.from(users.values());
  }

  function assignmentActionHost(section, username) {
    const key = username.toLowerCase();
    let host = Array.from(
      section.querySelectorAll(".docs-pr-hh-assignment-action-row")
    ).find((item) => item.dataset.username.toLowerCase() === key);
    if (host) return host;

    host = document.createElement("span");
    host.className = "docs-pr-hh-assignment-action-row";
    host.dataset.username = username;
    const assignees = section.querySelector(".js-issue-assignees") || section;
    assignees.appendChild(host);
    return host;
  }

  function syncUnassignButtons(section) {
    const assigned = assignedUsers(section);
    const assignedNames = new Set(
      assigned.map(({ username }) => username.toLowerCase())
    );
    pendingUnassignedUsers.forEach((username) => {
      if (!assignedNames.has(username)) pendingUnassignedUsers.delete(username);
    });
    assigned.forEach(({ username, host }) => {
      const removing = pendingUnassignedUsers.has(username.toLowerCase());
      host.classList.toggle("docs-pr-hh-removing-assignee", removing);
      host.hidden = removing;
    });
    section
      .querySelectorAll(".docs-pr-hh-assignment-action-row")
      .forEach((host) => {
      const username = host.dataset.username.toLowerCase();
      if (
        !pendingAssignedUsers.has(username) ||
        assignedNames.has(username)
      ) {
        host.remove();
      }
    });
    const users = assigned
      .filter(
        ({ username }) =>
          !pendingUnassignedUsers.has(username.toLowerCase())
      )
      .concat(
        Array.from(pendingAssignedUsers.values())
          .filter((username) => !assignedNames.has(username.toLowerCase()))
          .map((username) => ({
            username,
            host: assignmentActionHost(section, username)
          }))
      );
    const current = new Set(users.map(({ username }) => username.toLowerCase()));
    section.querySelectorAll(".docs-pr-hh-unassign").forEach((button) => {
      if (!current.has(button.dataset.username.toLowerCase())) button.remove();
    });
    const existing = new Set(
      Array.from(section.querySelectorAll(".docs-pr-hh-unassign")).map(
        (button) => button.dataset.username.toLowerCase()
      )
    );
    users.forEach(({ username, host }) => {
      if (existing.has(username.toLowerCase())) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "docs-pr-hh-unassign";
      button.dataset.username = username;
      button.textContent = "×";
      button.title = `Unassign @${username}`;
      button.setAttribute("aria-label", `Unassign @${username}`);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        postAssignmentCommand(button, "unassign", username);
      });
      host.appendChild(button);
    });
  }

  function syncAssignButton() {
    const existing = document.querySelector(".docs-pr-hh-assign");
    const heading = findAssigneesHeading();
    const section = assigneeSection(heading);
    if (!heading || !section) {
      if (existing) existing.remove();
      hideAssignmentPicker();
      return;
    }
    ensureAssignmentStateLoaded();

    if (existing) {
      if (existing.parentElement !== heading) heading.appendChild(existing);
      syncUnassignButtons(section);
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "docs-pr-hh-assign";
    button.textContent = "Assign";
    button.title = "Assign with a PRMerger hashtag comment";
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (assignmentPicker && !assignmentPicker.hidden) {
        hideAssignmentPicker();
      } else {
        showAssignmentPicker(button);
      }
    });
    heading.appendChild(button);
    syncUnassignButtons(section);
  }

  function reviewerActionHost(section, username) {
    const key = username.toLowerCase();
    let host = Array.from(
      section.querySelectorAll(".docs-pr-hh-reviewer-action-row")
    ).find((item) => item.dataset.username.toLowerCase() === key);
    if (host) return host;

    host = document.createElement("span");
    host.className =
      "docs-pr-hh-reviewer-row docs-pr-hh-reviewer-action-row";
    host.dataset.username = username;

    const name = document.createElement("span");
    name.className = "docs-pr-hh-reviewer-name";
    name.textContent = `@${username}`;
    host.appendChild(name);

    const reviewers =
      section.querySelector(".js-issue-reviewers, .js-reviewers") || section;
    reviewers.appendChild(host);
    return host;
  }

  function syncUnassignReviewerButtons(section) {
    const assigned = reviewerUsers(section);
    const assignedNames = new Set(
      assigned.map(({ username }) => username.toLowerCase())
    );
    pendingUnassignedReviewers.forEach((username) => {
      if (!assignedNames.has(username)) pendingUnassignedReviewers.delete(username);
    });
    assigned.forEach(({ username, host }) => {
      const removing = pendingUnassignedReviewers.has(username.toLowerCase());
      host.classList.toggle("docs-pr-hh-removing-reviewer", removing);
      host.hidden = removing;
    });
    section.querySelectorAll(".docs-pr-hh-reviewer-action-row").forEach((host) => {
      const username = host.dataset.username.toLowerCase();
      if (!pendingReviewers.has(username) || assignedNames.has(username)) {
        host.remove();
      }
    });
    const users = assigned
      .filter(
        ({ username }) =>
          !pendingUnassignedReviewers.has(username.toLowerCase())
      )
      .concat(
        Array.from(pendingReviewers.values())
          .filter((username) => !assignedNames.has(username.toLowerCase()))
          .map((username) => ({
            username,
            host: reviewerActionHost(section, username)
          }))
      );
    const noReviews = Array.from(section.querySelectorAll("span")).find(
      (item) => item.textContent.trim() === "No reviews"
    );
    if (noReviews) noReviews.hidden = users.length > 0;
    const current = new Set(users.map(({ username }) => username.toLowerCase()));
    section.querySelectorAll(".docs-pr-hh-unassign-reviewer").forEach((button) => {
      if (!current.has(button.dataset.username.toLowerCase())) button.remove();
    });
    const existing = new Set(
      Array.from(section.querySelectorAll(".docs-pr-hh-unassign-reviewer")).map(
        (button) => button.dataset.username.toLowerCase()
      )
    );
    users.forEach(({ username, host }) => {
      if (existing.has(username.toLowerCase())) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "docs-pr-hh-unassign-reviewer";
      button.dataset.username = username;
      button.textContent = "×";
      button.title = `Unassign reviewer @${username}`;
      button.setAttribute("aria-label", `Unassign reviewer @${username}`);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        postAssignmentCommand(button, "unassign-reviewer", username);
      });
      host.appendChild(button);
    });
  }

  function syncReviewerButton() {
    const existing = document.querySelector(".docs-pr-hh-assign-reviewer");
    const heading = findReviewersHeading();
    const section = reviewerSection(heading);
    if (!heading || !section) {
      if (existing) existing.remove();
      return;
    }
    ensureReviewerStateLoaded();
    if (existing) {
      if (existing.parentElement !== heading) heading.appendChild(existing);
      syncUnassignReviewerButtons(section);
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "docs-pr-hh-assign-reviewer";
    button.textContent = "Assign";
    button.title = "Assign a reviewer with a PRMerger hashtag comment";
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (assignmentPicker && !assignmentPicker.hidden) {
        hideAssignmentPicker();
      } else {
        showAssignmentPicker(button, "assign-reviewer");
      }
    });
    heading.appendChild(button);
    syncUnassignReviewerButtons(section);
  }

  function announceSignOffStatus(button, message) {
    const status = button.parentElement.querySelector(
      ".docs-pr-hh-sign-off-status"
    );
    if (!status) return;
    status.textContent = message;
    window.setTimeout(() => (status.textContent = ""), 2500);
  }

  function hasReadyToMergeLabel() {
    const labels = document.querySelectorAll(
      ".IssueLabel, [data-testid='issue-label'], a[href*='/labels/']"
    );
    return Array.from(labels).some(
      (label) => label.textContent.trim().toLowerCase() === "ready-to-merge"
    );
  }

  function currentPullRequestKey() {
    const match = window.location.pathname.match(
      /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/
    );
    return match
      ? `${match[1].toLowerCase()}/${match[2].toLowerCase()}#${match[3]}`
      : null;
  }

  function ensureAssignmentStateLoaded() {
    const prKey = currentPullRequestKey();
    if (!prKey || !CONFIG || !CONFIG.getAssignmentState) return;
    if (loadedAssignmentKey === prKey || loadingAssignmentKey === prKey) return;

    loadingAssignmentKey = prKey;
    CONFIG.getAssignmentState(prKey).then((state) => {
      if (currentPullRequestKey() === prKey) {
        pendingAssignedUsers.clear();
        pendingUnassignedUsers.clear();
        (state?.assignedUsers || []).forEach((username) =>
          pendingAssignedUsers.set(username.toLowerCase(), username)
        );
        (state?.unassignedUsers || []).forEach((username) =>
          pendingUnassignedUsers.add(username.toLowerCase())
        );
        loadedAssignmentKey = prKey;
        queueSignOffSync();
      }
      loadingAssignmentKey = null;
    });
  }

  function persistAssignmentState() {
    const prKey = currentPullRequestKey();
    if (!prKey || !CONFIG || !CONFIG.setAssignmentState) return;
    CONFIG.setAssignmentState(
      prKey,
      Array.from(pendingAssignedUsers.values()),
      Array.from(pendingUnassignedUsers.values())
    );
  }

  function ensureReviewerStateLoaded() {
    const prKey = currentPullRequestKey();
    if (!prKey || !CONFIG || !CONFIG.getReviewerState) return;
    if (loadedReviewerKey === prKey || loadingReviewerKey === prKey) return;

    loadingReviewerKey = prKey;
    CONFIG.getReviewerState(prKey).then((state) => {
      if (currentPullRequestKey() === prKey) {
        pendingReviewers.clear();
        pendingUnassignedReviewers.clear();
        (state?.assignedUsers || []).forEach((username) =>
          pendingReviewers.set(username.toLowerCase(), username)
        );
        (state?.unassignedUsers || []).forEach((username) =>
          pendingUnassignedReviewers.add(username.toLowerCase())
        );
        loadedReviewerKey = prKey;
        queueSignOffSync();
      }
      loadingReviewerKey = null;
    });
  }

  function persistReviewerState() {
    const prKey = currentPullRequestKey();
    if (!prKey || !CONFIG || !CONFIG.setReviewerState) return;
    CONFIG.setReviewerState(
      prKey,
      Array.from(pendingReviewers.values()),
      Array.from(pendingUnassignedReviewers.values())
    );
  }

  function ensureWorkflowStateLoaded() {
    const prKey = currentPullRequestKey();
    if (!prKey || !CONFIG || !CONFIG.getWorkflowCommand) return true;
    if (loadedWorkflowKey === prKey) return true;
    if (loadingWorkflowKey === prKey) return false;

    loadingWorkflowKey = prKey;
    CONFIG.getWorkflowCommand(prKey).then((state) => {
      if (currentPullRequestKey() === prKey) {
        workflowCommandOverride = state && state.command;
        pendingPostedWorkflowCommand = state && state.postedCommand;
        loadedWorkflowKey = prKey;
      }
      loadingWorkflowKey = null;
      queueSignOffSync();
    });
    return false;
  }

  function persistWorkflowCommand(command, postedCommand = null) {
    const prKey = currentPullRequestKey();
    if (CONFIG && CONFIG.setWorkflowCommand && prKey) {
      CONFIG.setWorkflowCommand(prKey, command, postedCommand).catch(() => {});
    }
  }

  function findAllChecksPassedStatus() {
    const checkRegions = document.querySelectorAll(
      "[data-testid*='check' i], " +
        "[aria-label*='check' i], " +
        "[class*='check' i], " +
        "#partial-pull-merging, " +
        ".js-pull-merging, " +
        ".merge-message, " +
        ".merge-status-list, " +
        ".branch-action-body"
    );
    for (const region of checkRegions) {
      if (!region.offsetParent) continue;
      const elements = [...region.querySelectorAll("*"), region];
      const status = elements.find((element) =>
        WORKFLOW.isPassedChecksText(
          element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            element.textContent
        )
      );
      if (status) return status;
    }
    return null;
  }

  function latestPostedWorkflowCommand() {
    const commentBodies = Array.from(
      document.querySelectorAll(
        ".timeline-comment .js-comment-body, " +
          ".timeline-comment .comment-body, " +
          ".timeline-comment .markdown-body, " +
          "[data-testid='comment-body']"
      )
    ).filter(
      (body) =>
        !body.parentElement ||
        !body.parentElement.closest(".docs-pr-hh-sign-off-row")
    );
    return WORKFLOW.latestWorkflowCommand(
      commentBodies.map((body) => body.textContent)
    );
  }

  function currentWorkflowCommand() {
    const postedCommand = latestPostedWorkflowCommand();
    if (workflowCommandOverride && pendingPostedWorkflowCommand) {
      if (postedCommand === pendingPostedWorkflowCommand) {
        const command = WORKFLOW.nextWorkflowCommand(postedCommand);
        workflowCommandOverride = null;
        pendingPostedWorkflowCommand = null;
        persistWorkflowCommand(null);
        return command;
      }
      return workflowCommandOverride;
    }

    if (postedCommand) {
      if (workflowCommandOverride) {
        workflowCommandOverride = null;
        pendingPostedWorkflowCommand = null;
        persistWorkflowCommand(null);
      }
      return WORKFLOW.commandForLatestComment(postedCommand);
    }

    if (workflowCommandOverride) {
      workflowCommandOverride = null;
      pendingPostedWorkflowCommand = null;
      persistWorkflowCommand(null);
    }
    return WORKFLOW.commandForLatestComment(null);
  }

  function updateSignOffButtonState(button) {
    const command = currentWorkflowCommand();
    const isHoldOff = command === "#hold-off";
    button.disabled = false;
    button.textContent = isHoldOff ? "hold-off merge" : "sign-off to merge";
    button.dataset.command = command;
    button.classList.toggle("is-hold-off", isHoldOff);
    button.title = `Post ${command} as a PR comment`;
    button.setAttribute("aria-label", button.title);
  }

  function findCommentSubmitButton(field) {
    const form = field.form || field.closest("form");
    if (!form) return null;
    const buttons = Array.from(form.querySelectorAll("button[type='submit']"));
    return buttons.find((candidate) => {
      if (candidate.disabled || candidate.hidden || !candidate.offsetParent) {
        return false;
      }
      const label = (
        candidate.textContent ||
        candidate.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .toLowerCase();
      return label === "comment" || label === "add comment";
    });
  }

  function submitCommentWhenReady(field, button, command, attemptsLeft = 20) {
    const submitButton = findCommentSubmitButton(field);
    if (submitButton) {
      submitButton.click();
      workflowCommandOverride = WORKFLOW.nextWorkflowCommand(command);
      pendingPostedWorkflowCommand = command;
      persistWorkflowCommand(workflowCommandOverride, command);
      updateSignOffButtonState(button);
      announceSignOffStatus(button, `Posted ${command}.`);
      return;
    }
    if (attemptsLeft > 0) {
      window.setTimeout(
        () => submitCommentWhenReady(field, button, command, attemptsLeft - 1),
        50
      );
      return;
    }
    updateSignOffButtonState(button);
    announceSignOffStatus(button, "Could not find GitHub's Comment button.");
  }

  function announceAssignmentStatus(button, message) {
    let status = document.querySelector(".docs-pr-hh-assignment-status");
    if (!status) {
      status = document.createElement("span");
      status.className = "docs-pr-hh-assignment-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      document.body.appendChild(status);
    }
    status.textContent = message;
    if (button) button.title = message;
    window.setTimeout(() => (status.textContent = ""), 2500);
  }

  function submitAssignmentWhenReady(
    field,
    button,
    command,
    onSubmitted,
    attemptsLeft = 20
  ) {
    const submitButton = findCommentSubmitButton(field);
    if (submitButton) {
      submitButton.click();
      onSubmitted();
      announceAssignmentStatus(button, `Posted ${command}.`);
      return;
    }
    if (attemptsLeft > 0) {
      window.setTimeout(
        () =>
          submitAssignmentWhenReady(
            field,
            button,
            command,
            onSubmitted,
            attemptsLeft - 1
          ),
        50
      );
      return;
    }
    announceAssignmentStatus(button, "Could not find GitHub's Comment button.");
  }

  function postAssignmentCommand(button, action, username) {
    const command = WORKFLOW.assignmentCommand(action, username);
    const field = findCommentField();
    if (!command || !field) {
      announceAssignmentStatus(button, "Open the Write tab first.");
      return;
    }

    const before = field.value;
    const separator = before && !before.endsWith("\n") ? "\n" : "";
    const value = before + separator + command;
    setFieldValue(field, value, value.length);
    announceAssignmentStatus(button, `Posting ${command}...`);
    submitAssignmentWhenReady(field, button, command, () => {
      const key = username.toLowerCase();
      if (action === "assign-reviewer") {
        pendingUnassignedReviewers.delete(key);
        pendingReviewers.set(key, username);
        persistReviewerState();
        const section = reviewerSection();
        if (section) syncUnassignReviewerButtons(section);
      } else if (action === "unassign-reviewer") {
        pendingReviewers.delete(key);
        pendingUnassignedReviewers.add(key);
        persistReviewerState();
        const section = reviewerSection();
        if (section) syncUnassignReviewerButtons(section);
      } else if (action === "assign") {
        pendingUnassignedUsers.delete(key);
        pendingAssignedUsers.set(key, username);
        persistAssignmentState();
        const section = assigneeSection();
        if (section) syncUnassignButtons(section);
      } else if (action === "unassign") {
        pendingAssignedUsers.delete(key);
        pendingUnassignedUsers.add(key);
        persistAssignmentState();
        const section = assigneeSection();
        if (section) syncUnassignButtons(section);
      }
    });
  }

  function postWorkflowComment(button) {
    const field = findCommentField();
    if (!field) {
      announceSignOffStatus(button, "Open the Write tab first.");
      return;
    }

    const trigger = currentWorkflowCommand();
    const command = COMMANDS.find((item) => item.trigger === trigger);
    const insertText = command ? command.insert.trimEnd() : trigger;
    if (WORKFLOW.containsCommand(field.value, trigger)) {
      field.focus();
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      announceSignOffStatus(button, `${trigger} is already in the comment.`);
      return;
    }

    const before = field.value;
    const separator = before && !before.endsWith("\n") ? "\n" : "";
    const value = before + separator + insertText;
    const caret = before.length + separator.length + insertText.length;

    setFieldValue(field, value, caret);
    announceSignOffStatus(button, `Posting ${trigger}...`);
    submitCommentWhenReady(field, button, trigger);
  }

  function findWorkflowButtonHost() {
    const selectors = [
      "[data-testid='merge-box']",
      "#partial-pull-merging",
      ".js-pull-merging",
      ".merge-message"
    ];
    const mergeStatus = selectors
      .map((selector) => document.querySelector(selector))
      .find((element) => element && element.offsetParent);
    if (mergeStatus) return mergeStatus;

    const mergeHeading = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, [role='heading']")
    ).find((heading) =>
      /^(merging is blocked|ready to merge|this branch has no conflicts)/i.test(
        heading.textContent.trim()
      )
    );
    if (mergeHeading && mergeHeading.parentElement) {
      return mergeHeading.parentElement;
    }

    const field = findCommentField();
    const form = field && (field.form || field.closest("form"));
    return form && form.offsetParent ? form : null;
  }

  function findMergeBlockedHeading() {
    return Array.from(
      document.querySelectorAll("h1, h2, h3, h4, [role='heading']")
    ).find((heading) => {
      if (!heading.offsetParent) return false;
      const copy = heading.cloneNode(true);
      copy.querySelectorAll(".docs-pr-hh-sign-off-row").forEach((row) =>
        row.remove()
      );
      return /^merging is blocked$/i.test(copy.textContent.trim());
    });
  }

  function findChecksSummaryPlacement(checksPassedStatus) {
    let current = checksPassedStatus.parentElement;
    for (let depth = 0; current && depth < 5; depth += 1) {
      const toggle = Array.from(current.querySelectorAll("button")).find(
        (button) =>
          button.offsetParent &&
          (button.hasAttribute("aria-expanded") ||
            /checks|expand|collapse/i.test(
              button.getAttribute("aria-label") || ""
            ))
      );
      if (toggle) return { container: current, before: toggle };
      current = current.parentElement;
    }
    return null;
  }

  function placeWorkflowButtonRow(row, checksPassedStatus) {
    const mergeBlockedHeading = findMergeBlockedHeading();
    if (mergeBlockedHeading) {
      if (row.parentElement !== mergeBlockedHeading) {
        mergeBlockedHeading.appendChild(row);
      }
      row.classList.remove("is-next-to-checks");
      row.classList.add("is-next-to-merge-status");
      return true;
    }

    if (checksPassedStatus) {
      const placement = findChecksSummaryPlacement(checksPassedStatus);
      if (placement) {
        if (
          row.parentElement !== placement.container ||
          row.nextElementSibling !== placement.before
        ) {
          placement.container.insertBefore(row, placement.before);
        }
      } else if (checksPassedStatus.nextElementSibling !== row) {
        checksPassedStatus.insertAdjacentElement("afterend", row);
      }
      row.classList.remove("is-next-to-merge-status");
      row.classList.add("is-next-to-checks");
      return true;
    }

    const host = findWorkflowButtonHost();
    if (!host) return false;
    if (row.parentElement !== host || host.firstElementChild !== row) {
      host.insertBefore(row, host.firstChild);
    }
    row.classList.remove("is-next-to-merge-status");
    row.classList.remove("is-next-to-checks");
    return true;
  }

  function syncSignOffButton() {
    signOffSyncQueued = false;
    const existing = document.querySelector(".docs-pr-hh-sign-off");
    if (!isPullRequestPage() || !isActiveRepo()) {
      if (existing) existing.closest(".docs-pr-hh-sign-off-row").remove();
      const assignButton = document.querySelector(".docs-pr-hh-assign");
      if (assignButton) assignButton.remove();
      const reviewerButton = document.querySelector(
        ".docs-pr-hh-assign-reviewer"
      );
      if (reviewerButton) reviewerButton.remove();
      return;
    }
    syncAssignButton();
    syncReviewerButton();
    if (!ensureWorkflowStateLoaded()) return;

    const readyToMerge = hasReadyToMergeLabel();
    const checksPassedStatus = findAllChecksPassedStatus();
    if (
      !WORKFLOW.shouldShowWorkflowButton(
        readyToMerge,
        Boolean(checksPassedStatus)
      )
    ) {
      if (existing) existing.closest(".docs-pr-hh-sign-off-row").remove();
      return;
    }
    if (existing) {
      updateSignOffButtonState(existing);
      placeWorkflowButtonRow(
        existing.closest(".docs-pr-hh-sign-off-row"),
        checksPassedStatus
      );
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "docs-pr-hh-sign-off";
    button.textContent = "sign-off to merge";
    button.title = "Post #sign-off as a PR comment";
    button.setAttribute("aria-label", "Post #sign-off as a PR comment");
    button.addEventListener("click", () => postWorkflowComment(button));

    const row = document.createElement("span");
    row.className = "docs-pr-hh-sign-off-row";
    row.appendChild(button);

    const status = document.createElement("span");
    status.className = "docs-pr-hh-sign-off-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    row.appendChild(status);
    if (!placeWorkflowButtonRow(row, checksPassedStatus)) return;
    updateSignOffButtonState(button);
  }

  function queueSignOffSync() {
    if (signOffSyncQueued) return;
    signOffSyncQueued = true;
    window.requestAnimationFrame(syncSignOffButton);
  }

  // --- Event wiring (delegated at the document level) ---

  document.addEventListener("input", (e) => {
    const target = e.target;
    if (isCommentField(target)) {
      updateFor(target);
      queueSignOffSync();
    }
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (!activeField || getMenu().hidden) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          activeIndex = (activeIndex + 1) % matches.length;
          renderMenu();
          break;
        case "ArrowUp":
          e.preventDefault();
          activeIndex = (activeIndex - 1 + matches.length) % matches.length;
          renderMenu();
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          e.stopPropagation();
          insertCommand(activeIndex);
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          hideMenu();
          break;
        default:
          break;
      }
    },
    true
  );

  document.addEventListener("focusout", (e) => {
    if (e.target === activeField) hideMenu();
  });
  document.addEventListener("click", (event) => {
    if (
      assignmentPicker &&
      !assignmentPicker.hidden &&
      !assignmentPicker.contains(event.target) &&
      !event.target.closest(".docs-pr-hh-assign")
    ) {
      hideAssignmentPicker();
    }
  });
  // Keep the menu aligned to the caret while the page (or text area) scrolls,
  // instead of closing it. Scroll events from inside the menu are ignored so
  // its own list stays scrollable. If the caret is no longer on a command
  // token, close the menu.
  window.addEventListener(
    "scroll",
    (e) => {
      const target = e.target;
      if (
        menu &&
        target instanceof Node &&
        (target === menu || menu.contains(target))
      ) {
        return;
      }
      if (!activeField || getMenu().hidden) return;
      const token = currentToken(activeField);
      if (!token) {
        hideMenu();
        return;
      }
      positionMenu(activeField, token.start);
    },
    true
  );

  const pageObserver = new MutationObserver(queueSignOffSync);
  pageObserver.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("turbo:load", queueSignOffSync);
  queueSignOffSync();

  /**
   * Computes the pixel coordinates of a caret position within a text area by
   * mirroring its content and styles in a hidden div (standard technique).
   */
  function caretCoordinates(field, position) {
    const div = document.createElement("div");
    const style = div.style;
    const computed = window.getComputedStyle(field);

    style.position = "absolute";
    style.visibility = "hidden";
    style.whiteSpace = "pre-wrap";
    style.wordWrap = "break-word";
    style.overflow = "hidden";

    const props = [
      "boxSizing",
      "width",
      "height",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "fontStyle",
      "fontVariant",
      "fontWeight",
      "fontStretch",
      "fontSize",
      "fontFamily",
      "lineHeight",
      "letterSpacing",
      "textTransform",
      "textIndent"
    ];
    props.forEach((p) => {
      style[p] = computed[p];
    });

    div.textContent = field.value.slice(0, position);
    const span = document.createElement("span");
    span.textContent = field.value.slice(position) || ".";
    div.appendChild(span);

    document.body.appendChild(div);
    const coords = {
      top: span.offsetTop,
      left: span.offsetLeft,
      height: parseInt(computed.lineHeight, 10) || parseInt(computed.fontSize, 10)
    };
    document.body.removeChild(div);
    return coords;
  }
})();
