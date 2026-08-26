(() => {
  "use strict";

  const list = document.querySelector("#command-list");
  const template = document.querySelector("#command-row-template");
  const saveButton = document.querySelector("#save-button");
  const resetButton = document.querySelector("#reset-button");
  const addButton = document.querySelector("#add-button");
  const status = document.querySelector("#save-status");
  const confirmDialog = document.querySelector("#confirm-dialog");
  const confirmTitle = document.querySelector("#confirm-title");
  const confirmMessage = document.querySelector("#confirm-message");
  const confirmActionButton = document.querySelector("#confirm-action-button");
  const storageArea = typeof chrome !== "undefined" && chrome.storage?.local
    ? chrome.storage.local
    : { get: async () => ({}), set: async () => {} };
  let draggedRow = null;
  let savedSnapshot = "";
  let hasUnsavedChanges = false;
  let saving = false;
  let saveFeedbackTimer = null;

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

  function snapshot(commands) {
    return JSON.stringify(commands);
  }

  function updateDirtyState() {
    hasUnsavedChanges = snapshot(readCommands()) !== savedSnapshot;
    status.textContent = hasUnsavedChanges ? "有未保存的修改" : "当前配置已保存";
    status.dataset.kind = hasUnsavedChanges ? "info" : "success";
    if (!saving) resetSaveButtonFeedback();
  }

  function resetSaveButtonFeedback() {
    clearTimeout(saveFeedbackTimer);
    saveFeedbackTimer = null;
    saveButton.textContent = "保存配置";
    delete saveButton.dataset.state;
  }

  function showTemporarySaveFeedback(label, state) {
    clearTimeout(saveFeedbackTimer);
    saveButton.textContent = label;
    saveButton.dataset.state = state;
    saveFeedbackTimer = setTimeout(resetSaveButtonFeedback, 2000);
  }

  function requestConfirmation({ title, message, confirmLabel }) {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmActionButton.textContent = confirmLabel;
    confirmDialog.returnValue = "cancel";
    confirmDialog.showModal();
    requestAnimationFrame(() => confirmActionButton.focus());

    return new Promise((resolve) => {
      confirmDialog.addEventListener("close", () => {
        resolve(confirmDialog.returnValue === "confirm");
      }, { once: true });
    });
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
      input.addEventListener("input", updateDirtyState);
      input.addEventListener("change", updateDirtyState);
    });
    row.querySelector(".move-up").addEventListener("click", () => {
      const previous = row.previousElementSibling;
      if (previous) list.insertBefore(row, previous);
      refreshOrderButtons();
      updateDirtyState();
    });
    row.querySelector(".move-down").addEventListener("click", () => {
      const next = row.nextElementSibling;
      if (next) list.insertBefore(next, row);
      refreshOrderButtons();
      updateDirtyState();
    });
    row.querySelector(".delete-button").addEventListener("click", async () => {
      const label = row.querySelector(".label-input").value.trim() || "未命名命令";
      const confirmed = await requestConfirmation({
        title: `删除“${label}”？`,
        message: "该命令会从当前列表中移除，保存配置后才会生效。",
        confirmLabel: "删除"
      });
      if (!confirmed) return;
      row.remove();
      refreshOrderButtons();
      updateDirtyState();
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
      updateDirtyState();
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

  function readCommands(validate = false) {
    let valid = true;
    const commands = [...list.querySelectorAll(".command-row")].map((row) => {
      const labelInput = row.querySelector(".label-input");
      const commandInput = row.querySelector(".command-input");
      const label = labelInput.value.trim();
      const command = commandInput.value.trim();
      if (validate) {
        labelInput.classList.toggle("invalid", !label);
        commandInput.classList.toggle("invalid", !command);
      }
      if (!label || !command) valid = false;
      return {
        id: row.dataset.id,
        label,
        command,
        enabled: row.querySelector(".enabled-input").checked
      };
    });
    if (validate && !valid) throw new Error("请填写所有按钮名称和发送内容，或删除空白项");
    return commands;
  }

  async function save() {
    if (saving) return;
    saving = true;
    clearTimeout(saveFeedbackTimer);
    saveButton.disabled = true;
    saveButton.textContent = "保存中…";
    saveButton.dataset.state = "saving";
    try {
      const commands = readCommands(true);
      await storageArea.set({ commands });
      savedSnapshot = snapshot(commands);
      hasUnsavedChanges = snapshot(readCommands()) !== savedSnapshot;
      status.textContent = hasUnsavedChanges
        ? "已保存点击时的配置，但仍有新的未保存修改"
        : `已保存，共显示 ${commands.filter((item) => item.enabled).length} 个按钮`;
      status.dataset.kind = hasUnsavedChanges ? "info" : "success";
      showTemporarySaveFeedback("✓ 已保存", "success");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "保存失败";
      status.dataset.kind = "error";
      showTemporarySaveFeedback("保存失败", "error");
    } finally {
      saving = false;
      saveButton.disabled = false;
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
    updateDirtyState();
    row.querySelector(".label-input").select();
    row.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  resetButton.addEventListener("click", async () => {
    const confirmed = await requestConfirmation({
      title: "恢复默认配置？",
      message: "当前未保存的修改会被默认命令替换，恢复后仍需点击保存。",
      confirmLabel: "恢复默认"
    });
    if (!confirmed) return;
    render(cloneDefaults());
    updateDirtyState();
  });

  confirmDialog.addEventListener("click", (event) => {
    if (event.target === confirmDialog) confirmDialog.close("cancel");
  });

  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  });

  storageArea.get("commands").then(({ commands }) => {
    render(normalizeCommands(commands));
    savedSnapshot = snapshot(readCommands());
    hasUnsavedChanges = false;
    status.textContent = "当前配置已保存";
    status.dataset.kind = "success";
  });
})();
