import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const defaultsCode = fs.readFileSync(new URL("../defaults.js", import.meta.url), "utf8");
const bridgeCode = fs.readFileSync(new URL("../page-bridge.js", import.meta.url), "utf8");
const backgroundCode = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const mockEnvironmentCode = fs.readFileSync(new URL("../mock-environment.js", import.meta.url), "utf8");
const contentCode = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const optionsCode = fs.readFileSync(new URL("../options.js", import.meta.url), "utf8");
const optionsHtml = fs.readFileSync(new URL("../options.html", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

const defaultsContext = { window: {} };
vm.runInNewContext(defaultsCode, defaultsContext);
const defaults = defaultsContext.window.GITCODE_PR_DEFAULT_COMMANDS;
const appearanceApi = defaultsContext.window.GITCODE_PR_APPEARANCE;
assert.equal(defaults.length, 22);
assert.deepEqual(
  JSON.parse(JSON.stringify(defaults.filter((item) => item.enabled).map((item) => item.command))),
  ["compile", "get-log", "/lgtm", "/approve"]
);
assert.equal(manifest.version, "1.5.0");
assert.deepEqual(JSON.parse(JSON.stringify(appearanceApi.normalize())), {
  buttonColor: "#ffffff",
  panelBackgroundColor: "#ffffff",
  backgroundImage: "",
  backgroundImageFit: "cover",
  backgroundOverlayOpacity: 72
});
assert.deepEqual(JSON.parse(JSON.stringify(appearanceApi.normalize({
  buttonColor: "#AbC",
  panelBackgroundColor: "invalid",
  backgroundImage: "https://example.com/private.png",
  backgroundImageFit: "stretch",
  backgroundOverlayOpacity: 120
}))), {
  buttonColor: "#aabbcc",
  panelBackgroundColor: "#ffffff",
  backgroundImage: "",
  backgroundImageFit: "cover",
  backgroundOverlayOpacity: 100
});
const validBackgroundImage = "data:image/png;base64,iVBORw0KGgo=";
assert.equal(appearanceApi.normalize({ backgroundImage: validBackgroundImage }).backgroundImage, validBackgroundImage);
assert.equal(appearanceApi.normalize({
  backgroundImage: `data:image/png;base64,${"a".repeat(Math.ceil(appearanceApi.MAX_BACKGROUND_IMAGE_BYTES * 4 / 3) + 129)}`
}).backgroundImage, "");
const defaultTheme = appearanceApi.createThemeTokens();
assert.equal(defaultTheme.panelBackgroundCss, "rgba(255, 255, 255, 0.98)");
assert.equal(defaultTheme.buttonHover, "#f4f7ff");
assert.equal(defaultTheme.buttonHoverText, "#245bcb");
assert.equal(appearanceApi.createThemeTokens({ buttonColor: "#b42318" }).buttonText, "#ffffff");
assert.equal(appearanceApi.createThemeTokens({ buttonColor: "#fef08a" }).buttonText, "#000000");
function testLuminance(color) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrastRatio(first, second) {
  const firstLuminance = testLuminance(first);
  const secondLuminance = testLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}
for (const buttonColor of ["#000000", "#123456", "#2f6fed", "#777777", "#b42318", "#00aa00", "#fef08a"]) {
  const theme = appearanceApi.createThemeTokens({ buttonColor });
  assert.ok(contrastRatio(theme.buttonColor, theme.buttonText) >= 4.5);
  assert.ok(contrastRatio(theme.buttonHover, theme.buttonHoverText) >= 4.5);
  assert.ok(contrastRatio(theme.buttonActive, theme.buttonActiveText) >= 4.5);
}
assert.match(optionsCode, /storageArea\.set\(\{ commands, appearance: normalizedAppearance \}\)/);
assert.match(optionsCode, /MAX_BACKGROUND_IMAGE_BYTES/);
assert.match(optionsCode, /function renderPreviewButtons\(\)/);
assert.match(optionsCode, /item\.enabled && item\.label && item\.command/);
assert.doesNotMatch(optionsHtml, /禁用示例|背景遮罩强度/);
assert.match(optionsHtml, /背景图片淡化程度/);
assert.match(contentCode, /changes\.appearance/);
assert.match(contentCode, /image\.addEventListener\("error"/);

class TestCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail;
  }
}

const nuxtValues = [];
nuxtValues[1] = { id: 2, path_with_namespace: 3 };
nuxtValues[2] = 7404318;
nuxtValues[3] = "Ascend/pytorch";

const document = new EventTarget();
document.querySelector = (selector) => selector === "#__NUXT_DATA__"
  ? { textContent: JSON.stringify(nuxtValues) }
  : null;

const requests = [];
let discussionsPayload = null;
const context = {
  document,
  CustomEvent: TestCustomEvent,
  location: { origin: "https://gitcode.com", pathname: "/Ascend/pytorch/pull/123" },
  localStorage: { getItem: (key) => key === "access_token" ? "test-token" : null },
  fetch: async (url, options) => {
    requests.push({ url, options });
    if (String(url).includes("/discussions")) {
      return {
        ok: true,
        status: 200,
        clone: () => ({ json: async () => discussionsPayload }),
        text: async () => JSON.stringify(discussionsPayload)
      };
    }
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ data: { data: { id: 456 } } })
    };
  },
  Set,
  JSON,
  Number,
  Array,
  String,
  Error,
  URL,
  Request
};
context.window = context;
vm.runInNewContext(bridgeCode, context);

