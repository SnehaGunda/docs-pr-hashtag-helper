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

  // Current settings, refreshed live. Gating is evaluated per keystroke so it
  // stays correct as GitHub navigates between repos without a full reload.
  let settings = CONFIG ? CONFIG.DEFAULT_SETTINGS : { mode: "all" };
  if (CONFIG) {
    CONFIG.get().then((s) => {
      settings = s;
    });
    CONFIG.onChange((s) => {
      settings = s;
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

      if (cmd.availability) {
        const badge = document.createElement("span");
        badge.className = "docs-pr-hh-badge";
        badge.textContent = cmd.availability;
        item.appendChild(badge);
      }
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        insertCommand(i);
      });
      el.appendChild(item);
    });
    el.hidden = false;
  }

  /** Positions the menu just below the caret inside the text area. */
  function positionMenu(field, tokenStart) {
    const el = getMenu();
    const coords = caretCoordinates(field, tokenStart);
    const rect = field.getBoundingClientRect();
    const top =
      window.scrollY + rect.top + coords.top - field.scrollTop + coords.height;
    const left = window.scrollX + rect.left + coords.left - field.scrollLeft;
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

  // --- Event wiring (delegated at the document level) ---

  document.addEventListener("input", (e) => {
    const target = e.target;
    if (isCommentField(target)) updateFor(target);
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
  window.addEventListener("scroll", () => hideMenu(), true);

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
