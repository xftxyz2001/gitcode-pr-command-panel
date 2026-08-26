(() => {
  "use strict";

  window.GITCODE_PR_DEFAULT_COMMANDS = [
    { id: "compile", label: "编译", command: "compile", enabled: true },
    { id: "get-log", label: "查看日志", command: "get-log", enabled: true },
    { id: "lgtm", label: "LGTM", command: "/lgtm", enabled: true },
    { id: "approve", label: "批准合入", command: "/approve", enabled: true },
    { id: "check-cla", label: "检查 CLA", command: "/check-cla", enabled: false },
    { id: "retry", label: "重试流水线", command: "retry", enabled: false },
    { id: "stop", label: "停止流水线", command: "stop", enabled: false },
    { id: "check-pr", label: "检查合入", command: "/check-pr", enabled: false },
    { id: "rebuild", label: "重新构建", command: "rebuild", enabled: false },
    { id: "system-test", label: "前冒烟", command: "system-test", enabled: false },
    { id: "cla-cancel", label: "取消 CLA", command: "/cla cancel", enabled: false },
    { id: "lgtm-cancel", label: "取消 LGTM", command: "/lgtm cancel", enabled: false },
    { id: "approve-cancel", label: "取消批准", command: "/approve cancel", enabled: false },
    { id: "merge", label: "分支管理员批准", command: "/merge", enabled: false },
    { id: "kind", label: "添加 kind", command: "/kind bug", enabled: false },
    { id: "remove-kind", label: "移除 kind", command: "/remove-kind bug", enabled: false },
    { id: "priority", label: "添加优先级", command: "/priority high", enabled: false },
    { id: "remove-priority", label: "移除优先级", command: "/remove-priority high", enabled: false },
    { id: "sig", label: "添加 SIG", command: "/sig AI", enabled: false },
    { id: "remove-sig", label: "移除 SIG", command: "/remove-sig AI", enabled: false },
    { id: "label-add", label: "添加标签", command: "/label add bug", enabled: false },
    { id: "label-remove", label: "移除标签", command: "/label remove bug", enabled: false }
  ];
})();
