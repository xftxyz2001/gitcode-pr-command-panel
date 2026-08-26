(() => {
  "use strict";

  const list = document.querySelector("#command-list");
  const template = document.querySelector("#command-row-template");
  const saveButton = document.querySelector("#save-button");
  const resetButton = document.querySelector("#reset-button");
  const addButton = document.querySelector("#add-button");
  const status = document.querySelector("#save-status");
  const storageArea = typeof chrome !== "undefined" && chrome.storage?.local
    ? chrome.storage.local
    : { get: async () => ({}), set: async () => {} };
  let draggedRow = null;

  function cloneDefaults() {
    return window.GITCODE_PR_DEFAULT_COMMANDS.map((item) => ({ ...item }));
  }

  function normalizeCommands(value) {
    if (!Array.isArray(value)) return cloneDefaults();
    const normalized = value
      .filter((item) => item && typeof item === "object")
      .map((item, index) => ({
        id: String(item.id || `custom-${index}-${Date.now()}`),
        label: String(item.label || "").trim().slice(0, 30),
        command: String(item.command || "").trim().slice(0, 65535),
        enabled: Boolean(item.enabled)
      }));
    return normalized;
  }

  function markDirty() {
    status.textContent = "有未保存的修改";
    status.dataset.kind = "info";
  }

  function refreshOrderButtons() {
    const rows = [...list.querySelectorAll(".command-row")];
    rows.forEach((row, index) => {
      row.querySelector(".move-up").disabled = index === 0;
      row.querySelector(".move-down").disabled = index === rows.length - 1;
    });
  }

  function createRow(item) {
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.id = item.id;
    row.draggable = false;
    row.querySelector(".enabled-input").checked = item.enabled;
    row.querySelector(".label-input").value = item.label;
    row.querySelector(".command-input").value = item.command;

    row.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", markDirty);
      input.addEventListener("change", markDirty);
    });
    row.querySelector(".move-up").addEventListener("click", () => {
      const previous = row.previousElementSibling;
      if (previous) list.insertBefore(row, previous);
      refreshOrderButtons();
      markDirty();
    });
    row.querySelector(".move-down").addEventListener("click", () => {
      const next = row.nextElementSibling;
      if (next) list.insertBefore(next, row);
      refreshOrderButtons();
      markDirty();
    });
    row.querySelector(".delete-button").addEventListener("click", () => {
      row.remove();
      refreshOrderButtons();
      markDirty();
    });

    const handle = row.querySelector(".drag-handle");
    handle.addEventListener("pointerdown", () => { row.draggable = true; });
    handle.addEventListener("pointerup", () => { row.draggable = false; });
    handle.addEventListener("pointercancel", () => { row.draggable = false; });
    row.addEventListener("dragstart", (event) => {
      if (!row.draggable) {
        event.preventDefault();
        return;
      }
      draggedRow = row;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      draggedRow = null;
      row.draggable = false;
      row.classList.remove("dragging");
      list.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
      refreshOrderButtons();
      markDirty();
    });
    row.addEventListener("dragover", (event) => {
      if (!draggedRow || draggedRow === row) return;
      event.preventDefault();
      row.classList.add("drag-over");
      event.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (event) => {
      if (!draggedRow || draggedRow === row) return;
      event.preventDefault();
      row.classList.remove("drag-over");
      const before = event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;
      list.insertBefore(draggedRow, before ? row : row.nextElementSibling);
    });
    return row;
  }

  function render(commands) {
    list.replaceChildren(...commands.map(createRow));
    refreshOrderButtons();
  }

  function collectCommands() {
    let valid = true;
    const commands = [...list.querySelectorAll(".command-row")].map((row) => {
      const labelInput = row.querySelector(".label-input");
      const commandInput = row.querySelector(".command-input");
      const label = labelInput.value.trim();
      const command = commandInput.value.trim();
      labelInput.classList.toggle("invalid", !label);
      commandInput.classList.toggle("invalid", !command);
      if (!label || !command) valid = false;
      return {
        id: row.dataset.id,
        label,
        command,
        enabled: row.querySelector(".enabled-input").checked
      };
    });
    if (!valid) throw new Error("请填写所有按钮名称和发送内容，或删除空白项");
    return commands;
  }

  async function save() {
    try {
      const commands = collectCommands();
      await storageArea.set({ commands });
      status.textContent = `已保存，共显示 ${commands.filter((item) => item.enabled).length} 个按钮`;
      status.dataset.kind = "success";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "保存失败";
      status.dataset.kind = "error";
    }
  }

  saveButton.addEventListener("click", save);
  addButton.addEventListener("click", () => {
    const item = {
      id: `custom-${crypto.randomUUID()}`,
      label: "自定义命令",
      command: "/command",
      enabled: true
    };
    const row = createRow(item);
    list.appendChild(row);
    refreshOrderButtons();
    markDirty();
    row.querySelector(".label-input").select();
    row.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  resetButton.addEventListener("click", () => {
    if (!confirm("恢复默认命令会覆盖当前未保存的配置，是否继续？")) return;
    render(cloneDefaults());
    markDirty();
  });

  storageArea.get("commands").then(({ commands }) => {
    render(normalizeCommands(commands));
    status.textContent = "修改后请保存";
  });
})();
