"use strict";

let openingOptionsPage = null;
const pipelineNotifications = new Set();
const PIPELINE_MONITORS_KEY = "pipelineMonitors";
const PENDING_PIPELINE_COMMENTS_KEY = "pendingPipelineComments";
const PENDING_FAILED_PIPELINE_LABELS_KEY = "pendingFailedPipelineLabels";
const RECENT_PIPELINE_LABELS_KEY = "recentPipelineLabels";
const PIPELINE_NOTIFICATION_CONTEXTS_KEY = "pipelineNotificationContexts";
const PIPELINE_ALARM_NAME = "gitcode-pipeline-monitor";
const PIPELINE_WATCHDOG_INTERVAL_MS = 5000;
const PIPELINE_STALE_AFTER_MS = 15000;
const FAILED_LABEL_DETAILS_WAIT_MS = 60000;
const PIPELINE_EVENT_MATCH_WINDOW_MS = FAILED_LABEL_DETAILS_WAIT_MS;
const RECENT_PIPELINE_LABEL_RETENTION_MS = 10 * 60 * 1000;
const PIPELINE_COMMENT_FALLBACK_DELAY_MS = 90000;
let pipelinePollTimer = null;
let pipelineMonitorMutation = Promise.resolve();
const pipelineNotificationIcons = {
  passed: "icons/pipeline-passed128.png",
  failed: "icons/pipeline-failed128.png"
};

async function readPipelineMonitors() {
  const result = await chrome.storage.session.get(PIPELINE_MONITORS_KEY);
  return Array.isArray(result[PIPELINE_MONITORS_KEY]) ? result[PIPELINE_MONITORS_KEY] : [];
}

async function writePipelineMonitors(monitors) {
  await chrome.storage.session.set({ [PIPELINE_MONITORS_KEY]: monitors });
}

async function readPendingPipelineComments() {
  const result = await chrome.storage.session.get(PENDING_PIPELINE_COMMENTS_KEY);
  return Array.isArray(result[PENDING_PIPELINE_COMMENTS_KEY]) ? result[PENDING_PIPELINE_COMMENTS_KEY] : [];
}

async function writePendingPipelineComments(pending) {
  await chrome.storage.session.set({ [PENDING_PIPELINE_COMMENTS_KEY]: pending });
}

async function readPendingFailedPipelineLabels() {
  const result = await chrome.storage.session.get(PENDING_FAILED_PIPELINE_LABELS_KEY);
  return Array.isArray(result[PENDING_FAILED_PIPELINE_LABELS_KEY])
    ? result[PENDING_FAILED_PIPELINE_LABELS_KEY]
    : [];
}

async function writePendingFailedPipelineLabels(pending) {
  await chrome.storage.session.set({ [PENDING_FAILED_PIPELINE_LABELS_KEY]: pending });
}

async function readRecentPipelineLabels() {
  const result = await chrome.storage.session.get(RECENT_PIPELINE_LABELS_KEY);
  return Array.isArray(result[RECENT_PIPELINE_LABELS_KEY]) ? result[RECENT_PIPELINE_LABELS_KEY] : [];
}

async function writeRecentPipelineLabels(recent) {
  await chrome.storage.session.set({ [RECENT_PIPELINE_LABELS_KEY]: recent });
}

async function readPipelineNotificationContexts() {
  const result = await chrome.storage.session.get(PIPELINE_NOTIFICATION_CONTEXTS_KEY);
  const contexts = result[PIPELINE_NOTIFICATION_CONTEXTS_KEY];
  return contexts && typeof contexts === "object" && !Array.isArray(contexts) ? contexts : {};
}

async function writePipelineNotificationContexts(contexts) {
  await chrome.storage.session.set({ [PIPELINE_NOTIFICATION_CONTEXTS_KEY]: contexts });
}

function normalizePrUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "gitcode.com") return "";
    if (!/^\/[^/]+\/[^/]+\/(?:pull|merge_requests)\/\d+\/?$/i.test(url.pathname)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizePipelineUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (hostname !== "openlibing.com" && !hostname.endsWith(".openlibing.com"))) return "";
    if (url.pathname !== "/apps/pipelineDetail") return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function getPrKey(value) {
  const prUrl = normalizePrUrl(value);
  if (!prUrl) return "";
  const match = new URL(prUrl).pathname.match(/^\/([^/]+)\/([^/]+)\/(?:pull|merge_requests)\/(\d+)\/?$/i);
  if (!match) return "";
  try {
    return `${decodeURIComponent(match[1]).toLowerCase()}/${decodeURIComponent(match[2]).toLowerCase()}#${match[3]}`;
  } catch {
    return `${match[1].toLowerCase()}/${match[2].toLowerCase()}#${match[3]}`;
  }
}

async function savePipelineNotificationContext(notificationId, pipeline) {
  const context = {
    prUrl: normalizePrUrl(pipeline.url),
    pipelineUrl: normalizePipelineUrl(pipeline.pipelineUrl),
    createdAt: Date.now()
  };
  const contexts = await readPipelineNotificationContexts();
  const recentEntries = Object.entries(contexts)
    .sort(([, left], [, right]) => (Number(left?.createdAt) || 0) - (Number(right?.createdAt) || 0))
    .slice(-99);
  await writePipelineNotificationContexts({ ...Object.fromEntries(recentEntries), [notificationId]: context });
  return context;
}

async function removePipelineNotificationContext(notificationId) {
  const contexts = await readPipelineNotificationContexts();
  if (!Object.hasOwn(contexts, notificationId)) return;
  delete contexts[notificationId];
  await writePipelineNotificationContexts(contexts);
}

