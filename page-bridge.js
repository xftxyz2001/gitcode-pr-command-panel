(() => {
  "use strict";

  const REQUEST_EVENT = "gitcode-pr-command:send";
  const RESULT_EVENT = "gitcode-pr-command:result";
  const ALLOWED_COMMANDS = new Set([
    "compile",
    "get-log",
    "retry",
    "stop",
    "/check-cla",
    "/lgtm",
    "/approve",
    "/check-pr"
  ]);

  function reply(result) {
    document.dispatchEvent(new CustomEvent(RESULT_EVENT, {
      detail: JSON.stringify(result)
    }));
  }

  function getPrContext() {
    const match = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
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
    if (!ALLOWED_COMMANDS.has(command)) throw new Error("该命令不在插件允许列表中");

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
})();
