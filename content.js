(() => {
  "use strict";

  const PANEL_ID = "gitcode-pr-command-panel";
  const PR_PATH_RE = /^\/[^/]+\/[^/]+\/(?:pull|merge_requests)\/\d+(?:\/|$)/;
  const REQUEST_EVENT = "gitcode-pr-command:send";
  const RESULT_EVENT = "gitcode-pr-command:result";
  const CONFIG_EVENT = "gitcode-pr-command:config";
  const PIPELINE_EVENT = "gitcode-pr-command:pipeline";
  const PIPELINE_NOTIFICATION_RESULT_EVENT = "gitcode-pr-command:pipeline-notification-result";
  const PIPELINE_POLL_REQUEST_EVENT = "gitcode-pr-command:poll-pipeline";
  const PIPELINE_POLL_OBSERVED_EVENT = "gitcode-pr-command:pipeline-poll-observed";
  const VIEWPORT_MARGIN = 8;

  let lastUrl = location.href;
  let commands = [];
  let sending = false;
  let lastSentCommand = "";
  let lastSentAt = 0;
  let monitorRegistration = "";
  let appearance = window.GITCODE_PR_APPEARANCE.normalize();
  let appearanceImageGeneration = 0;

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

  function setPanelBackground(panel, tokens, generation) {
    panel.style.backgroundColor = tokens.panelBackgroundCss;
    panel.style.backgroundImage = "none";
    if (!tokens.backgroundImage) return;
    const image = new Image();
    image.addEventListener("load", () => {
      if (generation !== appearanceImageGeneration || !panel.isConnected) return;
      const overlay = tokens.backgroundOverlayOpacity / 100;
      panel.style.backgroundImage = `linear-gradient(rgba(${tokens.overlayRgb}, ${overlay}), rgba(${tokens.overlayRgb}, ${overlay})), url("${tokens.backgroundImage}")`;
      panel.style.backgroundSize = `auto, ${tokens.backgroundImageFit === "center" ? "auto" : tokens.backgroundImageFit}`;
      panel.style.backgroundPosition = "center, center";
      panel.style.backgroundRepeat = "no-repeat, no-repeat";
    }, { once: true });
    image.addEventListener("error", () => {
      if (generation === appearanceImageGeneration) panel.style.backgroundImage = "none";
    }, { once: true });
    image.src = tokens.backgroundImage;
  }

  function applyAppearance(panel = document.getElementById(PANEL_ID)) {
    if (!panel) return;
    const tokens = window.GITCODE_PR_APPEARANCE.createThemeTokens(appearance);
    panel.style.setProperty("--gc-panel-bg", tokens.panelBackgroundCss);
    panel.style.setProperty("--gc-panel-border", tokens.panelBorder);
    panel.style.setProperty("--gc-panel-text", tokens.panelText);
    panel.style.setProperty("--gc-panel-muted", tokens.panelMuted);
    panel.style.setProperty("--gc-panel-surface-hover", tokens.panelSurfaceHover);
    panel.style.setProperty("--gc-panel-danger", tokens.panelDanger);
    panel.style.setProperty("--gc-panel-success", tokens.panelSuccess);
    panel.style.setProperty("--gc-button-bg", tokens.buttonColor);
    panel.style.setProperty("--gc-button-text", tokens.buttonText);
    panel.style.setProperty("--gc-button-hover-text", tokens.buttonHoverText);
    panel.style.setProperty("--gc-button-active-text", tokens.buttonActiveText);
    panel.style.setProperty("--gc-button-hover", tokens.buttonHover);
    panel.style.setProperty("--gc-button-active", tokens.buttonActive);
    panel.style.setProperty("--gc-button-border", tokens.buttonBorder);
    appearanceImageGeneration += 1;
    setPanelBackground(panel, tokens, appearanceImageGeneration);
  }

  function isNotificationMockPage() {
    return location.protocol === "chrome-extension:"
      && Boolean(window.GITCODE_PR_NOTIFICATION_MOCK);
  }

  function isPipelineMonitorPage() {
    return isPrPage() || isNotificationMockPage();
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

    keepPanelInViewport(grid.closest(`#${PANEL_ID}`));
  }

  function isDocumentActive() {
    return document.visibilityState === "visible" && document.hasFocus();
  }

  function sendRuntimeMessage(message) {
    if (!chrome.runtime?.id) return Promise.resolve(undefined);
    try {
      return Promise.resolve(chrome.runtime.sendMessage(message));
    } catch (error) {
      if (error instanceof Error && /Extension context invalidated/i.test(error.message)) {
        return Promise.resolve(undefined);
      }
      return Promise.reject(error);
    }
  }

  function updatePipelineMonitor(force = false) {
    const registration = isPipelineMonitorPage()
      ? `${location.href}|${isDocumentActive()}`
      : "unregistered";
    if (!force && registration === monitorRegistration) return;
    monitorRegistration = registration;
    sendRuntimeMessage(isPipelineMonitorPage()
      ? {
          type: "register-pipeline-monitor",
          active: isDocumentActive(),
          stateAt: Date.now(),
          url: location.href
        }
      : { type: "unregister-pipeline-monitor" })
      .catch(() => {});
  }

  function getPrTitle() {
    const selectors = [
      '[data-testid="merge-request-title"]',
      ".merge-request-title",
      ".title-container h1",
      "main h1",
      "h1"
    ];
    for (const selector of selectors) {
      const title = document.querySelector(selector)?.textContent?.trim();
      if (title) return title;
    }
    return document.title
      .replace(/\s*[·|\-]\s*GitCode.*$/i, "")
      .trim() || "未获取到 PR 标题";
  }

  function keepPanelInViewport(panel) {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    if (
      rect.left >= VIEWPORT_MARGIN
      && rect.top >= VIEWPORT_MARGIN
      && rect.right <= window.innerWidth - VIEWPORT_MARGIN
      && rect.bottom <= window.innerHeight - VIEWPORT_MARGIN
    ) return;

    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    panel.style.left = `${Math.min(maxLeft, Math.max(VIEWPORT_MARGIN, rect.left))}px`;
    panel.style.top = `${Math.min(maxTop, Math.max(VIEWPORT_MARGIN, rect.top))}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.transform = "none";
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
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - panel.offsetWidth - VIEWPORT_MARGIN);
      const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - panel.offsetHeight - VIEWPORT_MARGIN);
      panel.style.left = `${Math.min(maxLeft, Math.max(VIEWPORT_MARGIN, event.clientX - dragState.offsetX))}px`;
      panel.style.top = `${Math.min(maxTop, Math.max(VIEWPORT_MARGIN, event.clientY - dragState.offsetY))}px`;
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
        const response = await sendRuntimeMessage({ type: "open-options" });
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
      keepPanelInViewport(panel);
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
    applyAppearance(panel);
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
    updatePipelineMonitor();
  }

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      syncPanel();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", syncPanel);
  window.addEventListener("resize", () => {
    keepPanelInViewport(document.getElementById(PANEL_ID));
  });
  document.addEventListener("visibilitychange", () => updatePipelineMonitor());
  window.addEventListener("focus", () => updatePipelineMonitor());
  window.addEventListener("blur", () => updatePipelineMonitor());
  window.addEventListener("beforeunload", () => {
    sendRuntimeMessage({ type: "unregister-pipeline-monitor" }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "poll-pipeline") return false;
    if (isPipelineMonitorPage() && isDocumentActive()) {
      updatePipelineMonitor(true);
    } else if (isPipelineMonitorPage()) {
      document.dispatchEvent(new CustomEvent(PIPELINE_POLL_REQUEST_EVENT));
    }
    return false;
  });

  document.addEventListener(PIPELINE_POLL_OBSERVED_EVENT, () => {
    if (!isPipelineMonitorPage()) return;
    const now = Date.now();
    sendRuntimeMessage({
      type: "pipeline-poll-observed",
      active: isDocumentActive(),
      observedAt: now,
      stateAt: now,
      url: location.href
    }).catch(() => {});
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || (!changes.commands && !changes.appearance)) return;
    if (changes.commands) {
      commands = normalizeCommands(changes.commands.newValue);
      publishAllowedCommands();
    }
    if (changes.appearance) appearance = window.GITCODE_PR_APPEARANCE.normalize(changes.appearance.newValue);
    syncPanel();
    applyAppearance();
  });

  function reportPipelineNotification(result) {
    document.dispatchEvent(new CustomEvent(PIPELINE_NOTIFICATION_RESULT_EVENT, {
      detail: JSON.stringify(result)
    }));
  }

  document.addEventListener(PIPELINE_EVENT, async (event) => {
    let pipeline;
    try {
      pipeline = JSON.parse(event.detail);
    } catch {
      return;
    }
    if (!pipeline || !["passed", "failed"].includes(pipeline.status)) return;
    const active = isDocumentActive();
    if (active && pipeline.source === "comment") {
      reportPipelineNotification({
        ok: false,
        skipped: true,
        message: "事件触发时页面仍在前台，已按正式逻辑抑制通知"
      });
      return;
    }
    try {
      const response = await sendRuntimeMessage({
        type: "notify-ci-pipeline",
        pipeline: {
          key: String(pipeline.key || ""),
          status: pipeline.status,
          kind: pipeline.kind === "docs" ? "docs" : "main",
          source: pipeline.source === "comment" ? "comment" : "label",
          runKey: String(pipeline.runKey || ""),
          pipelineUrl: String(pipeline.pipelineUrl || ""),
          eventAt: Number(pipeline.eventAt) || 0,
          suppressNotification: active,
          project: String(pipeline.project || "未知仓库"),
          iid: Number(pipeline.iid),
          title: getPrTitle(),
          url: location.href
        }
      });
      reportPipelineNotification(response?.ok
        ? {
            ok: true,
            pending: Boolean(response.pending),
            skipped: Boolean(response.skipped),
            message: response.skipped
              ? "页面在前台，已取消对应兜底通知"
              : response.pending
              ? "机器人评论已进入兜底等待，若未出现终态标签将发送通知"
              : "浏览器通知 API 已成功创建通知"
          }
        : { ok: false, message: response?.message || "浏览器通知 API 返回失败" });
    } catch (error) {
      reportPipelineNotification({
        ok: false,
        message: error instanceof Error ? error.message : "无法连接扩展后台"
      });
    }
  });

  chrome.storage.local.get(["commands", "appearance"]).then(({ commands: saved, appearance: savedAppearance }) => {
    commands = normalizeCommands(saved);
    appearance = window.GITCODE_PR_APPEARANCE.normalize(savedAppearance);
    publishAllowedCommands();
    syncPanel();
  });
})();