document.dispatchEvent(new TestCustomEvent("gitcode-pr-command:config", {
  detail: JSON.stringify(["compile"])
}));

const result = new Promise((resolve) => {
  document.addEventListener("gitcode-pr-command:result", (event) => resolve(JSON.parse(event.detail)), { once: true });
});
document.dispatchEvent(new TestCustomEvent("gitcode-pr-command:send", {
  detail: JSON.stringify({ requestId: "request-1", command: "compile" })
}));

assert.deepEqual(await result, { requestId: "request-1", ok: true, noteId: 456 });
assert.equal(requests.filter(({ url }) => !String(url).includes("/discussions")).length, 1);

const pipelineEvents = [];
let pollObservedCount = 0;
document.addEventListener("gitcode-pr-command:pipeline", (event) => {
  pipelineEvents.push(JSON.parse(event.detail));
});
document.addEventListener("gitcode-pr-command:pipeline-poll-observed", () => {
  pollObservedCount += 1;
});
discussionsPayload = {
  content: {
    data: [
      {
        id: 100,
        project: "Ascend/pytorch",
        body: "add label ci-pipeline-passed",
        action: "enterprise_label"
      },
      {
        id: "nested-note-is-not-a-pipeline-event",
        notes: [{ id: 999, body: "add label ci-pipeline-failed" }]
      }
    ]
  }
};
await context.fetch("https://web-api.gitcode.com/issuepr/api/v1/projects/Ascend%2Fpytorch/merge_requests/123/discussions?page=1&per_page=20&type=user&sort=desc");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pipelineEvents.length, 0);
assert.equal(pollObservedCount, 1);

discussionsPayload.content.data.unshift({
  id: 101,
  project: "Ascend/pytorch",
  body: "add label ci-pipeline-failed",
  action: "enterprise_label"
}, {
  id: 102,
  project: "Ascend/pytorch",
  body: "delete label ci-pipeline-failed",
  action: "enterprise_label"
}, {
  id: 103,
  project: "Ascend/pytorch",
  body: "comment mentions ci-pipeline-failed",
  action: null
});
await context.fetch("/issuepr/api/v1/projects/Ascend%2Fpytorch/merge_requests/123/discussions?page=1&per_page=100&type=user&sort=desc");
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(pipelineEvents, [{
  key: "101",
  status: "failed",
  kind: "main",
  source: "label",
  project: "Ascend/pytorch",
  iid: 123
}]);
assert.equal(pollObservedCount, 2);

