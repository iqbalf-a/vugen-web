/**
 * paramModal.js — Modal untuk manajemen parameter project.
 * List view: semua parameter. Edit view: form edit untuk satu parameter.
 */

import { SELECT_NEXT_ROW_OPTIONS, UPDATE_OPTIONS, OUT_OF_RANGE_OPTIONS } from "./paramBar.js";
import { escapeHtml } from "../utils/html.js";

const GEAR_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path fill-rule="evenodd" d="M8 0a1 1 0 0 1 .894.553l.998 1.996a6.02 6.02 0 0 1 1.223.709l2.14-.535a1 1 0 0 1 1.098.48l1 1.732a1 1 0 0 1-.17 1.196l-1.55 1.55a6.13 6.13 0 0 1 0 1.638l1.55 1.55a1 1 0 0 1 .17 1.196l-1 1.732a1 1 0 0 1-1.097.48l-2.141-.534a6.02 6.02 0 0 1-1.223.708l-.998 1.996A1 1 0 0 1 8 16a1 1 0 0 1-.894-.553l-.998-1.996a6.02 6.02 0 0 1-1.223-.709l-2.14.535a1 1 0 0 1-1.098-.48l-1-1.732a1 1 0 0 1 .17-1.196l1.55-1.55a6.13 6.13 0 0 1 0-1.638L.617 5.13a1 1 0 0 1-.17-1.196l1-1.732a1 1 0 0 1 1.097-.48l2.141.534a6.02 6.02 0 0 1 1.223-.708L6.894.553A1 1 0 0 1 8 0Z"/></svg>`;

/**
 * Hitung preview nilai waktu dari format dan offset detik, menggunakan logika yang sama dengan server.
 * @param {string} format
 * @param {number} offsetSec
 * @returns {string}
 */
function computePreview(format, offsetSec) {
  const d = new Date(Date.now() + offsetSec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return (format || "%Y/%m/%d")
    .replace(/%Y/g, d.getFullYear())
    .replace(/%m/g, pad(d.getMonth() + 1))
    .replace(/%d/g, pad(d.getDate()))
    .replace(/%H/g, pad(d.getHours()))
    .replace(/%M/g, pad(d.getMinutes()))
    .replace(/%S/g, pad(d.getSeconds()));
}

/**
 * Buat badge tipe parameter.
 * @param {string | undefined} type
 * @returns {string}
 */
function typeBadge(type) {
  if (!type) return "";
  if (type === "Time" || type === "Date") {
    return `<span class="rounded px-1.5 py-0.5 text-[10px] font-mono text-[#d2a24c] bg-[#d2a24c]/10">Date</span>`;
  }
  return `<span class="rounded px-1.5 py-0.5 text-[10px] font-mono text-[#5b8db8] bg-[#5b8db8]/10">Table</span>`;
}

/**
 * Buat opsi HTML untuk select.
 * @param {{ value: string, label: string }[]} options
 * @param {string | undefined} current
 * @returns {string}
 */
function optionsHtml(options, current) {
  return options
    .map(
      (opt) =>
        `<option value="${opt.value}"${opt.value === current ? " selected" : ""}>${opt.label}</option>`,
    )
    .join("");
}

/**
 * Render list view — daftar semua parameter.
 * @param {any[]} parameters
 * @param {(param: any) => void} onEdit
 * @returns {DocumentFragment}
 */
function renderListView(parameters, onEdit) {
  const frag = document.createDocumentFragment();

  if (parameters.length === 0) {
    const empty = document.createElement("div");
    empty.className = "px-4 py-8 text-center text-[13px] text-[#5b6572]";
    empty.textContent = "No parameters in this project.";
    frag.append(empty);
    return frag;
  }

  for (const param of parameters) {
    const row = document.createElement("div");
    row.className =
      "flex items-center gap-3 px-4 py-2.5 border-b border-[#1e2630] hover:bg-[#1e2630] transition-colors";

    const isDate = param.type === "Time" || param.type === "Date";

    // Name + type badge
    const nameArea = document.createElement("div");
    nameArea.className = "flex min-w-0 flex-1 items-center gap-2";
    nameArea.innerHTML = `
      <span class="font-mono text-[12px] text-[#e6edf3] truncate">{${param.name}}</span>
      ${typeBadge(param.type)}
    `;

    // File info
    const fileArea = document.createElement("div");
    fileArea.className = "min-w-0 flex-1 truncate text-[11px] text-[#5b6572] font-mono";
    if (isDate) {
      fileArea.textContent = param.timeFormat || "%Y/%m/%d";
    } else {
      fileArea.title = param.file || "";
      fileArea.textContent = param.file ? param.file.split("/").pop() ?? param.file : "—";
    }

    // Edit button
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "shrink-0 rounded px-2.5 py-1 text-[11px] text-[#7d8896] hover:text-[#e6edf3] hover:bg-[#2a3644] transition-colors";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => onEdit(param));

    row.append(nameArea, fileArea, editBtn);
    frag.append(row);
  }

  return frag;
}

/**
 * Render edit view untuk parameter Time/Date.
 * @param {any} param
 * @param {HTMLElement} footer
 * @param {(changes: Record<string, unknown>) => void} onSave
 * @returns {DocumentFragment}
 */
function renderDateEditView(param, footer, onSave) {
  const frag = document.createDocumentFragment();

  // Decode stored offset ke unit
  const storedSec = param.timeOffsetSec ?? 0;
  let offsetVal = 0;
  let offsetUnit = "Days";

  if (storedSec !== 0) {
    if (storedSec % 31536000 === 0) {
      offsetVal = storedSec / 31536000;
      offsetUnit = "Years";
    } else if (storedSec % 2592000 === 0) {
      offsetVal = storedSec / 2592000;
      offsetUnit = "Months";
    } else {
      offsetVal = storedSec / 86400;
      offsetUnit = "Days";
    }
  }

  const container = document.createElement("div");
  container.className = "px-4 py-4 flex flex-col gap-4";

  // Format field
  const formatGroup = document.createElement("div");
  formatGroup.className = "flex flex-col gap-1.5";
  formatGroup.innerHTML = `
    <label class="text-[11px] text-[#7d8896] uppercase tracking-wide">Format</label>
    <input
      id="pm-format"
      type="text"
      class="ui-field w-full font-mono"
      placeholder="%Y/%m/%d"
      value="${param.timeFormat || ""}"
    />
    <div class="text-[10px] text-[#5b6572]">Tokens: %Y (year), %m (month), %d (day), %H (hour), %M (minute), %S (second)</div>
  `;

  // Offset field
  const offsetGroup = document.createElement("div");
  offsetGroup.className = "flex flex-col gap-1.5";
  offsetGroup.innerHTML = `
    <label class="text-[11px] text-[#7d8896] uppercase tracking-wide">Offset</label>
    <div class="flex items-center gap-2">
      <input
        id="pm-offset-val"
        type="number"
        class="ui-field w-24 font-mono"
        value="${offsetVal}"
        step="1"
      />
      <select id="pm-offset-unit" class="ui-field">
        <option value="Days"${offsetUnit === "Days" ? " selected" : ""}>Days</option>
        <option value="Months"${offsetUnit === "Months" ? " selected" : ""}>Months</option>
        <option value="Years"${offsetUnit === "Years" ? " selected" : ""}>Years</option>
      </select>
      <span class="text-[11px] text-[#5b6572]">negative = prior, positive = next</span>
    </div>
  `;

  // Preview
  const previewGroup = document.createElement("div");
  previewGroup.className = "flex flex-col gap-1.5";
  previewGroup.innerHTML = `
    <label class="text-[11px] text-[#7d8896] uppercase tracking-wide">Preview</label>
    <div id="pm-preview" class="rounded px-3 py-2 bg-[#141922] border border-[#232a33] font-mono text-[13px] text-[#d2a24c]"></div>
  `;

  container.append(formatGroup, offsetGroup, previewGroup);
  frag.append(container);

  // Wire up live preview after DOM insertion
  requestAnimationFrame(() => {
    const formatInput = document.getElementById("pm-format");
    const offsetValInput = document.getElementById("pm-offset-val");
    const offsetUnitSelect = document.getElementById("pm-offset-unit");
    const previewEl = document.getElementById("pm-preview");

    function updatePreview() {
      const fmt = formatInput?.value || "%Y/%m/%d";
      const val = parseFloat(offsetValInput?.value || "0") || 0;
      const unit = offsetUnitSelect?.value || "Days";
      const multiplier = unit === "Years" ? 31536000 : unit === "Months" ? 2592000 : 86400;
      const sec = Math.round(val * multiplier);
      if (previewEl) previewEl.textContent = computePreview(fmt, sec);
    }

    formatInput?.addEventListener("input", updatePreview);
    offsetValInput?.addEventListener("input", updatePreview);
    offsetUnitSelect?.addEventListener("change", updatePreview);
    updatePreview();

    // Footer save button
    footer.innerHTML = "";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ui-btn ui-btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      const fmt = formatInput?.value || "%Y/%m/%d";
      const val = parseFloat(offsetValInput?.value || "0") || 0;
      const unit = offsetUnitSelect?.value || "Days";
      const multiplier = unit === "Years" ? 31536000 : unit === "Months" ? 2592000 : 86400;
      const sec = Math.round(val * multiplier);
      onSave({ format: fmt, offset: sec });
    });
    footer.append(saveBtn);
  });

  return frag;
}

/**
 * Render edit view untuk parameter Table.
 * @param {any} param
 * @param {HTMLElement} footer
 * @param {(changes: Record<string, unknown>) => void} onSave
 * @returns {DocumentFragment}
 */
function renderTableEditView(param, footer, onSave) {
  const frag = document.createDocumentFragment();

  // ── Settings (fixed, tidak scroll) ──
  const settings = document.createElement("div");
  settings.className = "shrink-0 px-4 pt-4 pb-3 flex flex-col gap-3 border-b border-[#232a33]";
  settings.innerHTML = `
    <div class="flex gap-4 text-[12px]">
      <span class="text-[#5b6572]">File: <span class="font-mono text-[#e6edf3]" title="${param.file || ""}">${param.file || "—"}</span></span>
      <span class="text-[#5b6572]">Rows: <span class="font-mono text-[#e6edf3]">${param.rows ?? "—"}</span></span>
    </div>
    <div class="grid grid-cols-3 gap-3">
      <label class="flex flex-col gap-1">
        <span class="text-[10px] text-[#7d8896] uppercase tracking-wide">Select Next Row</span>
        <select id="pm-select-next-row" class="ui-field w-full">${optionsHtml(SELECT_NEXT_ROW_OPTIONS, param.selectNextRow ?? "Sequential")}</select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[10px] text-[#7d8896] uppercase tracking-wide">Update Value On</span>
        <select id="pm-update-value-on" class="ui-field w-full">${optionsHtml(UPDATE_OPTIONS, param.updateValueOn ?? "EachIteration")}</select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[10px] text-[#7d8896] uppercase tracking-wide">When Out of Values</span>
        <select id="pm-out-of-range" class="ui-field w-full">${optionsHtml(OUT_OF_RANGE_OPTIONS, param.outOfRangePolicy ?? "Cycle")}</select>
      </label>
    </div>
  `;

  // ── Values list (scrollable) ──
  const values = Array.isArray(param.values) ? param.values : [];
  const valuesSection = document.createElement("div");
  valuesSection.className = "flex min-h-0 flex-col";

  const valuesHeader = document.createElement("div");
  valuesHeader.className = "shrink-0 px-4 py-1.5 text-[10px] uppercase tracking-wide text-[#5b6572] border-b border-[#1e2630]";
  valuesHeader.textContent = `Values${values.length < (param.rows ?? 0) ? ` (showing ${values.length} of ${param.rows})` : ` (${values.length})`}`;

  const valuesList = document.createElement("div");
  valuesList.className = "overflow-y-auto";
  valuesList.style.maxHeight = "220px";
  valuesList.innerHTML = values.length === 0
    ? `<div class="px-4 py-3 text-[12px] text-[#5b6572]">No values</div>`
    : values.map((v, i) =>
        `<div class="flex items-baseline gap-3 px-4 py-0.5 hover:bg-[#1e2630]">
          <span class="w-8 shrink-0 text-right font-mono text-[10px] text-[#3d4753]">${i + 1}</span>
          <span class="font-mono text-[12px] text-[#e6edf3] [overflow-wrap:anywhere]">${escapeHtml(String(v))}</span>
        </div>`
      ).join("");

  valuesSection.append(valuesHeader, valuesList);
  frag.append(settings, valuesSection);

  // Wire up footer save button
  requestAnimationFrame(() => {
    const selectNextRowEl = document.getElementById("pm-select-next-row");
    const updateValueOnEl = document.getElementById("pm-update-value-on");
    const outOfRangeEl = document.getElementById("pm-out-of-range");

    footer.innerHTML = "";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ui-btn ui-btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      onSave({
        selectNextRow: selectNextRowEl?.value ?? "Sequential",
        updateValueOn: updateValueOnEl?.value ?? "EachIteration",
        outOfRangePolicy: outOfRangeEl?.value ?? "Cycle",
      });
    });
    footer.append(saveBtn);
  });

  return frag;
}

/**
 * Buka modal manajemen parameter.
 * @param {any[]} parameters
 * @param {(name: string, changes: Record<string, unknown>) => void | Promise<void>} onSave
 * @returns {{ destroy: () => void }}
 */
export function openParamModal(parameters, onSave) {
  // Overlay
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60";

  // Dialog
  const dialog = document.createElement("div");
  dialog.className =
    "w-[560px] max-h-[80vh] flex flex-col rounded-lg bg-[#1b212b] border border-[#2a3644] shadow-xl";

  // Header
  const header = document.createElement("div");
  header.className = "panel-toolbar flex items-center justify-between";

  const titleEl = document.createElement("span");
  titleEl.className = "flex items-center gap-2 text-[13px] font-medium text-[#e6edf3]";
  titleEl.innerHTML = `${GEAR_SVG} <span id="pm-title">Parameters</span>`;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className =
    "flex items-center justify-center w-6 h-6 rounded text-[#5b6572] hover:text-[#e6edf3] hover:bg-[#232a33] transition-colors";
  closeBtn.title = "Close";
  closeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  closeBtn.addEventListener("click", destroy);

  header.append(titleEl, closeBtn);

  // Scrollable content area
  const content = document.createElement("div");
  content.className = "flex-1 overflow-y-auto";

  // Footer (only visible in edit view)
  const footer = document.createElement("div");
  footer.className = "hidden flex justify-end gap-2 px-4 py-3 border-t border-[#232a33]";

  dialog.append(header, content, footer);
  overlay.append(dialog);

  // State
  let editingParam = null;

  function showList() {
    editingParam = null;
    header.replaceChildren(titleEl, closeBtn);
    footer.classList.add("hidden");
    footer.innerHTML = "";
    content.replaceChildren(renderListView(parameters, showEdit));
  }

  function showEdit(param) {
    editingParam = param;
    const isDate = param.type === "Time" || param.type === "Date";

    // Back button in header area — replace title temporarily
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className =
      "flex items-center gap-1.5 text-[11px] text-[#7d8896] hover:text-[#e6edf3] transition-colors";
    backBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M6 1L1 5l5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg> Back`;
    backBtn.addEventListener("click", showList);

    // Rebuild header title area
    const newTitle = document.createElement("span");
    newTitle.className = "flex items-center gap-2 text-[13px] font-medium text-[#e6edf3]";
    newTitle.append(backBtn);
    const paramLabel = document.createElement("span");
    paramLabel.className = "font-mono text-[#e6edf3]";
    paramLabel.textContent = `{${param.name}}`;
    const typeBadgeEl = document.createElement("span");
    typeBadgeEl.innerHTML = typeBadge(param.type);
    newTitle.append(paramLabel, typeBadgeEl);

    header.replaceChildren(newTitle, closeBtn);

    footer.classList.remove("hidden");
    footer.className = "flex justify-end gap-2 px-4 py-3 border-t border-[#232a33]";

    function handleSave(changes) {
      Promise.resolve(onSave(param.name, changes))
        .then(() => {
          // Refresh parameters list from updated param if possible
          showList();
        })
        .catch(() => {
          // keep edit view open on error
        });
    }

    content.replaceChildren();
    if (isDate) {
      content.append(renderDateEditView(param, footer, handleSave));
    } else {
      content.append(renderTableEditView(param, footer, handleSave));
    }
  }

  // Escape closes
  function onKeyDown(e) {
    if (e.key === "Escape") destroy();
  }

  // Backdrop click closes
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) destroy();
  });

  document.addEventListener("keydown", onKeyDown);
  document.body.append(overlay);

  showList();

  function destroy() {
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  }

  return { destroy };
}
