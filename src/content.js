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
  const TRIGGER = /(^|\s)(#[a-z-]*)$/i;

  /** @type {HTMLTextAreaElement | null} */
  let activeField = null;
  let matches = [];
  let activeIndex = 0;
  let menu = null;
  let signOffSyncQueued = false;

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
    setter.call(field, value);
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(new Event("input", { bubbles: true }));
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

  function announceSignOffStatus(button, message) {
    const status = button.parentElement.querySelector(
      ".docs-pr-hh-sign-off-status"
    );
    if (!status) return;
    status.textContent = message;
    window.setTimeout(() => (status.textContent = ""), 2500);
  }

  function containsSignOff(value) {
    return /(^|\s)#sign-off(?:\s|$)/i.test(value || "");
  }

  function hasPostedSignOff() {
    const commentBodies = document.querySelectorAll(
      ".timeline-comment .js-comment-body, " +
        ".timeline-comment .comment-body, " +
        ".timeline-comment .markdown-body, " +
        "[data-testid='comment-body']"
    );
    return Array.from(commentBodies).some((body) =>
      containsSignOff(body.textContent)
    );
  }

  function hasReadyToMergeLabel() {
    const labels = document.querySelectorAll(
      ".IssueLabel, [data-testid='issue-label'], a[href*='/labels/']"
    );
    return Array.from(labels).some(
      (label) => label.textContent.trim().toLowerCase() === "ready-to-merge"
    );
  }

  function updateSignOffButtonState(button) {
    const posted = hasPostedSignOff();
    const readyToMerge = hasReadyToMergeLabel();
    button.disabled = posted && readyToMerge;

    if (button.disabled) {
      button.title = "This PR is already labeled ready-to-merge";
    } else {
      button.title = "Add #sign-off to the PR comment editor";
    }
    button.setAttribute("aria-label", button.title);
  }

  function addSignOffToComment(button) {
    const field = findCommentField();
    if (!field) {
      announceSignOffStatus(button, "Open the Write tab first.");
      return;
    }

    const command = COMMANDS.find((item) => item.trigger === "#sign-off");
    const insertText = command ? command.insert.trimEnd() : "#sign-off";
    if (containsSignOff(field.value)) {
      field.focus();
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      announceSignOffStatus(button, "#sign-off is already in the comment.");
      return;
    }

    const before = field.value;
    const separator = before && !before.endsWith("\n") ? "\n" : "";
    const value = before + separator + insertText;
    const caret = before.length + separator.length + insertText.length;

    setFieldValue(field, value, caret);
    field.focus();
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    announceSignOffStatus(button, "Added #sign-off to the comment.");
    updateSignOffButtonState(button);
  }

  function findBlockedMergeHeading() {
    return Array.from(
      document.querySelectorAll("h1, h2, h3, h4, [role='heading']")
    ).find((heading) => heading.textContent.trim() === "Merging is blocked");
  }

  function syncSignOffButton() {
    signOffSyncQueued = false;
    const existing = document.querySelector(".docs-pr-hh-sign-off");
    if (!isPullRequestPage() || !isActiveRepo()) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      updateSignOffButtonState(existing);
      return;
    }

    const heading = findBlockedMergeHeading();
    if (!heading) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "docs-pr-hh-sign-off";
    button.textContent = "sign-off to merge";
    button.title = "Add #sign-off to the PR comment editor";
    button.setAttribute("aria-label", "Add #sign-off to the PR comment editor");
    button.addEventListener("click", () => addSignOffToComment(button));

    const row = document.createElement("div");
    row.className = "docs-pr-hh-sign-off-row";
    heading.parentNode.insertBefore(row, heading);
    row.appendChild(heading);
    row.appendChild(button);

    const status = document.createElement("span");
    status.className = "docs-pr-hh-sign-off-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    row.appendChild(status);
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
