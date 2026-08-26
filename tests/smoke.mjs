import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const defaultsCode = fs.readFileSync(new URL("../defaults.js", import.meta.url), "utf8");
const bridgeCode = fs.readFileSync(new URL("../page-bridge.js", import.meta.url), "utf8");

const defaultsContext = { window: {} };
vm.runInNewContext(defaultsCode, defaultsContext);
const defaults = defaultsContext.window.GITCODE_PR_DEFAULT_COMMANDS;
assert.equal(defaults.length, 22);
assert.deepEqual(
  JSON.parse(JSON.stringify(defaults.filter((item) => item.enabled).map((item) => item.command))),
  ["compile", "get-log", "/lgtm", "/approve"]
);

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
const context = {
  document,
  CustomEvent: TestCustomEvent,
  location: { pathname: "/Ascend/pytorch/pull/123" },
  localStorage: { getItem: (key) => key === "access_token" ? "test-token" : null },
  fetch: async (url, options) => {
    requests.push({ url, options });
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
  Error
};
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
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "/issuepr/api/v1/projects/7404318/merge_requests/123/notes");
assert.equal(requests[0].options.method, "POST");
assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");
assert.deepEqual(JSON.parse(requests[0].options.body), { body: "compile", need_to_resolve: false });

const rejected = new Promise((resolve) => {
  document.addEventListener("gitcode-pr-command:result", (event) => resolve(JSON.parse(event.detail)), { once: true });
});
document.dispatchEvent(new TestCustomEvent("gitcode-pr-command:send", {
  detail: JSON.stringify({ requestId: "request-2", command: "/approve" })
}));
const rejectedResult = await rejected;
assert.equal(rejectedResult.ok, false);
assert.match(rejectedResult.message, /当前插件配置/);
assert.equal(requests.length, 1);

console.log("Smoke tests passed");
