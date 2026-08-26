(() => {
  "use strict";

  const mock = window.GITCODE_PR_NOTIFICATION_MOCK;
  const baselineStatus = document.querySelector("#baseline-status");
  const visibilityStatus = document.querySelector("#visibility-status");
  const testStatus = document.querySelector("#test-status");
  const buttons = [...document.querySelectorAll(".test-button")];
  let testPending = false;

  function updateVisibility() {
    const foreground = document.visibilityState === "visible" && document.hasFocus();
    visibilityStatus.textContent = foreground ? "前台（通知会被抑制）" : "非前台（允许通知）";
  }

  function setButtonsDisabled(disabled) {
    buttons.forEach((button) => { button.disabled = disabled; });
  }

  async function initialize() {
    try {
      await mock.establishBaseline();
      baselineStatus.textContent = "已建立（历史事件不会通知）";
    } catch (error) {
      baselineStatus.textContent = error instanceof Error ? error.message : "建立失败";
      setButtonsDisabled(true);
    }
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      if (testPending) return;
      testPending = true;
      setButtonsDisabled(true);
      const status = button.dataset.status;
      const label = status === "passed" ? "通过" : "失败";
      mock.queuePipelineEvent(status);
      testStatus.textContent = `流水线${label}事件已排队。请切走本页面；连续15秒无轮询心跳后，扩展会主动补请求…`;
    });
  });

  document.addEventListener("gitcode-pr-command:pipeline-notification-result", (event) => {
    try {
      const result = JSON.parse(event.detail);
      testStatus.textContent = result.ok
        ? `${result.message}。如果仍未弹出，请检查 Windows 和浏览器的通知设置。`
        : `未创建通知：${result.message}`;
    } catch {
      testStatus.textContent = "无法解析通知结果";
    } finally {
      testPending = false;
      setButtonsDisabled(false);
    }
  });

  document.addEventListener("visibilitychange", updateVisibility);
  window.addEventListener("focus", updateVisibility);
  window.addEventListener("blur", updateVisibility);
  updateVisibility();
  initialize();
})();
