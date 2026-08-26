(() => {
  "use strict";

  const PANEL_ID = "gitcode-pr-command-panel";
  const PR_PATH_RE = /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/;
  const REQUEST_EVENT = "gitcode-pr-command:send";
  const RESULT_EVENT = "gitcode-pr-command:result";
  const COMMANDS = [
    { label: "编译", command: "compile" },
    { label: "查看日志", command: "get-log" },
    { label: "重试流水线", command: "retry" },
    { label: "停止流水线", command: "stop" },
    { label: "检查 CLA", command: "/check-cla" },
    { label: "LGTM", command: "/lgtm" },
    { label: "批准合入", command: "/approve" },
    { label: "检查合入", command: "/check-pr" }
  ];

  let lastUrl = location.href;
  let sending = false;
  let lastSentCommand = "";
  let lastSentAt = 0;

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

    const toggle = document.createElement("button");
    toggle.className = "gc-command-toggle";
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
    header.append(title, toggle);

    const grid = document.createElement("div");
    grid.className = "gc-command-grid";
    COMMANDS.forEach(({ label, command }) => {
      const button = document.createElement("button");
      button.className = "gc-command-button";
      button.type = "button";
      button.textContent = label;
      button.title = `直接发送评论：${command}`;
      button.addEventListener("click", () => sendCommand(command));
      grid.appendChild(button);
    });

    const status = document.createElement("div");
    status.className = "gc-command-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "任意 PR 选项卡均可直接发送";

    panel.append(header, grid, status);
    document.body.appendChild(panel);
  }

  function syncPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (isPrPage()) {
      if (!panel) createPanel();
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
  syncPanel();
})();