document.dispatchEvent(new TestCustomEvent("gitcode-pr-command:poll-pipeline"));
await new Promise((resolve) => setImmediate(resolve));
const forcedPollRequest = requests.filter(({ url }) => String(url).includes("/discussions")).at(-1);
assert.equal(
  forcedPollRequest.url,
  "https://web-api.gitcode.com/issuepr/api/v1/projects/Ascend%2Fpytorch/merge_requests/123/discussions?page=1&per_page=20&type=user&sort=desc"
);
assert.equal(forcedPollRequest.options.method, "GET");
assert.equal(forcedPollRequest.options.headers.Authorization, "Bearer test-token");
assert.equal(pollObservedCount, 3);

discussionsPayload.content.data.unshift({
  id: 104,
  project: "Ascend/pytorch",
  body: "add label ci-pipeline-failed",
  action: "enterprise_label"
}, {
  id: 105,
  project: "Ascend/pytorch",
  body: "add label ci-pipeline-passed",
  action: "enterprise_label"
}, {
  id: 106,
  project: "Ascend/pytorch",
  body: "add label ci-pipeline-passed, cann-cla/yes",
  action: "enterprise_label"
});
await context.fetch("/issuepr/api/v1/projects/Ascend%2Fpytorch/merge_requests/123/discussions?page=1&per_page=20&type=user&sort=desc");
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(pipelineEvents.slice(-3), [{
  key: "106",
  status: "passed",
  kind: "main",
  source: "label",
  project: "Ascend/pytorch",
  iid: 123
}, {
  key: "105",
  status: "passed",
  kind: "main",
  source: "label",
  project: "Ascend/pytorch",
  iid: 123
}, {
  key: "104",
  status: "failed",
  kind: "main",
  source: "label",
  project: "Ascend/pytorch",
  iid: 123
}]);
const eventCountBeforeDuplicateResponse = pipelineEvents.length;
await context.fetch("/issuepr/api/v1/projects/Ascend%2Fpytorch/merge_requests/123/discussions?page=1&per_page=100&type=user&sort=desc");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pipelineEvents.length, eventCountBeforeDuplicateResponse);

const pipelineNote = {
  id: 1071,
  project: "Ascend/pytorch",
  author: { username: "ascend-robot" },
  created_at: "2026-08-26T10:00:00+08:00",
  updated_at: "2026-08-26T10:00:00+08:00",
  body: "流水线 PR-pipeline_pytorch#1 [ commitID：abc123 ] 已完成<table><tr><td>流水线</td><td>PR-pipeline_pytorch</td><td>&#9989;</td></tr></table>"
};
discussionsPayload.content.data.unshift({
  id: "pipeline-discussion-107",
  notes: [pipelineNote]
});
await context.fetch("/issuepr/api/v1/projects/Ascend%2Fpytorch/merge_requests/123/discussions?page=1&per_page=20&type=user&sort=desc");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pipelineEvents.at(-1).status, "passed");
assert.equal(pipelineEvents.at(-1).kind, "main");
assert.equal(pipelineEvents.at(-1).source, "comment");
assert.equal(pipelineEvents.at(-1).runKey, "PR-pipeline_pytorch#1");

const eventCountBeforeNoteUpdate = pipelineEvents.length;
pipelineNote.updated_at = "2026-08-26T10:01:00+08:00";
pipelineNote.body = "流水线 PR-pipeline_pytorch#1 [ commitID：abc123 ] 运行失败";
await context.fetch("/issuepr/api/v1/projects/Ascend%2Fpytorch/merge_requests/123/discussions?page=1&per_page=20&type=user&sort=desc");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pipelineEvents.length, eventCountBeforeNoteUpdate + 1);
assert.equal(pipelineEvents.at(-1).status, "failed");
assert.equal(pipelineEvents.at(-1).source, "comment");

