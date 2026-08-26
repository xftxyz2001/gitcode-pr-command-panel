(() => {
  "use strict";

  const PANEL_ID = "gitcode-pr-command-panel";
  const PR_PATH_RE = /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/;
  const REQUEST_EVENT = "gitcode-pr-command:send";
  const RESULT_EVENT = "gitcode-pr-command:result";
  const CONFIG_EVENT = "gitcode-pr-command:config";

  let lastUrl = location.href;
  let commands = [];
  let sending = false;
  let lastSentCommand = "";
  let lastSentAt = 0;

  function cloneDefaults() {
    return window.GITCODE_PR_DEFAULT_COMMANDS.map((item) => ({ ...item }));
  }

  function normalizeCommands(value) {
    if (!Array.isArray(value)) return cloneDefaults();
    const normalized = value
      .filter((item) => item && typeof item === "object")
      .map((item, index) => ({
        id: String(item.id || `custom-${index}-${Date.now()}`),
        label: String(item.label || "未命名").trim().slice(0, 30),
        command: String(item.command || "").trim().slice(0, 65535),
        enabled: Boolean(item.enabled)
      }))
      .filter((item) => item.command);
    return normalized;
  }

  function visibleCommands() {
    return commands.filter((item) => item.enabled && item.label && item.command);
  }

  function publishAllowedCommands() {
    document.dispatchEvent(new CustomEvent(CONFIG_EVENT, {
      detail: JSON.stringify(visibleCommands().map((item) => item.command))
    }));
  }

  function isPrPage() {
    return location.hostname === "gitcode.com" && PR_PATH_RE.test(location.pathname);
  }

  function setStatus(message, kind = "info") {
    const status = document.querySelector(`#${PANEL_ID} .gc-command-status`);
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function setButtonsDisabled(disabled) {
    document.querySelectorAll(`#${PANEL_ID} .gc-command-button`).forEach((button) => {
      button.disabled = disabled;
    });
  }

  function requestDirectComment(command) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        document.removeEventListener(RESULT_EVENT, onResult);
        reject(new Error("GitCode 评论接口响应超时"));
      }, 30000);

      function onResult(event) {
        let result;
        try {
          result = JSON.parse(event.detail);
        } catch {
          return;
        }
        if (result.requestId !== requestId) return;
        clearTimeout(timeout);
        document.removeEventListener(RESULT_EVENT, onResult);
        if (result.ok) resolve(result);
        else reject(new Error(result.message || "GitCode 评论接口调用失败"));
      }

      document.addEventListener(RESULT_EVENT, onResult);
      document.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
        detail: JSON.stringify({ requestId, command })
      }));
    });
  }

  async function sendCommand(command) {
    if (sending) return;
    if (command === lastSentCommand && Date.now() - lastSentAt < 5000) {
      setStatus(`已发送 ${command}，已阻止重复操作`, "success");
      return;
    }

    sending = true;
    setButtonsDisabled(true);
    setStatus(`正在直接发送 ${command}…`);
    try {
      await requestDirectComment(command);
      lastSentCommand = command;
      lastSentAt = Date.now();
      setStatus(`已发送：${command}`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "自动发送失败", "error");
    } finally {
      sending = false;
      setButtonsDisabled(false);
    }
  }

  function renderButtons() {
    const grid = document.querySelector(`#${PANEL_ID} .gc-command-grid`);
    if (!grid) return;
    grid.replaceChildren();
    const items = visibleCommands();

    for (const { label, command } of items) {
      const button = document.createElement("button");
      button.className = "gc-command-button";
      button.type = "button";
      button.textContent = label;
      button.title = `直接发送评论：${command}`;
      button.addEventListener("click", () => sendCommand(command));
      grid.appendChild(button);
    }

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "gc-command-empty";
      empty.textContent = "尚未勾选命令，请打开设置";
      grid.appendChild(empty);
    }
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID) || !isPrPage()) return;

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", "GitCode PR 快捷命令");

    const header = document.createElement("div");
    header.className = "gc-command-header";
    const title = document.createElement("div");
    title.className = "gc-command-title";
    title.textContent = "PR 快捷命令";

    let dragState = null;
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragState = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.transform = "none";
      header.setPointerCapture(event.pointerId);
      header.classList.add("gc-command-dragging");
    });
    header.addEventListener("pointermove", (event) => {
      if (!dragState) return;
      const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
      panel.style.left = `${Math.min(maxLeft, Math.max(8, event.clientX - dragState.offsetX))}px`;
      panel.style.top = `${Math.min(maxTop, Math.max(8, event.clientY - dragState.offsetY))}px`;
    });
    const stopDragging = (event) => {
      if (!dragState) return;
      dragState = null;
      header.classList.remove("gc-command-dragging");
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
    };
    header.addEventListener("pointerup", stopDragging);
    header.addEventListener("pointercancel", stopDragging);

    const actions = document.createElement("div");
    actions.className = "gc-command-actions";
    const settings = document.createElement("button");
    settings.className = "gc-command-icon-button";
    settings.type = "button";
    settings.title = "配置快捷命令";
    settings.setAttribute("aria-label", "配置快捷命令");
    settings.textContent = "⚙";
    settings.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const response = await chrome.runtime.sendMessage({ type: "open-options" });
        if (!response?.ok) throw new Error(response?.message || "配置页打开失败");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "配置页打开失败", "error");
      }
    });

    const toggle = document.createElement("button");
    toggle.className = "gc-command-icon-button gc-command-toggle";
    toggle.type = "button";
    toggle.title = "收起";
    toggle.setAttribute("aria-label", "收起快捷命令");
    toggle.textContent = "−";
    toggle.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("gc-command-collapsed");
      toggle.textContent = collapsed ? "+" : "−";
      toggle.title = collapsed ? "展开" : "收起";
      toggle.setAttribute("aria-label", collapsed ? "展开快捷命令" : "收起快捷命令");
    });
    actions.append(settings, toggle);
    header.append(title, actions);

    const grid = document.createElement("div");
    grid.className = "gc-command-grid";
    const status = document.createElement("div");
    status.className = "gc-command-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "任意 PR 选项卡均可直接发送";

    panel.append(header, grid, status);
    document.body.appendChild(panel);
    renderButtons();
  }

  function syncPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (isPrPage()) {
      if (!panel) createPanel();
      else renderButtons();
    } else if (panel) {
      panel.remove();
    }
  }

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      syncPanel();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", syncPanel);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.commands) return;
    commands = normalizeCommands(changes.commands.newValue);
    publishAllowedCommands();
    syncPanel();
  });

  chrome.storage.local.get("commands").then(({ commands: saved }) => {
    commands = normalizeCommands(saved);
    publishAllowedCommands();
    syncPanel();
  });
})();