async function focusOrOpenPr(prUrl) {
  const targetKey = getPrKey(prUrl);
  if (!targetKey) return false;
  const monitors = await readPipelineMonitors();
  const monitor = monitors.find((item) => getPrKey(item.url) === targetKey);
  if (monitor) {
    try {
      const tab = await chrome.tabs.update(monitor.tabId, { active: true });
      if (Number.isInteger(tab?.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
      return true;
    } catch {
      await writePipelineMonitors(monitors.filter((item) => item.tabId !== monitor.tabId));
    }
  }
  await chrome.tabs.create({ url: normalizePrUrl(prUrl), active: true });
  return true;
}

async function handlePipelineNotificationAction(notificationId, buttonIndex = null) {
  const contexts = await readPipelineNotificationContexts();
  const context = contexts[notificationId];
  if (!context) return;
  let handled = false;
  if (buttonIndex === null) handled = await focusOrOpenPr(context.prUrl);
  else if (buttonIndex === 0 && context.pipelineUrl) {
    await chrome.tabs.create({ url: context.pipelineUrl, active: true });
    handled = true;
  }
  if (!handled) return;
  await removePipelineNotificationContext(notificationId);
  await chrome.notifications.clear(notificationId);
}

function queuePipelineMonitorMutation(action) {
  const result = pipelineMonitorMutation.then(action, action);
  pipelineMonitorMutation = result.catch(() => {});
  return result;
}

async function ensurePipelineAlarm() {
  const alarm = await chrome.alarms.get(PIPELINE_ALARM_NAME);
  if (!alarm) {
    await chrome.alarms.create(PIPELINE_ALARM_NAME, {
      delayInMinutes: 0.5,
      periodInMinutes: 0.5
    });
  }
}

async function pollInactivePipelineTabs() {
  const monitors = await readPipelineMonitors();
  const now = Date.now();
  const staleTabIds = [];
  const dueMonitors = monitors.filter((monitor) => {
    const lastActivityAt = Math.max(
      Number(monitor.lastResponseAt) || 0,
      Number(monitor.lastForcedAt) || 0
    );
    return !monitor.active && now - lastActivityAt >= PIPELINE_STALE_AFTER_MS;
  });
  await Promise.all(dueMonitors.map(async (monitor) => {
    try {
      await chrome.tabs.sendMessage(monitor.tabId, { type: "poll-pipeline" });
      monitor.lastForcedAt = now;
    } catch {
      staleTabIds.push(monitor.tabId);
    }
  }));
  if (dueMonitors.length || staleTabIds.length) {
    await writePipelineMonitors(monitors.filter((monitor) => !staleTabIds.includes(monitor.tabId)));
  }
}

async function syncPipelinePolling() {
  const monitors = await readPipelineMonitors();
  const pendingComments = await readPendingPipelineComments();
  const pendingFailedLabels = await readPendingFailedPipelineLabels();
  if (monitors.length || pendingComments.length || pendingFailedLabels.length) {
    await ensurePipelineAlarm();
    if (!pipelinePollTimer) {
      pipelinePollTimer = setInterval(() => {
        queuePipelineMonitorMutation(runPipelineMaintenance).catch(() => {});
      }, PIPELINE_WATCHDOG_INTERVAL_MS);
    }
  } else {
    await chrome.alarms.clear(PIPELINE_ALARM_NAME);
    if (pipelinePollTimer) {
      clearInterval(pipelinePollTimer);
      pipelinePollTimer = null;
    }
  }
}

async function registerPipelineMonitor(tabId, message) {
  const monitors = await readPipelineMonitors();
  const previous = monitors.find((monitor) => monitor.tabId === tabId);
  const stateAt = Number(message.stateAt) || Date.now();
  if (previous && stateAt < (Number(previous.stateAt) || 0)) return;
  const next = monitors.filter((monitor) => monitor.tabId !== tabId);
  const becameInactive = previous?.active !== false && !message.active;
  next.push({
    tabId,
    active: Boolean(message.active),
    url: String(message.url || previous?.url || ""),
    stateAt,
    lastResponseAt: becameInactive
      ? Date.now()
      : Number(previous?.lastResponseAt) || Date.now(),
    lastForcedAt: Number(previous?.lastForcedAt) || 0
  });
  await writePipelineMonitors(next);
  await syncPipelinePolling();
}

async function recordPipelineResponse(tabId, message) {
  const monitors = await readPipelineMonitors();
  const previous = monitors.find((monitor) => monitor.tabId === tabId);
  const stateAt = Number(message.stateAt) || Date.now();
  if (previous && stateAt < (Number(previous.stateAt) || 0)) return;
  const next = monitors.filter((monitor) => monitor.tabId !== tabId);
  next.push({
    tabId,
    active: Boolean(message.active),
    url: String(message.url || previous?.url || ""),
    stateAt,
    lastResponseAt: Number(message.observedAt) || Date.now(),
    lastForcedAt: 0
  });
  await writePipelineMonitors(next);
  await syncPipelinePolling();
}

async function unregisterPipelineMonitor(tabId) {
  const monitors = await readPipelineMonitors();
  await writePipelineMonitors(monitors.filter((monitor) => monitor.tabId !== tabId));
  await syncPipelinePolling();
}

async function showPipelineNotification(pipeline) {
  if (!pipeline || !["passed", "failed"].includes(pipeline.status)) {
    throw new Error("流水线通知数据无效");
  }
  const kind = pipeline.kind === "docs" ? "docs" : "main";
  const dedupeKey = `${pipeline.project}#${pipeline.iid}:${kind}:${pipeline.key}:${pipeline.status}`;
  if (pipelineNotifications.has(dedupeKey)) return;
  pipelineNotifications.add(dedupeKey);

  try {
    const { pipelineNotificationKeys = [] } = await chrome.storage.session.get("pipelineNotificationKeys");
    if (pipelineNotificationKeys.includes(dedupeKey)) return;

    const passed = pipeline.status === "passed";
    const pipelineName = kind === "docs" ? "文档流水线" : "流水线";
    const notificationId = `gitcode-ci:${dedupeKey}`;
    const context = await savePipelineNotificationContext(notificationId, pipeline);
    const options = {
      type: "basic",
      iconUrl: pipelineNotificationIcons[pipeline.status],
      title: `${pipelineName}${passed ? "通过" : "失败"} · ${pipeline.project} #${pipeline.iid}`,
      message: pipeline.title || "未获取到 PR 标题",
      contextMessage: pipeline.source === "comment"
        ? `GitCode PR ${pipelineName}（机器人评论兜底）`
        : `GitCode PR ${pipelineName}`,
      priority: passed ? 1 : 2
    };
    if (context.pipelineUrl) options.buttons = [{ title: "查看流水线详情" }];
    try {
      await chrome.notifications.create(notificationId, options);
    } catch (error) {
      await removePipelineNotificationContext(notificationId);
      throw error;
    }
    await chrome.storage.session.set({
      pipelineNotificationKeys: [...pipelineNotificationKeys.slice(-199), dedupeKey]
    });
  } catch (error) {
    pipelineNotifications.delete(dedupeKey);
    throw error;
  }
}

async function enqueuePipelineComment(pipeline) {
  const pending = await readPendingPipelineComments();
  const kind = pipeline.kind === "docs" ? "docs" : "main";
  const runKey = String(pipeline.runKey || pipeline.key || "unknown-run");
  const next = pending.filter((item) => !(
    item.pipeline?.project === pipeline.project
    && Number(item.pipeline?.iid) === Number(pipeline.iid)
    && (item.pipeline?.kind === "docs" ? "docs" : "main") === kind
    && String(item.pipeline?.runKey || item.pipeline?.key || "unknown-run") === runKey
  ));
  next.push({
    observedAt: Date.now(),
    dueAt: Date.now() + PIPELINE_COMMENT_FALLBACK_DELAY_MS,
    pipeline: { ...pipeline, kind, runKey }
  });
  await writePendingPipelineComments(next);
  await syncPipelinePolling();
}

function isSamePipelineScope(left, right) {
  return left?.project === right?.project
    && Number(left?.iid) === Number(right?.iid)
    && (left?.kind === "docs" ? "docs" : "main") === (right?.kind === "docs" ? "docs" : "main");
}

function isRelatedPipelineEvent(left, right) {
  if (!isSamePipelineScope(left, right) || left?.status !== right?.status) return false;
  const leftEventAt = Number(left?.eventAt) || 0;
  const rightEventAt = Number(right?.eventAt) || 0;
  return leftEventAt && rightEventAt
    ? Math.abs(leftEventAt - rightEventAt) <= PIPELINE_EVENT_MATCH_WINDOW_MS
    : true;
}

async function recordRecentPipelineLabel(pipeline) {
  const now = Date.now();
  const recent = await readRecentPipelineLabels();
  const next = recent.filter((item) => (
    Number(item.expiresAt) > now
    && !isSamePipelineScope(item.pipeline, pipeline)
  ));
  next.push({
    recordedAt: now,
    expiresAt: now + RECENT_PIPELINE_LABEL_RETENTION_MS,
    pipeline: {
      project: pipeline.project,
      iid: pipeline.iid,
      kind: pipeline.kind === "docs" ? "docs" : "main",
      status: pipeline.status,
      eventAt: Number(pipeline.eventAt) || 0
    }
  });
  await writeRecentPipelineLabels(next);
}

async function hasRecentPipelineLabel(pipeline) {
  const now = Date.now();
  const recent = await readRecentPipelineLabels();
  const active = recent.filter((item) => Number(item.expiresAt) > now);
  if (active.length !== recent.length) await writeRecentPipelineLabels(active);
  return active.some((item) => {
    if (!isRelatedPipelineEvent(item.pipeline, pipeline)) return false;
    if (Number(item.pipeline?.eventAt) && Number(pipeline?.eventAt)) return true;
    return now - (Number(item.recordedAt) || 0) <= PIPELINE_EVENT_MATCH_WINDOW_MS;
  });
}

async function showLabelPipelineNotification(pipeline) {
  await showPipelineNotification({ ...pipeline, source: "label" });
  await recordRecentPipelineLabel(pipeline);
}

async function cancelPendingPipelineComments(pipeline) {
  const pending = await readPendingPipelineComments();
  const next = pending.filter((item) => !isSamePipelineScope(item.pipeline, pipeline));
  if (next.length !== pending.length) await writePendingPipelineComments(next);
}

async function takePendingPipelineComment(pipeline) {
  const pending = await readPendingPipelineComments();
  const now = Date.now();
  const matches = pending.filter((item) => (
    isRelatedPipelineEvent(item.pipeline, pipeline)
    && now - (Number(item.observedAt) || 0) <= FAILED_LABEL_DETAILS_WAIT_MS
  ));
  const next = pending.filter((item) => !isSamePipelineScope(item.pipeline, pipeline));
  if (next.length !== pending.length) await writePendingPipelineComments(next);
  return matches.at(-1)?.pipeline || null;
}

async function cancelPendingFailedPipelineLabels(pipeline) {
  const pending = await readPendingFailedPipelineLabels();
  const next = pending.filter((item) => !isSamePipelineScope(item.pipeline, pipeline));
  if (next.length !== pending.length) await writePendingFailedPipelineLabels(next);
}

async function enqueueFailedPipelineLabel(pipeline) {
  const pendingComment = await takePendingPipelineComment(pipeline);
  if (pendingComment) {
    await showLabelPipelineNotification({
      ...pipeline,
      runKey: pendingComment.runKey,
      pipelineUrl: pendingComment.pipelineUrl
    });
    await syncPipelinePolling();
    return { pending: false, skipped: false, detailsFound: Boolean(pendingComment.pipelineUrl) };
  }

  const pendingLabels = await readPendingFailedPipelineLabels();
  const next = pendingLabels.filter((item) => !isSamePipelineScope(item.pipeline, pipeline));
  next.push({
    dueAt: Date.now() + FAILED_LABEL_DETAILS_WAIT_MS,
    pipeline: { ...pipeline, source: "label", pipelineUrl: "" }
  });
  await writePendingFailedPipelineLabels(next);
  await syncPipelinePolling();
  return { pending: true, skipped: false, detailsFound: false };
}

async function resolvePendingFailedPipelineLabel(pipeline) {
  const pendingLabels = await readPendingFailedPipelineLabels();
  const match = pendingLabels.find((item) => isRelatedPipelineEvent(item.pipeline, pipeline));
  if (!match) return null;
  await writePendingFailedPipelineLabels(
    pendingLabels.filter((item) => !isSamePipelineScope(item.pipeline, pipeline))
  );
  await showLabelPipelineNotification({
    ...match.pipeline,
    runKey: pipeline.runKey,
    pipelineUrl: pipeline.pipelineUrl
  });
  await syncPipelinePolling();
  return { pending: false, skipped: false, detailsFound: Boolean(pipeline.pipelineUrl) };
}

function isPipelinePageActive(monitors, pipeline) {
  const projectPath = String(pipeline?.project || "").toLowerCase();
  const iid = Number(pipeline?.iid);
  return monitors.some((monitor) => {
    if (!monitor.active) return false;
    try {
      const pathname = new URL(monitor.url).pathname.toLowerCase();
      return pathname.startsWith(`/${projectPath}/pull/${iid}`)
        || pathname.startsWith(`/${projectPath}/merge_requests/${iid}`);
    } catch {
      return false;
    }
  });
}

async function processPendingPipelineComments() {
  const pending = await readPendingPipelineComments();
  if (!pending.length) return;
  const now = Date.now();
  const monitors = await readPipelineMonitors();
  const next = [];
  for (const item of pending) {
    if (Number(item.dueAt) > now) {
      next.push(item);
      continue;
    }
    if (isPipelinePageActive(monitors, item.pipeline)) continue;
    try {
      await showPipelineNotification(item.pipeline);
    } catch {
      next.push({ ...item, dueAt: now + 30000 });
    }
  }
  await writePendingPipelineComments(next);
}

async function processPendingFailedPipelineLabels() {
  const pending = await readPendingFailedPipelineLabels();
  if (!pending.length) return;
  const now = Date.now();
  const monitors = await readPipelineMonitors();
  const next = [];
  for (const item of pending) {
    if (Number(item.dueAt) > now) {
      next.push(item);
      continue;
    }
    if (isPipelinePageActive(monitors, item.pipeline)) continue;
    try {
      await showLabelPipelineNotification({ ...item.pipeline, pipelineUrl: "" });
    } catch {
      next.push({ ...item, dueAt: now + 30000 });
    }
  }
  await writePendingFailedPipelineLabels(next);
}

async function handlePipelineNotification(pipeline) {
  if (!pipeline || !["passed", "failed"].includes(pipeline.status)) {
    throw new Error("流水线通知数据无效");
  }
  if (pipeline.source === "comment") {
    if (pipeline.status === "failed" && (pipeline.kind === "docs" ? "docs" : "main") === "main") {
      const resolvedLabel = await resolvePendingFailedPipelineLabel(pipeline);
      if (resolvedLabel) return resolvedLabel;
    }
    if (await hasRecentPipelineLabel(pipeline)) {
      return { pending: false, skipped: true, detailsFound: false };
    }
    await enqueuePipelineComment(pipeline);
    return { pending: true };
  }
  if (pipeline.suppressNotification) {
    await cancelPendingPipelineComments(pipeline);
    await cancelPendingFailedPipelineLabels(pipeline);
    await syncPipelinePolling();
    return { pending: false, skipped: true };
  }
  if (pipeline.status === "failed" && (pipeline.kind === "docs" ? "docs" : "main") === "main") {
    return enqueueFailedPipelineLabel(pipeline);
  }
  await cancelPendingPipelineComments(pipeline);
  await cancelPendingFailedPipelineLabels(pipeline);
  await showLabelPipelineNotification({ ...pipeline, pipelineUrl: "" });
  await syncPipelinePolling();
  return { pending: false, skipped: false };
}

async function runPipelineMaintenance() {
  await pollInactivePipelineTabs();
  await processPendingFailedPipelineLabels();
  await processPendingPipelineComments();
  await syncPipelinePolling();
}

function openOptionsPage() {
  if (!openingOptionsPage) {
    // Chrome will focus the existing options page instead of creating another tab.
    openingOptionsPage = chrome.runtime.openOptionsPage()
      .finally(() => { openingOptionsPage = null; });
  }
  return openingOptionsPage;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "register-pipeline-monitor" && Number.isInteger(_sender.tab?.id)) {
    queuePipelineMonitorMutation(() => registerPipelineMonitor(_sender.tab.id, message))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error instanceof Error ? error.message : "监控注册失败" }));
    return true;
  }

  if (message?.type === "unregister-pipeline-monitor" && Number.isInteger(_sender.tab?.id)) {
    queuePipelineMonitorMutation(() => unregisterPipelineMonitor(_sender.tab.id))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error instanceof Error ? error.message : "监控注销失败" }));
    return true;
  }

  if (message?.type === "pipeline-poll-observed" && Number.isInteger(_sender.tab?.id)) {
    queuePipelineMonitorMutation(() => recordPipelineResponse(_sender.tab.id, message))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error instanceof Error ? error.message : "轮询心跳记录失败" }));
    return true;
  }

  if (message?.type === "notify-ci-pipeline") {
    queuePipelineMonitorMutation(() => handlePipelineNotification(message.pipeline))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : "系统通知发送失败"
      }));
    return true;
  }

  if (message?.type !== "open-options") return false;

  openOptionsPage()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({
      ok: false,
      message: error instanceof Error ? error.message : "配置页打开失败"
    }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PIPELINE_ALARM_NAME) {
    queuePipelineMonitorMutation(runPipelineMaintenance).catch(() => {});
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  queuePipelineMonitorMutation(() => handlePipelineNotificationAction(notificationId)).catch(() => {});
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  queuePipelineMonitorMutation(() => handlePipelineNotificationAction(notificationId, buttonIndex)).catch(() => {});
});

chrome.notifications.onClosed.addListener((notificationId) => {
  queuePipelineMonitorMutation(() => removePipelineNotificationContext(notificationId)).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  queuePipelineMonitorMutation(() => unregisterPipelineMonitor(tabId)).catch(() => {});
});

syncPipelinePolling().catch(() => {});