discussionsPayload.content.data.unshift({
  id: 108,
  project: "Ascend/pytorch",
  body: "add label docs-ci-pipeline-success, ascend-cla/yes",
  action: "enterprise_label",
  created_at: "2026-08-26T10:02:00+08:00"
});
await context.fetch("/issuepr/api/v1/projects/Ascend%2Fpytorch/merge_requests/123/discussions?page=1&per_page=20&type=user&sort=desc");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pipelineEvents.at(-1).status, "passed");
assert.equal(pipelineEvents.at(-1).kind, "docs");
assert.equal(pipelineEvents.at(-1).source, "label");

const eventCountBeforeCursorRebase = pipelineEvents.length;

discussionsPayload.content.data = [{
  id: 200,
  project: "Ascend/pytorch",
  body: "add label ci-pipeline-failed",
  action: "enterprise_label"
}];
await context.fetch("/issuepr/api/v1/projects/Ascend%2Fpytorch/merge_requests/123/discussions?page=1&per_page=20&type=user&sort=desc");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pipelineEvents.length, eventCountBeforeCursorRebase);

discussionsPayload.content.data.unshift({
  id: 201,
  project: "Ascend/pytorch",
  body: "add label ci-pipeline-passed",
  action: "enterprise_label"
});
await context.fetch("/issuepr/api/v1/projects/Ascend%2Fpytorch/merge_requests/123/discussions?page=1&per_page=20&type=user&sort=desc");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pipelineEvents.at(-1).key, "201");
assert.equal(pipelineEvents.at(-1).status, "passed");

assert.equal(requests[0].url, "/issuepr/api/v1/projects/7404318/merge_requests/123/notes");
assert.equal(requests[0].options.method, "POST");
assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");
assert.deepEqual(JSON.parse(requests[0].options.body), { body: "compile", need_to_resolve: false });

context.location.pathname = "/Ascend/pytorch/merge_requests/45241";
const mergeRequestResult = new Promise((resolve) => {
  document.addEventListener("gitcode-pr-command:result", (event) => resolve(JSON.parse(event.detail)), { once: true });
});
document.dispatchEvent(new TestCustomEvent("gitcode-pr-command:send", {
  detail: JSON.stringify({ requestId: "request-merge-route", command: "compile" })
}));
assert.equal((await mergeRequestResult).ok, true);
assert.equal(
  requests.filter(({ url }) => !String(url).includes("/discussions")).at(-1).url,
  "/issuepr/api/v1/projects/7404318/merge_requests/45241/notes"
);
context.location.pathname = "/Ascend/pytorch/pull/123";

const rejected = new Promise((resolve) => {
  document.addEventListener("gitcode-pr-command:result", (event) => resolve(JSON.parse(event.detail)), { once: true });
});
document.dispatchEvent(new TestCustomEvent("gitcode-pr-command:send", {
  detail: JSON.stringify({ requestId: "request-2", command: "/approve" })
}));
const rejectedResult = await rejected;
assert.equal(rejectedResult.ok, false);
assert.match(rejectedResult.message, /当前插件配置/);
assert.equal(requests.filter(({ url }) => !String(url).includes("/discussions")).length, 2);

const mockDocument = new EventTarget();
mockDocument.querySelector = () => null;
const mockContext = {
  document: mockDocument,
  CustomEvent: TestCustomEvent,
  location: { origin: "chrome-extension://test-extension", pathname: "/mock.html" },
  localStorage: { getItem: () => null },
  fetch: async () => { throw new Error("Mock environment unexpectedly used the network"); },
  Response,
  Request,
  URL,
  Set,
  Map,
  JSON,
  Number,
  Array,
  String,
  Error,
  Date
};
mockContext.window = mockContext;
vm.runInNewContext(mockEnvironmentCode, mockContext);
vm.runInNewContext(bridgeCode, mockContext);

