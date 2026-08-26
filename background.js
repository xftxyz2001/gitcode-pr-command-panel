"use strict";

let openingOptionsPage = null;

function openOptionsPage() {
  if (!openingOptionsPage) {
    // Chrome will focus the existing options page instead of creating another tab.
    openingOptionsPage = chrome.runtime.openOptionsPage()
      .finally(() => { openingOptionsPage = null; });
  }
  return openingOptionsPage;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "open-options") return false;

  openOptionsPage()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({
      ok: false,
      message: error instanceof Error ? error.message : "配置页打开失败"
    }));
  return true;
});
