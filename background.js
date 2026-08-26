"use strict";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "open-options") return false;

  chrome.tabs.create({ url: chrome.runtime.getURL("options.html") })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({
      ok: false,
      message: error instanceof Error ? error.message : "配置页打开失败"
    }));
  return true;
});