const mockPipelineEvents = [];
mockDocument.addEventListener("gitcode-pr-command:pipeline", (event) => {
  mockPipelineEvents.push(JSON.parse(event.detail));
});
await mockContext.GITCODE_PR_NOTIFICATION_MOCK.establishBaseline();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(mockPipelineEvents.length, 0);
mockContext.GITCODE_PR_NOTIFICATION_MOCK.queuePipelineEvent("failed");
mockDocument.dispatchEvent(new TestCustomEvent("gitcode-pr-command:poll-pipeline"));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(mockPipelineEvents.length, 1);
assert.equal(mockPipelineEvents[0].status, "failed");
assert.equal(mockPipelineEvents[0].project, "Local/mock-repo");
assert.equal(mockPipelineEvents[0].iid, 9527);

let messageListener = null;
let openOptionsCalls = 0;
let finishOpeningOptions;
const createdNotifications = [];
let sessionValues = {};
let alarmState = null;
let alarmListener = null;
let removedTabListener = null;
let pollingTimer = null;
const sentTabMessages = [];
const backgroundContext = {
  chrome: {
    alarms: {
      get: async () => alarmState,
      create: async (name, options) => { alarmState = { name, ...options }; },
      clear: async (name) => {
        const cleared = alarmState?.name === name;
        if (cleared) alarmState = null;
        return cleared;
      },
      onAlarm: { addListener: (listener) => { alarmListener = listener; } }
    },
    tabs: {
      sendMessage: async (tabId, message) => { sentTabMessages.push({ tabId, message }); },
      onRemoved: { addListener: (listener) => { removedTabListener = listener; } }
    },
    notifications: {
      create: async (id, options) => { createdNotifications.push({ id, options }); }
    },
    storage: {
      session: {
        get: async () => sessionValues,
        set: async (values) => { sessionValues = { ...sessionValues, ...values }; }
      }
    },
    runtime: {
      openOptionsPage: () => {
        openOptionsCalls += 1;
        return new Promise((resolve) => { finishOpeningOptions = resolve; });
      },
      onMessage: { addListener: (listener) => { messageListener = listener; } }
    }
  },
  setInterval: (callback, delay) => {
    pollingTimer = { callback, delay };
    return 1;
  },
  clearInterval: () => { pollingTimer = null; },
  URL,
  Error
};
vm.runInNewContext(backgroundCode, backgroundContext);
assert.equal(typeof messageListener, "function");
assert.equal(typeof alarmListener, "function");
assert.equal(typeof removedTabListener, "function");

