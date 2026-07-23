/* eslint-disable no-undef */
(function () {
  "use strict";

  const CONFIG = window.DocsPRHelperConfig;
  const COMMANDS = window.DOCS_PR_COMMANDS || [];

  const form = document.getElementById("settings-form");
  const allowlistEl = document.getElementById("allowlist");
  const statusEl = document.getElementById("status");
  const modeInputs = () => form.querySelectorAll('input[name="mode"]');

  function setMode(mode) {
    modeInputs().forEach((input) => {
      input.checked = input.value === mode;
    });
    allowlistEl.disabled = mode !== "allowlist";
  }

  function selectedMode() {
    const checked = form.querySelector('input[name="mode"]:checked');
    return checked ? checked.value : "all";
  }

  function renderCommands() {
    const list = document.getElementById("command-list");
    list.innerHTML = "";
    COMMANDS.forEach((cmd) => {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = cmd.display;
      const desc = document.createElement("span");
      desc.textContent = ` — ${cmd.description}`;
      li.appendChild(code);
      li.appendChild(desc);
      list.appendChild(li);
    });
  }

  async function load() {
    const settings = CONFIG
      ? await CONFIG.get()
      : { mode: "all", allowlist: ["MicrosoftDocs"] };
    setMode(settings.mode);
    allowlistEl.value = (settings.allowlist || []).join("\n");
  }

  form.addEventListener("change", (e) => {
    if (e.target.name === "mode") setMode(e.target.value);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const settings = {
      mode: selectedMode(),
      allowlist: allowlistEl.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    };
    if (CONFIG) await CONFIG.set(settings);
    statusEl.textContent = "Saved.";
    setTimeout(() => (statusEl.textContent = ""), 2000);
  });

  renderCommands();
  load();
})();
