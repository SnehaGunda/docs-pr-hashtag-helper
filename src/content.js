/** Docs PR Hashtag Helper content script. */
(function () {
  "use strict";

  const CONFIG = window.DocsPRHelperConfig;
  const WORKFLOW = window.DocsPRWorkflow;
  let signOffSyncQueued = false;
  let workflowCommandOverride = null;
  let pendingPostedWorkflowCommand = null;
  let reopenRequested = false;
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
  let labelPicker = null;
  let labelPickerRepository = null;
  let labelPickerController = null;
  let labelPickerReturnFocus = null;
  let loadedLabelKey = null;
  let loadingLabelKey = null;
  let lastEligibilityLog = null;
  const pendingAssignedUsers = new Map();
  const pendingUnassignedUsers = new Set();
  const pendingReviewers = new Map();
  const pendingUnassignedReviewers = new Set();
  const pendingAddedLabels = new Map();
  const pendingRemovedLabels = new Set();
  const selectedRepositoryLabels = new Map();
  const repositoryLabelCache = new Map();

  // Current settings, refreshed live so GitHub navigation between repositories
  // stays correctly gated without a full page reload.
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
    if (!CONFIG) {
      const decision = {
        enabled: true,
        reason: "configuration unavailable; failing open",
        repository: null,
        path: window.location.pathname,
        labels: []
      };
      const serializedDecision = JSON.stringify(decision);
      if (serializedDecision !== lastEligibilityLog) {
        console.info("[Docs PR Hashtag Helper] Eligibility", decision);
        lastEligibilityLog = serializedDecision;
      }
      return true;
    }

    const repo = CONFIG && CONFIG.currentRepo();
    const scopeEnabled = CONFIG.isEnabledFor(settings, repo);
    const pullRequestPage = isPullRequestPage();
    const labels = pullRequestPage ? currentPullRequestLabels() : [];
    const prMergerLabelPresent = WORKFLOW.hasPRMergerLabel(labels);
    const enabled = scopeEnabled && pullRequestPage && prMergerLabelPresent;
    const reason = !scopeEnabled
      ? "repository excluded by settings"
      : !pullRequestPage
        ? "not a pull request page"
        : !prMergerLabelPresent
          ? "PRMerger label not present"
          : "eligible pull request";
    const decision = {
      enabled,
      reason,
      repository: repo ? repo.full : null,
      path: window.location.pathname,
      labels: labels.filter((label) =>
        ["do-not-merge", "ready-to-merge"].includes(label.toLowerCase())
      )
    };
    const serializedDecision = JSON.stringify(decision);
    if (serializedDecision !== lastEligibilityLog) {
      console.info("[Docs PR Hashtag Helper] Eligibility", decision);
      lastEligibilityLog = serializedDecision;
    }
    return enabled;
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

  /**
   * Sets a text area's value via the native setter and dispatches an input
   * event so any framework listeners (and GitHub's own draft handling) update.
   */
  function setFieldValue(field, value, caret, focus = true) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;
    if (focus) field.focus({ preventScroll: true });
    setter.call(field, value);
    if (focus) field.setSelectionRange(caret, caret);
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

  function findLabelsHeading() {
    return Array.from(
      document.querySelectorAll("summary, h2, h3, h4, [role='heading']")
    ).find((heading) => {
      if (!heading.offsetParent) return false;
      const copy = heading.cloneNode(true);
      copy
        .querySelectorAll(".docs-pr-hh-add-label, .docs-pr-hh-remove-label")
        .forEach((button) => button.remove());
      return /^labels$/i.test(copy.textContent.trim());
    });
  }

  function labelsSection(heading = findLabelsHeading()) {
    return (
      heading &&
      (heading.closest(".discussion-sidebar-item") ||
        heading.closest("form[aria-label*='label' i]") ||
        heading.parentElement)
    );
  }

  function hideLabelPicker(restoreFocus = true) {
    const returnFocus = labelPickerReturnFocus;
    if (labelPicker) {
      labelPicker.hidden = true;
      const custom = labelPicker.querySelector(".docs-pr-hh-custom-label-row");
      const customToggle = labelPicker.querySelector(
        ".docs-pr-hh-custom-label-toggle"
      );
      if (custom) custom.hidden = true;
      if (customToggle) customToggle.setAttribute("aria-expanded", "false");
    }
    selectedRepositoryLabels.clear();
    labelPickerReturnFocus = null;
    const button = document.querySelector(".docs-pr-hh-add-label");
    if (button) button.setAttribute("aria-expanded", "false");
    if (restoreFocus && returnFocus?.isConnected) {
      returnFocus.focus({ preventScroll: true });
    }
  }

  function labelPickerOptions() {
    return Array.from(
      labelPicker.querySelectorAll(".docs-pr-hh-label-option")
    );
  }

  function updateLabelPickerApplyButton() {
    const apply = labelPicker.querySelector(".docs-pr-hh-label-apply");
    const count = selectedRepositoryLabels.size;
    apply.disabled = count === 0;
    apply.textContent = count ? `Apply (${count})` : "Apply";
  }

  function toggleRepositoryLabel(option, name) {
    const key = name.toLowerCase();
    const selected = !selectedRepositoryLabels.has(key);
    if (selected) selectedRepositoryLabels.set(key, name);
    else selectedRepositoryLabels.delete(key);
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-selected", String(selected));
    updateLabelPickerApplyButton();
  }

  function handleLabelPickerKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      hideLabelPicker();
      return;
    }
    const search = event.target.closest(".docs-pr-hh-label-search");
    const option = event.target.closest(".docs-pr-hh-label-option");
    if (!search && !option) return;
    const options = labelPickerOptions();
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const nextIndex = WORKFLOW.nextPickerOptionIndex(
        options.indexOf(option),
        options.length,
        event.key
      );
      if (nextIndex >= 0) options[nextIndex].focus();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = option || options[0];
      if (target) {
        target.click();
        target.focus();
      }
    }
  }

  function parseRepositoryLabels(html) {
    const page = new DOMParser().parseFromString(html, "text/html");
    const labels = new Map();
    page.querySelectorAll("[style*='--label-r']").forEach((token) => {
      const link = token.closest("a[aria-label]");
      const name = link && link.getAttribute("aria-label").trim();
      const color = WORKFLOW.labelColorFromStyle(token.getAttribute("style"));
      if (!name || !color || labels.has(name.toLowerCase())) return;
      labels.set(name.toLowerCase(), { name, color });
    });
    const next = page.querySelector(
      '[data-component="Pagination.NextPage"][rel="next"][href]'
    );
    return { labels: Array.from(labels.values()), next: next?.getAttribute("href") };
  }

  async function fetchRepositoryLabels(repo) {
    if (labelPickerController) labelPickerController.abort();
    labelPickerController = new AbortController();
    const labels = new Map();
    let path = `/${repo.owner}/${repo.repo}/labels`;
    for (let page = 0; path && page < 10; page += 1) {
      const response = await fetch(path, {
        credentials: "same-origin",
        signal: labelPickerController.signal
      });
      if (!response.ok) throw new Error(`GitHub labels returned ${response.status}`);
      const parsed = parseRepositoryLabels(await response.text());
      parsed.labels.forEach((label) => labels.set(label.name.toLowerCase(), label));
      if (!parsed.next) break;
      const next = new URL(parsed.next, window.location.origin);
      path =
        next.origin === window.location.origin &&
        next.pathname === `/${repo.owner}/${repo.repo}/labels`
          ? `${next.pathname}${next.search}`
          : null;
    }
    return Array.from(labels.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }

  function renderRepositoryLabels(labels, query = "") {
    const list = labelPicker.querySelector(".docs-pr-hh-label-list");
    list.replaceChildren();
    const selected = new Set(
      currentPullRequestLabels()
        .concat(Array.from(pendingAddedLabels.values()))
        .map((name) => name.toLowerCase())
    );
    const matches = labels.filter(
      ({ name }) =>
        !selected.has(name.toLowerCase()) &&
        name.toLowerCase().includes(query.trim().toLowerCase())
    );
    if (matches.length === 0) {
      const message = document.createElement("div");
      message.className = "docs-pr-hh-label-message";
      message.textContent = query ? "No matching labels." : "No labels available.";
      list.appendChild(message);
      return;
    }
    matches.forEach(({ name, color }) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "docs-pr-hh-label-option";
      option.setAttribute("role", "option");
      option.dataset.label = name;
      const selected = selectedRepositoryLabels.has(name.toLowerCase());
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-selected", String(selected));
      const swatch = document.createElement("span");
      swatch.className = "docs-pr-hh-label-swatch";
      swatch.style.backgroundColor = color;
      swatch.setAttribute("aria-hidden", "true");
      option.appendChild(swatch);
      const text = document.createElement("span");
      text.textContent = name;
      option.appendChild(text);
      const indicator = document.createElement("span");
      indicator.className = "docs-pr-hh-label-selected-indicator";
      indicator.setAttribute("aria-hidden", "true");
      indicator.textContent = "✓";
      option.appendChild(indicator);
      option.addEventListener("click", () =>
        toggleRepositoryLabel(option, name)
      );
      list.appendChild(option);
    });
    updateLabelPickerApplyButton();
  }

  function getLabelPicker() {
    if (labelPicker) return labelPicker;
    labelPicker = document.createElement("div");
    labelPicker.className = "docs-pr-hh-label-picker";
    labelPicker.hidden = true;
    labelPicker.setAttribute("role", "dialog");
    labelPicker.setAttribute("aria-label", "Add a label");
    labelPicker.addEventListener("keydown", handleLabelPickerKeydown);

    const search = document.createElement("input");
    search.type = "search";
    search.className = "docs-pr-hh-label-search";
    search.placeholder = "Filter labels";
    search.setAttribute("aria-label", "Filter repository labels");
    search.addEventListener("input", () =>
      renderRepositoryLabels(
        repositoryLabelCache.get(labelPickerRepository) || [],
        search.value
      )
    );
    labelPicker.appendChild(search);

    const list = document.createElement("div");
    list.className = "docs-pr-hh-label-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-multiselectable", "true");
    labelPicker.appendChild(list);

    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "docs-pr-hh-label-apply";
    apply.textContent = "Apply";
    apply.disabled = true;
    apply.addEventListener("click", () => {
      const labels = Array.from(selectedRepositoryLabels.values());
      if (labels.length === 0) return;
      const button = document.querySelector(".docs-pr-hh-add-label");
      hideLabelPicker();
      postLabelCommands(button, "label", labels);
    });
    labelPicker.appendChild(apply);

    const customToggle = document.createElement("button");
    customToggle.type = "button";
    customToggle.className = "docs-pr-hh-custom-label-toggle";
    customToggle.textContent = "+ Add custom label";
    customToggle.setAttribute("aria-expanded", "false");
    labelPicker.appendChild(customToggle);

    const custom = document.createElement("div");
    custom.className = "docs-pr-hh-custom-label-row";
    custom.hidden = true;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "docs-pr-hh-label-input";
    input.placeholder = "Custom label name";
    input.maxLength = 200;
    input.setAttribute("aria-label", "Custom label name");
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        custom.querySelector(".docs-pr-hh-label-submit").click();
      }
    });
    custom.appendChild(input);
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "docs-pr-hh-label-submit";
    submit.textContent = "Add";
    submit.addEventListener("click", () => {
      const label = input.value.trim();
      if (!WORKFLOW.labelCommand("label", label)) {
        input.setCustomValidity(
          label
            ? "Label names cannot contain quotes or new lines."
            : "Enter a label name."
        );
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      hideLabelPicker();
      postLabelCommand(
        document.querySelector(".docs-pr-hh-add-label"),
        "label",
        label
      );
      input.value = "";
    });
    custom.appendChild(submit);
    labelPicker.appendChild(custom);
    customToggle.addEventListener("click", () => {
      custom.hidden = !custom.hidden;
      customToggle.setAttribute("aria-expanded", String(!custom.hidden));
      if (!custom.hidden) input.focus();
    });
    document.body.appendChild(labelPicker);
    return labelPicker;
  }

  async function showLabelPicker(button) {
    const picker = getLabelPicker();
    const repo = CONFIG && CONFIG.currentRepo();
    if (!repo) return;
    const repositoryKey = repo.full.toLowerCase();
    labelPickerRepository = repositoryKey;
    labelPickerReturnFocus = button;
    selectedRepositoryLabels.clear();
    updateLabelPickerApplyButton();
    const rect = button.getBoundingClientRect();
    picker.style.top = `${window.scrollY + rect.bottom + 6}px`;
    picker.style.left = `${Math.max(
      8,
      Math.min(
        window.scrollX + rect.left,
        document.documentElement.clientWidth - 328
      )
    )}px`;
    picker.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const search = picker.querySelector(".docs-pr-hh-label-search");
    search.value = "";
    search.focus();
    if (repositoryLabelCache.has(repositoryKey)) {
      renderRepositoryLabels(repositoryLabelCache.get(repositoryKey));
      return;
    }
    const list = picker.querySelector(".docs-pr-hh-label-list");
    list.innerHTML = '<div class="docs-pr-hh-label-message">Loading labels...</div>';
    try {
      const labels = await fetchRepositoryLabels(repo);
      repositoryLabelCache.set(repositoryKey, labels);
      if (
        !picker.hidden &&
        labelPickerRepository === repositoryKey &&
        CONFIG.currentRepo()?.full.toLowerCase() === repositoryKey
      ) {
        renderRepositoryLabels(labels, search.value);
      }
    } catch (error) {
      if (error.name !== "AbortError" && !picker.hidden) {
        list.innerHTML =
          '<div class="docs-pr-hh-label-message">Could not load repository labels.</div>';
      }
    }
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

  function githubUserFromSearchTitle(title) {
    const links = Array.from(title.querySelectorAll("a[href]"));
    const profileLink = links.find((link) =>
      githubUsernameFromPath(link.getAttribute("href"))
    );
    const username = profileLink
      ? githubUsernameFromPath(profileLink.getAttribute("href"))
      : null;
    if (!username) return null;

    const name = links
      .map((link) => link.textContent.trim())
      .find(
        (text) => text && text.toLowerCase() !== username.toLowerCase()
      );
    let result = title;
    for (let depth = 0; result && depth < 5; depth += 1) {
        if (result.querySelectorAll(".search-title").length > 1) {
          result = null;
          break;
        }
        if (result.querySelector("img[src]")) break;
      result = result.parentElement;
    }
    const image = result && result.querySelector("img[src]");
    return {
      username,
      name: name || null,
      avatarUrl:
        (image && image.getAttribute("src")) ||
        `https://github.com/${username}.png?size=40`
    };
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
    result.querySelectorAll(".search-title").forEach((title) => {
      const user = githubUserFromSearchTitle(title);
      if (!user || users.has(user.username.toLowerCase())) return;
      users.set(user.username.toLowerCase(), user);
    });
    return Array.from(users.values()).slice(0, 10);
  }

  function renderAssignmentUsers(users) {
    const list = assignmentPicker.querySelector(".docs-pr-hh-user-list");
    list.replaceChildren();
    if (users.length === 0) {
      assignmentPickerMessage("No GitHub users found.");
      return;
    }
    users.forEach(({ username, name, avatarUrl }) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "docs-pr-hh-user-option";
      option.setAttribute("role", "option");
      option.setAttribute(
        "aria-label",
        name ? `${name}, @${username}` : `@${username}`
      );

      const avatar = document.createElement("img");
      avatar.className = "docs-pr-hh-user-avatar";
      avatar.src = avatarUrl;
      avatar.alt = "";
      avatar.width = 32;
      avatar.height = 32;
      avatar.loading = "lazy";
      option.appendChild(avatar);

      const identity = document.createElement("span");
      identity.className = "docs-pr-hh-user-identity";
      if (name) {
        const fullName = document.createElement("span");
        fullName.className = "docs-pr-hh-user-name";
        fullName.textContent = name;
        identity.appendChild(fullName);
      }
      const login = document.createElement("span");
      login.className = "docs-pr-hh-user-login";
      login.textContent = `@${username}`;
      identity.appendChild(login);
      option.appendChild(identity);
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
    host.className =
      "docs-pr-hh-assignee-row docs-pr-hh-assignment-action-row";
    host.dataset.username = username;

    const name = document.createElement("span");
    name.className = "docs-pr-hh-assignee-name";
    name.textContent = `@${username}`;
    host.appendChild(name);

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

  function visibleLabels(section) {
    const labels = new Map();
    section
      .querySelectorAll(
        ".js-issue-labels .IssueLabel, " +
          ".js-issue-labels [data-testid='issue-label'], " +
          ".js-issue-labels a[href*='/labels/']"
      )
      .forEach((label) => {
        if (!label.offsetParent || label.closest(".docs-pr-hh-label-row")) return;
        const name = label.textContent.trim();
        if (!name || labels.has(name.toLowerCase())) return;
        let host = label.closest(".docs-pr-hh-label-control");
        if (!host) {
          host = document.createElement("span");
          host.className = "docs-pr-hh-label-control";
          label.parentElement.insertBefore(host, label);
          host.appendChild(label);
        }
        labels.set(name.toLowerCase(), { name, host });
      });
    return Array.from(labels.values());
  }

  function labelActionHost(section, name) {
    const key = name.toLowerCase();
    let host = Array.from(
      section.querySelectorAll(".docs-pr-hh-label-row")
    ).find((item) => item.dataset.label.toLowerCase() === key);
    if (host) return host;

    host = document.createElement("span");
    host.className = "docs-pr-hh-label-row";
    host.dataset.label = name;
    const text = document.createElement("span");
    text.className = "docs-pr-hh-label-name";
    text.textContent = name;
    host.appendChild(text);
    const labels = section.querySelector(".js-issue-labels") || section;
    labels.appendChild(host);
    return host;
  }

  function syncRemoveLabelButtons(section) {
    const rendered = visibleLabels(section);
    const renderedNames = new Set(
      rendered.map(({ name }) => name.toLowerCase())
    );
    pendingRemovedLabels.forEach((name) => {
      if (!renderedNames.has(name)) pendingRemovedLabels.delete(name);
    });
    rendered.forEach(({ name, host }) => {
      const removing = pendingRemovedLabels.has(name.toLowerCase());
      host.classList.toggle("docs-pr-hh-removing-label", removing);
      host.hidden = removing;
    });
    section.querySelectorAll(".docs-pr-hh-label-row").forEach((host) => {
      const name = host.dataset.label.toLowerCase();
      if (!pendingAddedLabels.has(name) || renderedNames.has(name)) host.remove();
    });
    const labels = rendered
      .filter(({ name }) => {
        const key = name.toLowerCase();
        return (
          pendingAddedLabels.has(key) && !pendingRemovedLabels.has(key)
        );
      })
      .concat(
        Array.from(pendingAddedLabels.values())
          .filter((name) => !renderedNames.has(name.toLowerCase()))
          .map((name) => ({ name, host: labelActionHost(section, name) }))
      );
    const current = new Set(labels.map(({ name }) => name.toLowerCase()));
    section.querySelectorAll(".docs-pr-hh-remove-label").forEach((button) => {
      if (!current.has(button.dataset.label.toLowerCase())) button.remove();
    });
    labels.forEach(({ name, host }) => {
      if (host.querySelector(".docs-pr-hh-remove-label")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "docs-pr-hh-remove-label";
      button.dataset.label = name;
      button.textContent = "×";
      button.title = `Remove label ${name}`;
      button.setAttribute("aria-label", `Remove label ${name}`);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        postLabelCommand(button, "remove-label", name);
      });
      host.appendChild(button);
    });
    const noneYet = Array.from(
      section.querySelectorAll(".js-issue-labels *")
    ).find((item) => item.textContent.trim() === "None yet");
    if (noneYet) noneYet.hidden = labels.length > 0;
  }

  function syncLabelButton() {
    const existing = document.querySelector(".docs-pr-hh-add-label");
    const heading = findLabelsHeading();
    const section = labelsSection(heading);
    if (!heading || !section) {
      if (existing) existing.remove();
      hideLabelPicker(false);
      return;
    }
    ensureLabelStateLoaded();
    if (existing) {
      if (existing.parentElement !== heading) heading.appendChild(existing);
      syncRemoveLabelButtons(section);
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "docs-pr-hh-add-label";
    button.textContent = "Add";
    button.title = "Add a pre-defined or custom label";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (labelPicker && !labelPicker.hidden) {
        hideLabelPicker();
      } else {
        showLabelPicker(button);
      }
    });
    heading.appendChild(button);
    syncRemoveLabelButtons(section);
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
    return currentPullRequestLabels().some(
      (label) => label.toLowerCase() === "ready-to-merge"
    );
  }

  function currentPullRequestLabels() {
    const section = labelsSection();
    if (!section) return [];
    return visibleLabels(section).map(({ name }) => name);
  }

  function hasPRMergerLabel() {
    return WORKFLOW.hasPRMergerLabel(currentPullRequestLabels());
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

  function ensureLabelStateLoaded() {
    const prKey = currentPullRequestKey();
    if (!prKey || !CONFIG || !CONFIG.getLabelState) return;
    if (loadedLabelKey === prKey || loadingLabelKey === prKey) return;

    loadingLabelKey = prKey;
    CONFIG.getLabelState(prKey).then((state) => {
      if (currentPullRequestKey() === prKey) {
        pendingAddedLabels.clear();
        pendingRemovedLabels.clear();
        (state?.addedLabels || []).forEach((name) =>
          pendingAddedLabels.set(name.toLowerCase(), name)
        );
        (state?.removedLabels || []).forEach((name) =>
          pendingRemovedLabels.add(name.toLowerCase())
        );
        loadedLabelKey = prKey;
        queueSignOffSync();
      }
      loadingLabelKey = null;
    });
  }

  function persistLabelState() {
    const prKey = currentPullRequestKey();
    if (!prKey || !CONFIG || !CONFIG.setLabelState) return;
    CONFIG.setLabelState(
      prKey,
      Array.from(pendingAddedLabels.values()),
      Array.from(pendingRemovedLabels.values())
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

  function areSignOffChecksComplete() {
    const mergeBox = findMergeBox();
    if (!mergeBox) return false;
    const statuses = [
      ...mergeBox.innerText.split(/\r?\n/),
      ...Array.from(mergeBox.querySelectorAll("*")).flatMap((element) => [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.children.length === 0 ? element.textContent : null
      ])
    ];
    return WORKFLOW.areChecksComplete(statuses);
  }

  function pullRequestClosureState() {
    const stateElements = document.querySelectorAll(
      "[data-testid='mergebox-border-container'] h1, " +
        "[data-testid='mergebox-border-container'] h2, " +
        "[data-testid='mergebox-border-container'] h3, " +
        "[data-testid='pull-request-state'], " +
        "[data-testid='issue-state'], " +
        ".gh-header-meta .State, " +
        "#partial-discussion-header .State"
    );
    const states = Array.from(stateElements)
      .filter((element) => element.offsetParent)
      .map((element) => ({
        className: String(element.className || ""),
        text: element.textContent.trim().replace(/\s+/g, " ")
      }));
    if (
      states.some(
        ({ className, text }) =>
          /State--merged/.test(className) ||
          /^(?:merged|pull request successfully merged(?: and closed)?|this pull request was merged)[.!]?$/i.test(
            text
          )
      )
    ) {
      return "merged";
    }
    return states.some(({ text }) => WORKFLOW.isClosedUnmergedText(text))
      ? "closed"
      : "open";
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
    const action = WORKFLOW.mergeBoxAction(
      currentPullRequestLabels(),
      areSignOffChecksComplete(),
      currentWorkflowCommand()
    );
    if (!action) return;
    const command = action.command;
    button.disabled = Boolean(action.disabled);
    button.textContent = command;
    button.dataset.command = command;
    button.title = `Post ${command} as a PR comment`;
    button.setAttribute("aria-label", button.title);
    const row = button.closest(".docs-pr-hh-sign-off-row");
    const title = row?.querySelector(".docs-pr-hh-sign-off-title");
    const description = row?.querySelector(
      ".docs-pr-hh-sign-off-description"
    );
    if (title) title.textContent = action.title;
    if (description) description.textContent = action.description;
    row?.classList.toggle("is-hold-off", action.icon === "hand");
    row?.classList.toggle("is-not-ready", action.icon === "hourglass");
  }

  function updateReopenButtonState(button) {
    button.disabled = reopenRequested;
    button.textContent = reopenRequested
      ? "Reopen requested"
      : "Reopen pull request";
    button.dataset.command = "#please-open";
    button.classList.remove("is-hold-off");
    button.classList.add("is-reopen");
    button.title = reopenRequested
      ? "Posted #please-open. Waiting for PRMerger."
      : "Post #please-open as a PR comment";
    button.setAttribute("aria-label", button.title);
  }

  function findCommentSubmitButton(field, includeDisabled = false) {
    const form = field.form || field.closest("form");
    if (!form) return null;
    const buttons = Array.from(form.querySelectorAll("button[type='submit']"));
    return buttons.find((candidate) => {
      if (
        (!includeDisabled && candidate.disabled) ||
        candidate.hidden ||
        !candidate.offsetParent
      ) {
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
      if (command === "#please-open") {
        reopenRequested = true;
        updateReopenButtonState(button);
        announceSignOffStatus(button, `Posted ${command}.`);
        return;
      }
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
    if (command !== "#please-open") {
      workflowCommandOverride = null;
      pendingPostedWorkflowCommand = null;
      persistWorkflowCommand(null);
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

  function preserveViewport(scrollX, scrollY) {
    const restore = () => window.scrollTo(scrollX, scrollY);
    restore();
    window.requestAnimationFrame(restore);
    [50, 150, 350].forEach((delay) => window.setTimeout(restore, delay));
  }

  function submitAssignmentWhenReady(
    field,
    button,
    command,
    onSubmitted,
    viewport,
    attemptsLeft = 20
  ) {
    const submitButton = findCommentSubmitButton(field);
    if (submitButton) {
      submitButton.click();
      onSubmitted();
      announceAssignmentStatus(button, `Posted ${command}.`);
      preserveViewport(viewport.scrollX, viewport.scrollY);
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
            viewport,
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

  const viewport = { scrollX: window.scrollX, scrollY: window.scrollY };
    const before = field.value;
    const separator = before && !before.endsWith("\n") ? "\n" : "";
    const value = before + separator + command;
  setFieldValue(field, value, value.length, false);
  preserveViewport(viewport.scrollX, viewport.scrollY);
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
    }, viewport);
  }

  function postLabelCommands(button, action, labels) {
    const command = WORKFLOW.labelCommands(action, labels);
    const field = findCommentField();
    if (!command || !field) {
      announceAssignmentStatus(button, "Open the Write tab first.");
      return;
    }

  const viewport = { scrollX: window.scrollX, scrollY: window.scrollY };
    const before = field.value;
    const separator = before && !before.endsWith("\n") ? "\n" : "";
    const value = before + separator + command;
  setFieldValue(field, value, value.length, false);
  preserveViewport(viewport.scrollX, viewport.scrollY);
    const status = labels.length === 1 ? command : `${labels.length} label commands`;
    announceAssignmentStatus(button, `Posting ${status}...`);
    submitAssignmentWhenReady(field, button, status, () => {
      labels.forEach((label) => {
        const key = label.toLowerCase();
        if (action === "label") {
          pendingRemovedLabels.delete(key);
          pendingAddedLabels.set(key, label);
        } else {
          pendingAddedLabels.delete(key);
          pendingRemovedLabels.add(key);
        }
      });
      persistLabelState();
      const section = labelsSection();
      if (section) syncRemoveLabelButtons(section);
    }, viewport);
  }

  function postLabelCommand(button, action, label) {
    postLabelCommands(button, action, [label]);
  }

  function postWorkflowComment(button, requestedCommand = null) {
    const field = findCommentField();
    if (!field) {
      announceSignOffStatus(button, "Open the Write tab first.");
      return;
    }

    const trigger = requestedCommand || currentWorkflowCommand();
    const insertText = trigger;
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
    if (trigger !== "#please-open") {
      workflowCommandOverride = WORKFLOW.nextWorkflowCommand(trigger);
      pendingPostedWorkflowCommand = trigger;
      persistWorkflowCommand(workflowCommandOverride, trigger);
      updateSignOffButtonState(button);
    }
    submitCommentWhenReady(field, button, trigger);
  }

  function findMergeBox() {
    return document.querySelector(
      "[data-testid='mergebox-border-container'], " +
        "#partial-pull-merging, " +
        ".js-pull-merging"
    );
  }

  function placeWorkflowButtonRow(row, mergeBox) {
    if (!mergeBox) return false;
    if (row.parentElement !== mergeBox || row !== mergeBox.lastElementChild) {
      mergeBox.appendChild(row);
    }
    row.classList.remove("is-next-to-comment");
    row.classList.remove("is-next-to-merge-status");
    row.classList.add("is-in-merge-box");
    return true;
  }

  function placeReopenButtonRow(row) {
    const field = findCommentField();
    const submitButton = field && findCommentSubmitButton(field, true);
    const buttonHost = submitButton && submitButton.parentElement;
    const actionRow = buttonHost && buttonHost.parentElement;
    if (!actionRow) return false;
    if (
      row.parentElement !== actionRow ||
      row.nextElementSibling !== buttonHost
    ) {
      actionRow.insertBefore(row, buttonHost);
    }
    row.classList.remove("is-next-to-merge-status");
    row.classList.remove("is-in-merge-box");
    row.classList.add("is-next-to-comment");
    return true;
  }

  function hasNativeReopenButton() {
    return Array.from(document.querySelectorAll("button, [role='button']")).some(
      (button) => {
        if (
          button.closest(".docs-pr-hh-sign-off-row") ||
          button.hidden ||
          !button.offsetParent
        ) {
          return false;
        }
        return WORKFLOW.isReopenControlLabel(
          button.textContent || button.getAttribute("aria-label")
        );
      }
    );
  }

  function syncSignOffButton() {
    signOffSyncQueued = false;
    let existing = document.querySelector(".docs-pr-hh-sign-off");
    if (!isPullRequestPage() || !isActiveRepo()) {
      if (existing) existing.closest(".docs-pr-hh-sign-off-row").remove();
      const assignButton = document.querySelector(".docs-pr-hh-assign");
      if (assignButton) assignButton.remove();
      const reviewerButton = document.querySelector(
        ".docs-pr-hh-assign-reviewer"
      );
      if (reviewerButton) reviewerButton.remove();
      const labelButton = document.querySelector(".docs-pr-hh-add-label");
      if (labelButton) labelButton.remove();
      return;
    }
    syncAssignButton();
    syncReviewerButton();
    syncLabelButton();

    const closureState = pullRequestClosureState();
    if (closureState === "merged") {
      reopenRequested = false;
      if (existing) existing.closest(".docs-pr-hh-sign-off-row").remove();
      return;
    }
    if (closureState === "closed") {
      if (hasNativeReopenButton()) {
        if (existing) existing.closest(".docs-pr-hh-sign-off-row").remove();
        return;
      }
      document
        .querySelectorAll(
          ".docs-pr-hh-sign-off-row:not(.is-reopen-action)"
        )
        .forEach((row) => row.remove());
      existing = document.querySelector(
        ".docs-pr-hh-sign-off-row.is-reopen-action .docs-pr-hh-sign-off"
      );
      if (existing) {
        updateReopenButtonState(existing);
        placeReopenButtonRow(existing.closest(".docs-pr-hh-sign-off-row"));
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "docs-pr-hh-sign-off is-reopen";
      button.addEventListener("click", () =>
        postWorkflowComment(button, "#please-open")
      );

      const row = document.createElement("span");
      row.className = "docs-pr-hh-sign-off-row is-reopen-action";
      row.appendChild(button);

      const status = document.createElement("span");
      status.className = "docs-pr-hh-sign-off-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      row.appendChild(status);
      if (!placeReopenButtonRow(row)) return;
      updateReopenButtonState(button);
      return;
    }
    reopenRequested = false;
    document
      .querySelectorAll(
        ".docs-pr-hh-sign-off-row:not(.is-merge-box-action)"
      )
      .forEach((row) => row.remove());
    existing = document.querySelector(
      ".docs-pr-hh-sign-off-row.is-merge-box-action .docs-pr-hh-sign-off"
    );
    if (!ensureWorkflowStateLoaded()) return;

    const action = WORKFLOW.mergeBoxAction(
      currentPullRequestLabels(),
      areSignOffChecksComplete()
    );
    const mergeBox = findMergeBox();
    if (!action || !mergeBox) {
      if (existing) existing.closest(".docs-pr-hh-sign-off-row").remove();
      return;
    }
    if (existing) {
      updateSignOffButtonState(existing);
      placeWorkflowButtonRow(
        existing.closest(".docs-pr-hh-sign-off-row"),
        mergeBox
      );
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "docs-pr-hh-sign-off Button Button--primary Button--medium";
    button.textContent = action.command;
    button.title = "Post #sign-off as a PR comment";
    button.setAttribute("aria-label", "Post #sign-off as a PR comment");
    button.addEventListener("click", () =>
      postWorkflowComment(button, button.dataset.command)
    );

    const row = document.createElement("div");
    row.className = "docs-pr-hh-sign-off-row is-merge-box-action";

    const summary = document.createElement("div");
    summary.className = "docs-pr-hh-sign-off-summary";
    summary.innerHTML =
      '<svg class="docs-pr-hh-sign-off-icon docs-pr-hh-sign-off-check-icon" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><circle class="docs-pr-hh-sign-off-icon-circle" cx="16" cy="16" r="16"></circle><path class="docs-pr-hh-sign-off-icon-check" d="m10.5 16 3.5 3.5 7.5-7.5"></path></svg>' +
      '<span class="docs-pr-hh-sign-off-icon docs-pr-hh-sign-off-hand-icon" aria-hidden="true">&#x270B;&#xFE0E;</span>' +
      '<span class="docs-pr-hh-sign-off-icon docs-pr-hh-sign-off-hourglass-icon" aria-hidden="true">&#x231B;&#xFE0E;</span>';
    const copy = document.createElement("div");
    copy.className = "docs-pr-hh-sign-off-copy";
    const title = document.createElement("div");
    title.className = "docs-pr-hh-sign-off-title";
    title.textContent = action.title;
    copy.appendChild(title);
    const description = document.createElement("div");
    description.className = "docs-pr-hh-sign-off-description";
    description.textContent = action.description;
    copy.appendChild(description);
    summary.appendChild(copy);
    row.appendChild(summary);
    row.appendChild(button);

    const status = document.createElement("span");
    status.className = "docs-pr-hh-sign-off-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    row.appendChild(status);
    if (!placeWorkflowButtonRow(row, mergeBox)) return;
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
      queueSignOffSync();
    }
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
    if (
      labelPicker &&
      !labelPicker.hidden &&
      !labelPicker.contains(event.target) &&
      !event.target.closest(".docs-pr-hh-add-label")
    ) {
      hideLabelPicker(false);
    }
  });
  const pageObserver = new MutationObserver(queueSignOffSync);
  pageObserver.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("turbo:load", queueSignOffSync);
  queueSignOffSync();

})();