const monitorResult = new Promise((resolve) => {
  assert.equal(messageListener({
    type: "register-pipeline-monitor",
    active: false,
    stateAt: 1000,
    url: "https://gitcode.com/Ascend/pytorch/merge_requests/45241"
  }, { tab: { id: 77 } }, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await monitorResult)), { ok: true });
assert.equal(sessionValues.pipelineMonitors.length, 1);
assert.equal(sessionValues.pipelineMonitors[0].tabId, 77);
assert.equal(sessionValues.pipelineMonitors[0].active, false);
assert.equal(sessionValues.pipelineMonitors[0].stateAt, 1000);
assert.equal(sessionValues.pipelineMonitors[0].url, "https://gitcode.com/Ascend/pytorch/merge_requests/45241");
assert.equal(alarmState.name, "gitcode-pipeline-monitor");
assert.equal(alarmState.periodInMinutes, 0.5);
assert.equal(pollingTimer.delay, 5000);
assert.equal(sentTabMessages.length, 0);

sessionValues.pipelineMonitors[0].lastResponseAt = Date.now() - 16000;
pollingTimer.callback();
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(JSON.parse(JSON.stringify(sentTabMessages.at(-1))), {
  tabId: 77,
  message: { type: "poll-pipeline" }
});
assert.ok(sessionValues.pipelineMonitors[0].lastForcedAt > 0);

const messagesAfterForcedPoll = sentTabMessages.length;
pollingTimer.callback();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(sentTabMessages.length, messagesAfterForcedPoll);

const heartbeatResult = new Promise((resolve) => {
  assert.equal(messageListener({
    type: "pipeline-poll-observed",
    active: false,
    observedAt: Date.now(),
    stateAt: 2000,
    url: "https://gitcode.com/Ascend/pytorch/merge_requests/45241"
  }, { tab: { id: 77 } }, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await heartbeatResult)), { ok: true });
const messagesBeforeFreshHeartbeatCheck = sentTabMessages.length;
pollingTimer.callback();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(sentTabMessages.length, messagesBeforeFreshHeartbeatCheck);

const messagesBeforeAlarm = sentTabMessages.length;
alarmListener({ name: "gitcode-pipeline-monitor" });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(sentTabMessages.length, messagesBeforeAlarm);

const activeMonitorResult = new Promise((resolve) => {
  assert.equal(messageListener({
    type: "register-pipeline-monitor",
    active: true,
    stateAt: 3000,
    url: "https://gitcode.com/Ascend/pytorch/merge_requests/45241"
  }, { tab: { id: 77 } }, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await activeMonitorResult)), { ok: true });
sessionValues.pipelineMonitors[0].lastResponseAt = 0;
sessionValues.pipelineMonitors[0].lastForcedAt = 0;
alarmListener({ name: "gitcode-pipeline-monitor" });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(sentTabMessages.length, messagesBeforeAlarm);

const staleStateResult = new Promise((resolve) => {
  assert.equal(messageListener({
    type: "register-pipeline-monitor",
    active: false,
    stateAt: 2500,
    url: "https://gitcode.com/Ascend/pytorch/merge_requests/45241"
  }, { tab: { id: 77 } }, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await staleStateResult)), { ok: true });
assert.equal(sessionValues.pipelineMonitors[0].active, true);
const openResult = new Promise((resolve) => {
  assert.equal(messageListener({ type: "open-options" }, {}, resolve), true);
});
const repeatedOpenResult = new Promise((resolve) => {
  assert.equal(messageListener({ type: "open-options" }, {}, resolve), true);
});
assert.equal(openOptionsCalls, 1);
finishOpeningOptions();
assert.deepEqual(JSON.parse(JSON.stringify(await openResult)), { ok: true });
assert.deepEqual(JSON.parse(JSON.stringify(await repeatedOpenResult)), { ok: true });

const notificationMessage = {
  type: "notify-ci-pipeline",
  pipeline: {
    key: "101",
    status: "failed",
    kind: "main",
    source: "label",
    project: "Ascend/pytorch",
    iid: 123,
    title: "Fix flaky test"
  }
};
const notificationResult = new Promise((resolve) => {
  assert.equal(messageListener(notificationMessage, {}, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await notificationResult)), { ok: true, pending: false, skipped: false });
assert.equal(createdNotifications.length, 1);
assert.match(createdNotifications[0].options.title, /流水线失败.*Ascend\/pytorch #123/);
assert.equal(createdNotifications[0].options.message, "Fix flaky test");
assert.equal(createdNotifications[0].options.iconUrl, "icons/pipeline-failed128.png");

const duplicateNotificationResult = new Promise((resolve) => {
  assert.equal(messageListener(notificationMessage, {}, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await duplicateNotificationResult)), { ok: true, pending: false, skipped: false });
assert.equal(createdNotifications.length, 1);

const passedNotificationResult = new Promise((resolve) => {
  assert.equal(messageListener({
    ...notificationMessage,
    pipeline: { ...notificationMessage.pipeline, key: "102", status: "passed" }
  }, {}, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await passedNotificationResult)), { ok: true, pending: false, skipped: false });
assert.equal(createdNotifications.length, 2);
assert.equal(createdNotifications[1].options.iconUrl, "icons/pipeline-passed128.png");

const docsNotificationResult = new Promise((resolve) => {
  assert.equal(messageListener({
    ...notificationMessage,
    pipeline: {
      ...notificationMessage.pipeline,
      key: "docs-103",
      kind: "docs",
      status: "failed"
    }
  }, {}, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await docsNotificationResult)), { ok: true, pending: false, skipped: false });
assert.equal(createdNotifications.length, 3);
assert.match(createdNotifications[2].options.title, /文档流水线失败.*Ascend\/pytorch #123/);
assert.equal(createdNotifications[2].options.iconUrl, "icons/pipeline-failed128.png");

const commentFallbackMessage = {
  type: "notify-ci-pipeline",
  pipeline: {
    key: "note-104:updated",
    status: "failed",
    kind: "main",
    source: "comment",
    runKey: "PR-pipeline_pytorch#104",
    project: "Ascend/pytorch",
    iid: 123,
    title: "Fix flaky test"
  }
};
const commentFallbackResult = new Promise((resolve) => {
  assert.equal(messageListener(commentFallbackMessage, {}, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await commentFallbackResult)), { ok: true, pending: true });
assert.equal(createdNotifications.length, 3);
assert.equal(sessionValues.pendingPipelineComments.length, 1);

sessionValues.pendingPipelineComments[0].dueAt = Date.now() - 1;
sessionValues.pipelineMonitors[0].active = false;
pollingTimer.callback();
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(createdNotifications.length, 4);
assert.match(createdNotifications[3].options.contextMessage, /机器人评论兜底/);
assert.equal(sessionValues.pendingPipelineComments.length, 0);

const cancellableCommentResult = new Promise((resolve) => {
  assert.equal(messageListener({
    ...commentFallbackMessage,
    pipeline: {
      ...commentFallbackMessage.pipeline,
      key: "note-105:updated",
      runKey: "PR-pipeline_pytorch#105"
    }
  }, {}, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await cancellableCommentResult)), { ok: true, pending: true });
assert.equal(sessionValues.pendingPipelineComments.length, 1);

const cancellingLabelResult = new Promise((resolve) => {
  assert.equal(messageListener({
    ...notificationMessage,
    pipeline: {
      ...notificationMessage.pipeline,
      key: "label-105",
      status: "failed",
      kind: "main",
      source: "label"
    }
  }, {}, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await cancellingLabelResult)), { ok: true, pending: false, skipped: false });
assert.equal(sessionValues.pendingPipelineComments.length, 0);
assert.equal(createdNotifications.length, 5);

const activePageCommentResult = new Promise((resolve) => {
  assert.equal(messageListener({
    ...commentFallbackMessage,
    pipeline: {
      ...commentFallbackMessage.pipeline,
      key: "note-106:updated",
      runKey: "PR-pipeline_pytorch#106"
    }
  }, {}, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await activePageCommentResult)), { ok: true, pending: true });
sessionValues.pendingPipelineComments[0].dueAt = Date.now() - 1;
sessionValues.pipelineMonitors[0].active = true;
sessionValues.pipelineMonitors[0].url = "https://gitcode.com/Ascend/pytorch/pull/123";
pollingTimer.callback();
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(sessionValues.pendingPipelineComments.length, 0);
assert.equal(createdNotifications.length, 5);

const foregroundPendingResult = new Promise((resolve) => {
  assert.equal(messageListener({
    ...commentFallbackMessage,
    pipeline: {
      ...commentFallbackMessage.pipeline,
      key: "note-107:updated",
      runKey: "PR-pipeline_pytorch#107"
    }
  }, {}, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await foregroundPendingResult)), { ok: true, pending: true });
const foregroundLabelResult = new Promise((resolve) => {
  assert.equal(messageListener({
    ...notificationMessage,
    pipeline: {
      ...notificationMessage.pipeline,
      key: "label-107",
      status: "passed",
      kind: "main",
      source: "label",
      suppressNotification: true
    }
  }, {}, resolve), true);
});
assert.deepEqual(JSON.parse(JSON.stringify(await foregroundLabelResult)), {
  ok: true,
  pending: false,
  skipped: true
});
assert.equal(sessionValues.pendingPipelineComments.length, 0);
assert.equal(createdNotifications.length, 5);

console.log("Smoke tests passed");
