(() => {
  "use strict";

  const project = "Local/mock-repo";
  const iid = 9527;
  const discussionsUrl = `https://web-api.gitcode.com/issuepr/api/v1/projects/${encodeURIComponent(project)}/merge_requests/${iid}/discussions?page=1&per_page=20&type=user&sort=desc`;
  const originalFetch = window.fetch.bind(window);
  let sequence = 1;
  let pendingStatus = null;
  let discussions = [{
    id: "mock-baseline-1",
    project,
    body: "add label ci-pipeline-passed",
    action: "enterprise_label"
  }];

  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(discussionsUrl.split("?")[0])) {
      return new Response(JSON.stringify({ content: { data: discussions } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return originalFetch(input, init);
  };

  window.GITCODE_PR_NOTIFICATION_MOCK = {
    async establishBaseline() {
      await window.fetch(discussionsUrl);
    },
    async addPipelineEvent(status) {
      sequence += 1;
      discussions = [{
        id: `mock-${Date.now()}-${sequence}`,
        project,
        body: `add label ci-pipeline-${status}`,
        action: "enterprise_label"
      }, ...discussions];
      await window.fetch(discussionsUrl);
    },
    queuePipelineEvent(status) {
      pendingStatus = status;
    },
    async pollFromMonitor() {
      if (!pendingStatus) {
        await window.fetch(discussionsUrl);
        return;
      }
      const status = pendingStatus;
      pendingStatus = null;
      await this.addPipelineEvent(status);
    }
  };
})();
