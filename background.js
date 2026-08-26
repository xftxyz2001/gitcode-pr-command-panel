"use strict";

let openingOptionsPage = null;
const pipelineNotifications = new Set();
const PIPELINE_MONITORS_KEY = "pipelineMonitors";
const PENDING_PIPELINE_COMMENTS_KEY = "pendingPipelineComments";
const PIPELINE_ALARM_NAME = "gitcode-pipeline-monitor";
const PIPELINE_WATCHDOG_INTERVAL_MS = 5000;
const PIPELINE_STALE_AFTER_MS = 15000;
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
  if (monitors.length || pendingComments.length) {
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
    await chrome.notifications.create(`gitcode-ci:${dedupeKey}`, {
      type: "basic",
      iconUrl: pipelineNotificationIcons[pipeline.status],
      title: `${pipelineName}${passed ? "通过" : "失败"} · ${pipeline.project} #${pipeline.iid}`,
      message: pipeline.title || "未获取到 PR 标题",
      contextMessage: pipeline.source === "comment"
        ? `GitCode PR ${pipelineName}（机器人评论兜底）`
        : `GitCode PR ${pipelineName}`,
      priority: passed ? 1 : 2
    });
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
    dueAt: Date.now() + PIPELINE_COMMENT_FALLBACK_DELAY_MS,
    pipeline: { ...pipeline, kind, runKey }
  });
  await writePendingPipelineComments(next);
  await syncPipelinePolling();
}

async function cancelPendingPipelineComments(pipeline) {
  const pending = await readPendingPipelineComments();
  const kind = pipeline.kind === "docs" ? "docs" : "main";
  const next = pending.filter((item) => !(
    item.pipeline?.project === pipeline.project
    && Number(item.pipeline?.iid) === Number(pipeline.iid)
    && (item.pipeline?.kind === "docs" ? "docs" : "main") === kind
  ));
  if (next.length !== pending.length) await writePendingPipelineComments(next);
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
    const projectPath = String(item.pipeline?.project || "").toLowerCase();
    const iid = Number(item.pipeline?.iid);
    const pageIsActive = monitors.some((monitor) => {
      if (!monitor.active) return false;
      try {
        const pathname = new URL(monitor.url).pathname.toLowerCase();
        return pathname.startsWith(`/${projectPath}/pull/${iid}`)
          || pathname.startsWith(`/${projectPath}/merge_requests/${iid}`);
      } catch {
        return false;
      }
    });
    if (pageIsActive) continue;
    try {
      await showPipelineNotification(item.pipeline);
    } catch {
      next.push({ ...item, dueAt: now + 30000 });
    }
  }
  await writePendingPipelineComments(next);
}

async function handlePipelineNotification(pipeline) {
  if (!pipeline || !["passed", "failed"].includes(pipeline.status)) {
    throw new Error("流水线通知数据无效");
  }
  if (pipeline.source === "comment") {
    await enqueuePipelineComment(pipeline);
    return { pending: true };
  }
  await cancelPendingPipelineComments(pipeline);
  if (pipeline.suppressNotification) {
    await syncPipelinePolling();
    return { pending: false, skipped: true };
  }
  await showPipelineNotification({ ...pipeline, source: "label" });
  await syncPipelinePolling();
  return { pending: false, skipped: false };
}

async function runPipelineMaintenance() {
  await pollInactivePipelineTabs();
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

chrome.tabs.onRemoved.addListener((tabId) => {
  queuePipelineMonitorMutation(() => unregisterPipelineMonitor(tabId)).catch(() => {});
});

syncPipelinePolling().catch(() => {});
