(() => {
  "use strict";

  const REQUEST_EVENT = "gitcode-pr-command:send";
  const RESULT_EVENT = "gitcode-pr-command:result";
  const CONFIG_EVENT = "gitcode-pr-command:config";
  const PIPELINE_EVENT = "gitcode-pr-command:pipeline";
  const PIPELINE_POLL_REQUEST_EVENT = "gitcode-pr-command:poll-pipeline";
  const PIPELINE_POLL_OBSERVED_EVENT = "gitcode-pr-command:pipeline-poll-observed";
  const DISCUSSIONS_PATH_RE = /\/issuepr\/api\/v1\/projects\/([^/]+)\/merge_requests\/(\d+)\/discussions(?:\?|$)/;
  let allowedCommands = new Set();
  const monitoredPrs = new Map();

  function readDiscussions(payload) {
    const content = payload?.content !== undefined ? payload : payload?.data || payload;
    const discussions = content?.content?.data;
    return Array.isArray(discussions) ? discussions : [];
  }

  function getDiscussionKey(discussion) {
    const stableId = discussion?.id ?? discussion?.data_id;
    if (stableId !== undefined && stableId !== null) return String(stableId);
    return JSON.stringify([
      discussion?.created_at || "",
      discussion?.action || "",
      discussion?.body || "",
      discussion?.author?.id || ""
    ]);
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function getPipelineLabel(label) {
    const mainMatch = label.match(/^ci-pipeline-(passed|failed)$/i);
    if (mainMatch) {
      return { kind: "main", status: mainMatch[1].toLowerCase() };
    }
    const docsMatch = label.match(/^docs-ci-pipeline-(success|failed)$/i);
    if (docsMatch) {
      return { kind: "docs", status: docsMatch[1].toLowerCase() === "success" ? "passed" : "failed" };
    }
    return null;
  }

  function findPipelineEvents(discussions, fallbackProject) {
    const events = [];
    for (const discussion of discussions) {
      if (discussion?.action !== "enterprise_label" || typeof discussion.body !== "string") continue;
      const addMatch = discussion.body.trim().match(/^add label\s+(.+)$/i);
      if (!addMatch) continue;
      const labels = addMatch[1].split(/[,，]/).map((label) => label.trim()).filter(Boolean);
      for (const label of labels) {
        const pipelineLabel = getPipelineLabel(label);
        if (!pipelineLabel) continue;
        events.push({
          key: getDiscussionKey(discussion),
          ...pipelineLabel,
          source: "label",
          project: discussion.project_full_path || discussion.project || fallbackProject || "未知仓库",
          occurredAt: Date.parse(discussion.created_at || "") || Date.now()
        });
      }
    }
    return events;
  }

  function normalizeMessageText(body) {
    return String(body || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readPipelineCommentStatus(body) {
    const text = normalizeMessageText(body);
    if (!/^流水线\s+/i.test(text)) return null;
    const runMatch = text.match(/^流水线\s+(.+?)\s+\[(?:\s*)commitID[：:]|^流水线\s+(\S+)/i);
    const runKey = (runMatch?.[1] || runMatch?.[2] || "unknown-run").trim();
    if (/^流水线[\s\S]{0,400}?运行失败/.test(text)) {
      return { status: "failed", runKey };
    }
    if (!/^流水线[\s\S]{0,400}?已完成/.test(text)) return null;
    const overallPassed = /<td[^>]*>\s*流水线\s*<\/td>\s*<td[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>\s*(?:&#9989;|✅|SUCCESS)\s*<\/td>/i.test(String(body));
    return overallPassed ? { status: "passed", runKey } : null;
  }

  function snapshotPipelineNotes(discussions, fallbackProject) {
    const fingerprints = new Map();
    const notes = [];
    for (const discussion of discussions) {
      const discussionKey = getDiscussionKey(discussion);
      const discussionNotes = Array.isArray(discussion?.notes) ? discussion.notes : [];
      for (let index = 0; index < discussionNotes.length; index += 1) {
        const note = discussionNotes[index];
        if (!note || typeof note.body !== "string") continue;
        const noteKey = String(note.id ?? `${discussionKey}:${index}`);
        const fingerprint = JSON.stringify([note.updated_at || "", hashText(note.body)]);
        fingerprints.set(noteKey, fingerprint);
        const author = String(note.author?.username || note.author?.login || note.author?.name || "");
        if (!/^ascend-robot$/i.test(author)) continue;
        const result = readPipelineCommentStatus(note.body);
        if (!result) continue;
        const occurredAt = Date.parse(note.updated_at || note.created_at || "") || Date.now();
        notes.push({
          key: `${noteKey}:${hashText(fingerprint)}`,
          noteKey,
          fingerprint,
          kind: "main",
          status: result.status,
          source: "comment",
          runKey: result.runKey,
          project: note.project || discussion.project_full_path || discussion.project || fallbackProject || "未知仓库",
          occurredAt
        });
      }
    }
    return { fingerprints, notes };
  }

  function inspectDiscussionsResponse(url, response) {
    let parsedUrl;
    try {
      parsedUrl = new URL(String(url), location.origin);
    } catch {
      return;
    }
    const match = `${parsedUrl.pathname}${parsedUrl.search}`.match(DISCUSSIONS_PATH_RE);
    if (!match || !response?.ok || typeof response.clone !== "function") return;

    document.dispatchEvent(new CustomEvent(PIPELINE_POLL_OBSERVED_EVENT));

    const encodedProject = match[1];
    const iid = Number(match[2]);
    response.clone().json().then((payload) => {
      let fallbackProject = "";
      try {
        fallbackProject = decodeURIComponent(encodedProject);
      } catch {
        fallbackProject = encodedProject;
      }
      const discussions = readDiscussions(payload);
      if (!discussions.length) return;
      let prKey = `${fallbackProject}#${iid}`;
      try {
        const currentPr = getPrContext();
        if (currentPr.iid === iid) prKey = `${currentPr.pathWithNamespace}#${iid}`;
      } catch {
        // Keep the request-derived key when the page is no longer on this PR.
      }
      const latestKey = getDiscussionKey(discussions[0]);
      const noteSnapshot = snapshotPipelineNotes(discussions, fallbackProject);
      const state = monitoredPrs.get(prKey);
      if (!state) {
        monitoredPrs.set(prKey, { latestKey, noteFingerprints: noteSnapshot.fingerprints });
        return;
      }

      const previousLatestIndex = discussions.findIndex(
        (discussion) => getDiscussionKey(discussion) === state.latestKey
      );
      state.latestKey = latestKey;
      if (previousLatestIndex < 0) {
        state.noteFingerprints = noteSnapshot.fingerprints;
        return;
      }

      const newDiscussions = discussions.slice(0, previousLatestIndex).reverse();
      const labelEvents = findPipelineEvents(newDiscussions, fallbackProject);
      const commentEvents = noteSnapshot.notes.filter(
        (note) => state.noteFingerprints?.get(note.noteKey) !== note.fingerprint
      );
      state.noteFingerprints = noteSnapshot.fingerprints;
      const events = [...labelEvents, ...commentEvents]
        .sort((left, right) => left.occurredAt - right.occurredAt);
      for (const event of events) {
        const { occurredAt: _occurredAt, noteKey: _noteKey, fingerprint: _fingerprint, ...publicEvent } = event;
        document.dispatchEvent(new CustomEvent(PIPELINE_EVENT, {
          detail: JSON.stringify({ ...publicEvent, iid })
        }));
      }
    }).catch(() => {});
  }

  const pageFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await pageFetch(...args);
    inspectDiscussionsResponse(args[0] instanceof Request ? args[0].url : args[0], response);
    return response;
  };

  function reply(result) {
    document.dispatchEvent(new CustomEvent(RESULT_EVENT, {
      detail: JSON.stringify(result)
    }));
  }

  function getPrContext() {
    const match = location.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:pull|merge_requests)\/(\d+)(?:\/|$)/);
    if (!match) throw new Error("当前页面不是 GitCode PR");
    return {
      pathWithNamespace: `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`,
      iid: Number(match[3])
    };
  }

  function readProjectIdFromNuxt(pathWithNamespace) {
    const source = document.querySelector("#__NUXT_DATA__")?.textContent;
    if (!source) return null;

    try {
      const values = JSON.parse(source);
      for (const item of values) {
        if (!item || Array.isArray(item) || typeof item !== "object") continue;
        const pathRef = item.path_with_namespace;
        const idRef = item.id;
        if (!Number.isInteger(pathRef) || !Number.isInteger(idRef)) continue;
        if (values[pathRef] === pathWithNamespace && Number.isInteger(values[idRef])) {
          return values[idRef];
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  function getRequestHeaders() {
    const token = localStorage.getItem("access_token");
    if (!token) throw new Error("未获取到 GitCode 登录态，请重新登录后刷新页面");
    return {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`
    };
  }

  async function parseResponse(response) {
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(payload?.error_message || payload?.message || `GitCode 请求失败（HTTP ${response.status}）`);
    }
    if (payload?.error_code && payload.error_code !== 0) {
      throw new Error(payload.error_message || payload.message || "GitCode 接口返回错误");
    }
    return payload;
  }

  async function resolveProjectId(pathWithNamespace, headers) {
    const embeddedId = readProjectIdFromNuxt(pathWithNamespace);
    if (embeddedId) return embeddedId;

    const response = await fetch(`/api/v1/projects/${encodeURIComponent(pathWithNamespace)}`, {
      method: "GET",
      headers,
      credentials: "include"
    });
    const payload = await parseResponse(response);
    const projectId = payload?.data?.data?.id ?? payload?.data?.id ?? payload?.id;
    if (!Number.isInteger(projectId)) throw new Error("GitCode 项目信息中没有 project_id");
    return projectId;
  }

  async function sendComment(command) {
    if (!allowedCommands.has(command)) throw new Error("该命令不在当前插件配置中");

    const { pathWithNamespace, iid } = getPrContext();
    const headers = getRequestHeaders();
    const projectId = await resolveProjectId(pathWithNamespace, headers);
    const response = await fetch(
      `/issuepr/api/v1/projects/${projectId}/merge_requests/${iid}/notes`,
      {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ body: command, need_to_resolve: false })
      }
    );
    return parseResponse(response);
  }

  async function pollPipelineDiscussions() {
    const { pathWithNamespace, iid } = getPrContext();
    const response = await fetch(
      `https://web-api.gitcode.com/issuepr/api/v1/projects/${encodeURIComponent(pathWithNamespace)}/merge_requests/${iid}/discussions?page=1&per_page=20&type=user&sort=desc`,
      {
        method: "GET",
        headers: getRequestHeaders(),
        credentials: "include"
      }
    );
    if (!response.ok) throw new Error(`GitCode discussions 请求失败（HTTP ${response.status}）`);
  }

  document.addEventListener(CONFIG_EVENT, (event) => {
    try {
      const values = JSON.parse(event.detail);
      if (!Array.isArray(values)) return;
      allowedCommands = new Set(
        values
          .filter((value) => typeof value === "string")
          .map((value) => value.trim())
          .filter((value) => value && value.length <= 65535)
      );
    } catch {
      allowedCommands = new Set();
    }
  });

  document.addEventListener(REQUEST_EVENT, async (event) => {
    let request;
    try {
      request = JSON.parse(event.detail);
      const payload = await sendComment(request.command);
      reply({
        requestId: request.requestId,
        ok: true,
        noteId: payload?.data?.data?.id ?? payload?.data?.id
      });
    } catch (error) {
      reply({
        requestId: request?.requestId || "",
        ok: false,
        message: error instanceof Error ? error.message : "GitCode 评论接口调用失败"
      });
    }
  });

  document.addEventListener(PIPELINE_POLL_REQUEST_EVENT, () => {
    const mockPoll = window.GITCODE_PR_NOTIFICATION_MOCK?.pollFromMonitor;
    if (typeof mockPoll === "function") {
      mockPoll.call(window.GITCODE_PR_NOTIFICATION_MOCK).catch(() => {});
    } else {
      pollPipelineDiscussions().catch(() => {});
    }
  });
})();
