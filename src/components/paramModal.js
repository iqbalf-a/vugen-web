/**
 * paramModal.js — Modal untuk manajemen parameter project.
 * List view: semua parameter. Edit view: form edit untuk satu parameter.
 */

import { SELECT_NEXT_ROW_OPTIONS, UPDATE_OPTIONS, OUT_OF_RANGE_OPTIONS, sameLineCandidates, buildChange } from "./paramBar.js";
import { escapeHtml } from "../utils/html.js";

const GEAR_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path fill-rule="evenodd" d="M8 0a1 1 0 0 1 .894.553l.998 1.996a6.02 6.02 0 0 1 1.223.709l2.14-.535a1 1 0 0 1 1.098.48l1 1.732a1 1 0 0 1-.17 1.196l-1.55 1.55a6.13 6.13 0 0 1 0 1.638l1.55 1.55a1 1 0 0 1 .17 1.196l-1 1.732a1 1 0 0 1-1.097.48l-2.141-.534a6.02 6.02 0 0 1-1.223.708l-.998 1.996A1 1 0 0 1 8 16a1 1 0 0 1-.894-.553l-.998-1.996a6.02 6.02 0 0 1-1.223-.709l-2.14.535a1 1 0 0 1-1.098-.48l-1-1.732a1 1 0 0 1 .17-1.196l1.55-1.55a6.13 6.13 0 0 1 0-1.638L.617 5.13a1 1 0 0 1-.17-1.196l1-1.732a1 1 0 0 1 1.097-.48l2.141.534a6.02 6.02 0 0 1 1.223-.708L6.894.553A1 1 0 0 1 8 0Z"/></svg>`;

/**
 * Hitung preview nilai waktu dari format dan offset detik, menggunakan logika yang sama dengan server.
 * @param {string} format
 * @param {number} offsetSec
 * @returns {string}
 */
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAYS_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function computePreview(format, offsetSec) {
  const d = new Date(Date.now() + offsetSec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  return (format || "%Y/%m/%d")
    .replace(/%Y/g, String(d.getFullYear()))
    .replace(/%y/g, String(d.getFullYear()).slice(-2))
    .replace(/%m/g, pad(d.getMonth() + 1))
    .replace(/%B/g, MONTHS_LONG[d.getMonth()])
    .replace(/%b/g, MONTHS_SHORT[d.getMonth()])
    .replace(/%d/g, pad(d.getDate()))
    .replace(/%e/g, String(d.getDate()))
    .replace(/%j/g, String(dayOfYear).padStart(3, "0"))
    .replace(/%A/g, DAYS_LONG[d.getDay()])
    .replace(/%a/g, DAYS_SHORT[d.getDay()])
    .replace(/%H/g, pad(d.getHours()))
    .replace(/%I/g, pad(d.getHours() % 12 || 12))
    .replace(/%M/g, pad(d.getMinutes()))
    .replace(/%S/g, pad(d.getSeconds()))
    .replace(/%p/g, d.getHours() < 12 ? "AM" : "PM");
}

/**
 * Buat badge tipe parameter.
 * @param {string | undefined} type
 * @returns {string}
 */
const TYPE_BADGE_MAP = {
  Time: ["Date", "#d2a24c"],
  Date: ["Date", "#d2a24c"],
  GroupName: ["Group", "#7c9e6b"],
  IterationNumber: ["Iter", "#7c9e6b"],
  Machine: ["LG", "#7c9e6b"],
  Userid: ["Vuser", "#7c9e6b"],
  RndNum: ["Random", "#9b7ec8"],
  UniqueNumber: ["Unique", "#9b7ec8"],
  Custom: ["Custom", "#5b8db8"],
};

function typeBadge(type) {
  if (!type) return "";
  const entry = TYPE_BADGE_MAP[type];
  if (entry) {
    const [label, color] = entry;
    return `<span class="rounded px-1.5 py-0.5 text-[10px] font-mono" style="color:${color};background:${color}1a">${label}</span>`;
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
 * @param {(() => void) | null} onShowAdd
 * @returns {DocumentFragment}
 */
function renderListView(parameters, onEdit, onShowAdd) {
  const frag = document.createDocumentFragment();

  if (onShowAdd) {
    const addRow = document.createElement("div");
    addRow.className = "px-4 py-2 border-b border-[#1e2630] flex justify-end";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] text-[#7d8896] hover:text-[#e6edf3] hover:bg-[#2a3644] transition-colors";
    addBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Add Parameter`;
    addBtn.addEventListener("click", onShowAdd);
    addRow.append(addBtn);
    frag.append(addRow);
  }

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
    } else if (param.type === "RndNum") {
      fileArea.textContent = `${param.min ?? 0} – ${param.max ?? 100}`;
    } else if (param.type === "UniqueNumber") {
      fileArea.textContent = `start=${param.startValue ?? 0}, block=${param.blockSize ?? 100}`;
    } else if (param.type === "Custom") {
      fileArea.textContent = param.defaultValue ?? "";
    } else if (["GroupName", "Machine", "Userid", "IterationNumber"].includes(param.type)) {
      fileArea.textContent = "—";
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
      offsetVal = storedSec / 31536000; offsetUnit = "Years";
    } else if (storedSec % 2592000 === 0) {
      offsetVal = storedSec / 2592000; offsetUnit = "Months";
    } else if (storedSec % 86400 === 0) {
      offsetVal = storedSec / 86400; offsetUnit = "Days";
    } else if (storedSec % 3600 === 0) {
      offsetVal = storedSec / 3600; offsetUnit = "Hours";
    } else if (storedSec % 60 === 0) {
      offsetVal = storedSec / 60; offsetUnit = "Minutes";
    } else {
      offsetVal = storedSec; offsetUnit = "Seconds";
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
        <option value="Seconds"${offsetUnit === "Seconds" ? " selected" : ""}>Seconds</option>
        <option value="Minutes"${offsetUnit === "Minutes" ? " selected" : ""}>Minutes</option>
        <option value="Hours"${offsetUnit === "Hours" ? " selected" : ""}>Hours</option>
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
      const multiplier = unit === "Years" ? 31536000 : unit === "Months" ? 2592000 : unit === "Hours" ? 3600 : unit === "Minutes" ? 60 : unit === "Seconds" ? 1 : 86400;
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
      const multiplier = unit === "Years" ? 31536000 : unit === "Months" ? 2592000 : unit === "Hours" ? 3600 : unit === "Minutes" ? 60 : unit === "Seconds" ? 1 : 86400;
      const sec = Math.round(val * multiplier);
      onSave({ format: fmt, offset: sec });
    });
    footer.append(saveBtn);
  });

  return frag;
}

/**
 * Buat opsi Select Next Row termasuk "Same line as" candidates.
 * @param {any} param @param {any[]} all
 */
function selectNextRowOptions(param, all) {
  const SAME = "same:";
  const follows = param.selectNextRow === "SameLine";
  const current = follows ? `${SAME}${param.sameLineAs}` : (param.selectNextRow ?? "Sequential");
  const candidates = sameLineCandidates(param, all);
  const sameOpts = candidates.map((c) => ({ value: `${SAME}${c.name}`, label: `Same line as ${c.name}` }));
  if (follows && !sameOpts.some((o) => o.value === current)) {
    sameOpts.push({ value: current, label: `Same line as ${param.sameLineAs}` });
  }
  const hint = sameOpts.length === 0
    ? `<option disabled>Same line as… (needs another parameter with ${param.rows} rows)</option>`
    : "";
  return [...SELECT_NEXT_ROW_OPTIONS, ...sameOpts]
    .map((o) => `<option value="${o.value}"${o.value === current ? " selected" : ""}>${o.label}</option>`)
    .join("") + hint;
}

/**
 * Render edit view untuk parameter Table.
 * @param {any} param
 * @param {any[]} allParams
 * @param {HTMLElement} footer
 * @param {(changes: Record<string, unknown>) => void} onSave
 * @returns {DocumentFragment}
 */
function renderTableEditView(param, allParams, footer, onSave) {
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
        <select id="pm-select-next-row" class="ui-field w-full">${selectNextRowOptions(param, allParams)}</select>
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
        ...buildChange("selectNextRow", selectNextRowEl?.value ?? "Sequential"),
        updateValueOn: updateValueOnEl?.value ?? "EachIteration",
        outOfRangePolicy: outOfRangeEl?.value ?? "Cycle",
      });
    });
    footer.append(saveBtn);
  });

  return frag;
}

/**
 * Render edit view untuk parameter info-only (GroupName, Userid, Machine, IterationNumber).
 */
function renderInfoEditView(param, footer) {
  const msgs = {
    GroupName: "Nilai: \"none\" — tidak ada Vuser Group saat run dari VuGen.",
    Userid: "Nilai: \"-1\" — ID Vuser saat replay dari VuGen.",
    Machine: "Nilai: nama hostname server yang menjalankan script.",
    IterationNumber: "Nilai: 1, 2, 3, … — auto-increment tiap iterasi.",
  };
  const frag = document.createDocumentFragment();
  const box = document.createElement("div");
  box.className = "px-4 py-6 text-[12px] text-[#7d8896]";
  box.textContent = msgs[param.type] ?? "No configurable settings for this parameter type.";
  frag.append(box);
  requestAnimationFrame(() => { footer.innerHTML = ""; });
  return frag;
}

/**
 * Render edit view untuk parameter RndNum (Random Number).
 */
function renderRndNumEditView(param, footer, onSave) {
  const frag = document.createDocumentFragment();
  const container = document.createElement("div");
  container.className = "px-4 py-4 flex flex-col gap-4";
  container.innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1.5">
        <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Min</span>
        <input id="pm-rnd-min" type="number" class="ui-field w-full font-mono" value="${param.min ?? 0}" step="1"/>
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Max</span>
        <input id="pm-rnd-max" type="number" class="ui-field w-full font-mono" value="${param.max ?? 100}" step="1"/>
      </label>
    </div>
    <label class="flex flex-col gap-1.5">
      <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Update Value On</span>
      <select id="pm-rnd-update" class="ui-field w-48">${optionsHtml(UPDATE_OPTIONS, param.updateValueOn ?? "EachIteration")}</select>
    </label>
    <div class="flex flex-col gap-1.5">
      <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Preview</span>
      <div id="pm-rnd-preview" class="rounded px-3 py-2 bg-[#141922] border border-[#232a33] font-mono text-[13px] text-[#9b7ec8]"></div>
    </div>
  `;
  frag.append(container);
  requestAnimationFrame(() => {
    const minEl = document.getElementById("pm-rnd-min");
    const maxEl = document.getElementById("pm-rnd-max");
    const updateEl = document.getElementById("pm-rnd-update");
    const preview = document.getElementById("pm-rnd-preview");
    function refreshPreview() {
      const lo = parseInt(minEl?.value || "0", 10);
      const hi = parseInt(maxEl?.value || "100", 10);
      if (preview) preview.textContent = `example: ${Math.floor(Math.random() * (hi - lo + 1)) + lo}`;
    }
    minEl?.addEventListener("input", refreshPreview);
    maxEl?.addEventListener("input", refreshPreview);
    refreshPreview();
    footer.innerHTML = "";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ui-btn ui-btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      onSave({ min: parseInt(minEl?.value || "0", 10), max: parseInt(maxEl?.value || "100", 10), updateValueOn: updateEl?.value ?? "EachIteration" });
    });
    footer.append(saveBtn);
  });
  return frag;
}

/**
 * Render edit view untuk parameter UniqueNumber.
 */
function renderUniqueNumEditView(param, footer, onSave) {
  const frag = document.createDocumentFragment();
  const container = document.createElement("div");
  container.className = "px-4 py-4 flex flex-col gap-4";
  container.innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1.5">
        <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Start Value</span>
        <input id="pm-uniq-start" type="number" class="ui-field w-full font-mono" value="${param.startValue ?? 0}" step="1"/>
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Block Size</span>
        <input id="pm-uniq-block" type="number" class="ui-field w-full font-mono" value="${param.blockSize ?? 100}" min="1" step="1"/>
      </label>
    </div>
    <div class="text-[11px] text-[#5b6572]">Setiap iterasi menggunakan angka berikutnya: Start, Start+1, Start+2, …</div>
  `;
  frag.append(container);
  requestAnimationFrame(() => {
    const startEl = document.getElementById("pm-uniq-start");
    const blockEl = document.getElementById("pm-uniq-block");
    footer.innerHTML = "";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ui-btn ui-btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      onSave({ startValue: parseInt(startEl?.value || "0", 10), blockSize: parseInt(blockEl?.value || "100", 10) });
    });
    footer.append(saveBtn);
  });
  return frag;
}

/**
 * Render edit view untuk parameter Custom (nilai tetap).
 */
function renderCustomEditView(param, footer, onSave) {
  const frag = document.createDocumentFragment();
  const container = document.createElement("div");
  container.className = "px-4 py-4 flex flex-col gap-4";
  container.innerHTML = `
    <label class="flex flex-col gap-1.5">
      <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Default Value</span>
      <input id="pm-custom-val" type="text" class="ui-field w-full font-mono" value="${escapeHtml(param.defaultValue ?? "")}"/>
      <div class="text-[10px] text-[#5b6572]">Nilai ini digunakan di semua iterasi dan semua Vuser.</div>
    </label>
  `;
  frag.append(container);
  requestAnimationFrame(() => {
    const valEl = document.getElementById("pm-custom-val");
    footer.innerHTML = "";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ui-btn ui-btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      onSave({ defaultValue: valEl?.value ?? "" });
    });
    footer.append(saveBtn);
  });
  return frag;
}

const ADD_PARAM_TYPES = [
  { value: "Table", label: "File (Table)" },
  { value: "Time", label: "Date/Time" },
  { value: "GroupName", label: "Group Name" },
  { value: "IterationNumber", label: "Iteration Number" },
  { value: "Machine", label: "Load Generator Name" },
  { value: "RndNum", label: "Random Number" },
  { value: "UniqueNumber", label: "Unique Number" },
  { value: "Userid", label: "Vuser ID" },
  { value: "Custom", label: "Custom (fixed value)" },
];

/**
 * Render form Add Parameter.
 * @param {HTMLElement} footer
 * @param {(paramDef: object) => Promise<any[]>} onAdd - returns updated parameters array
 * @param {() => void} onBack
 * @param {any[]} allParams - existing parameters untuk "Same line as" candidates
 */
function renderAddForm(footer, onAdd, onBack, allParams) {
  const frag = document.createDocumentFragment();
  const container = document.createElement("div");
  container.className = "px-4 py-4 flex flex-col gap-4";

  const typeOpts = ADD_PARAM_TYPES.map(
    (t) => `<option value="${t.value}">${t.label}</option>`
  ).join("");

  container.innerHTML = `
    <label class="flex flex-col gap-1.5">
      <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Parameter Name</span>
      <input id="pm-add-name" type="text" class="ui-field w-full font-mono" placeholder="paramName"/>
      <div class="text-[10px] text-[#5b6572]">Hanya huruf, angka, underscore. Digunakan sebagai &#123;paramName&#125; di script.</div>
    </label>
    <label class="flex flex-col gap-1.5">
      <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Type</span>
      <select id="pm-add-type" class="ui-field w-full">${typeOpts}</select>
    </label>
    <div id="pm-add-extra" class="flex flex-col gap-3"></div>
    <div id="pm-add-error" class="hidden text-[11px] text-[#e05252]"></div>
  `;
  frag.append(container);

  requestAnimationFrame(() => {
    const nameEl = document.getElementById("pm-add-name");
    const typeEl = document.getElementById("pm-add-type");
    const extraEl = document.getElementById("pm-add-extra");
    const errorEl = document.getElementById("pm-add-error");

    function previewBox(id, color) {
      return `<div class="flex flex-col gap-1">
        <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Preview</span>
        <div id="${id}" class="rounded px-3 py-1.5 bg-[#141922] border border-[#232a33] font-mono text-[12px]" style="color:${color}"></div>
      </div>`;
    }

    function renderExtra() {
      if (!extraEl) return;
      const t = typeEl?.value;
      extraEl.innerHTML = "";

      if (t === "Time") {
        extraEl.innerHTML = `
          <label class="flex flex-col gap-1.5">
            <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Format</span>
            <input id="pm-add-fmt" type="text" class="ui-field w-full font-mono" value="%Y/%m/%d" placeholder="%Y/%m/%d"/>
            <div class="text-[10px] text-[#5b6572]">Tokens: %Y (year 4-digit) %y (2-digit) %m (month) %d (day) %H (hour) %M (min) %S (sec)</div>
          </label>
          <div class="flex items-center gap-2">
            <label class="flex flex-col gap-1 flex-1">
              <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Offset</span>
              <input id="pm-add-offset-val" type="number" class="ui-field font-mono" value="0" step="1"/>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Unit</span>
              <select id="pm-add-offset-unit" class="ui-field">
                <option>Days</option><option>Months</option><option>Years</option><option>Hours</option><option>Minutes</option><option>Seconds</option>
              </select>
            </label>
          </div>
          <label class="flex flex-col gap-1.5">
            <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Update Value On</span>
            <select id="pm-add-update" class="ui-field w-48">${optionsHtml(UPDATE_OPTIONS, "EachIteration")}</select>
          </label>
          ${previewBox("pm-add-preview", "#d2a24c")}
        `;
        requestAnimationFrame(() => {
          const fmtEl = document.getElementById("pm-add-fmt");
          const offValEl = document.getElementById("pm-add-offset-val");
          const offUnitEl = document.getElementById("pm-add-offset-unit");
          const prev = document.getElementById("pm-add-preview");
          function upd() {
            const fmt = fmtEl?.value || "%Y/%m/%d";
            const v = parseFloat(offValEl?.value || "0") || 0;
            const u = offUnitEl?.value || "Days";
            const mul = u === "Years" ? 31536000 : u === "Months" ? 2592000 : u === "Hours" ? 3600 : u === "Minutes" ? 60 : u === "Seconds" ? 1 : 86400;
            const sec = Math.round(v * mul);
            if (prev) prev.textContent = computePreview(fmt, sec);
          }
          fmtEl?.addEventListener("input", upd);
          offValEl?.addEventListener("input", upd);
          offUnitEl?.addEventListener("change", upd);
          upd();
        });

      } else if (t === "RndNum") {
        extraEl.innerHTML = `
          <div class="grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-1.5">
              <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Min</span>
              <input id="pm-add-min" type="number" class="ui-field font-mono" value="0" step="1"/>
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Max</span>
              <input id="pm-add-max" type="number" class="ui-field font-mono" value="100" step="1"/>
            </label>
          </div>
          <label class="flex flex-col gap-1.5">
            <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Update Value On</span>
            <select id="pm-add-update" class="ui-field w-48">${optionsHtml(UPDATE_OPTIONS, "EachIteration")}</select>
          </label>
          ${previewBox("pm-add-preview", "#9b7ec8")}
        `;
        requestAnimationFrame(() => {
          const minEl = document.getElementById("pm-add-min");
          const maxEl = document.getElementById("pm-add-max");
          const prev = document.getElementById("pm-add-preview");
          function upd() {
            const lo = parseInt(minEl?.value || "0", 10);
            const hi = parseInt(maxEl?.value || "100", 10);
            const sample = Math.floor(Math.random() * (hi - lo + 1)) + lo;
            const digits = String(Math.max(Math.abs(lo), Math.abs(hi))).replace("-","").length;
            if (prev) prev.textContent = `sample: ${sample}  (max ${digits} digit${digits !== 1 ? "s" : ""})`;
          }
          minEl?.addEventListener("input", upd);
          maxEl?.addEventListener("input", upd);
          upd();
        });

      } else if (t === "UniqueNumber") {
        extraEl.innerHTML = `
          <div class="grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-1.5">
              <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Start Value</span>
              <input id="pm-add-start" type="number" class="ui-field font-mono" value="0" step="1"/>
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Block Size</span>
              <input id="pm-add-block" type="number" class="ui-field font-mono" value="100" min="1" step="1"/>
            </label>
          </div>
          ${previewBox("pm-add-preview", "#9b7ec8")}
        `;
        requestAnimationFrame(() => {
          const startEl = document.getElementById("pm-add-start");
          const prev = document.getElementById("pm-add-preview");
          function upd() {
            const s = parseInt(startEl?.value || "0", 10);
            if (prev) prev.textContent = `Iter 1 → ${s}  |  Iter 2 → ${s+1}  |  Iter 3 → ${s+2}  |  …`;
          }
          startEl?.addEventListener("input", upd);
          upd();
        });

      } else if (t === "Custom") {
        extraEl.innerHTML = `
          <label class="flex flex-col gap-1.5">
            <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Default Value</span>
            <input id="pm-add-defval" type="text" class="ui-field w-full font-mono" placeholder="nilai tetap"/>
            <div class="text-[10px] text-[#5b6572]">Nilai ini sama di semua iterasi dan semua Vuser.</div>
          </label>
          ${previewBox("pm-add-preview", "#5b8db8")}
        `;
        requestAnimationFrame(() => {
          const valEl = document.getElementById("pm-add-defval");
          const prev = document.getElementById("pm-add-preview");
          function upd() { if (prev) prev.textContent = valEl?.value || "(empty)"; }
          valEl?.addEventListener("input", upd);
          upd();
        });

      } else if (t === "GroupName") {
        extraEl.innerHTML = `${previewBox("pm-add-preview", "#7c9e6b")}`;
        requestAnimationFrame(() => {
          const prev = document.getElementById("pm-add-preview");
          if (prev) prev.textContent = `"none"  (tidak ada group saat run dari VuGen)`;
        });

      } else if (t === "Userid") {
        extraEl.innerHTML = `${previewBox("pm-add-preview", "#7c9e6b")}`;
        requestAnimationFrame(() => {
          const prev = document.getElementById("pm-add-preview");
          if (prev) prev.textContent = `"-1"  (ID Vuser saat replay dari VuGen)`;
        });

      } else if (t === "Machine") {
        extraEl.innerHTML = `${previewBox("pm-add-preview", "#7c9e6b")}`;
        requestAnimationFrame(() => {
          const prev = document.getElementById("pm-add-preview");
          if (prev) prev.textContent = `nama hostname server  (contoh: "MYSERVER-PC")`;
        });

      } else if (t === "IterationNumber") {
        extraEl.innerHTML = `${previewBox("pm-add-preview", "#7c9e6b")}`;
        requestAnimationFrame(() => {
          const prev = document.getElementById("pm-add-preview");
          if (prev) prev.textContent = `Iter 1 → "1"  |  Iter 2 → "2"  |  Iter 3 → "3"  |  …`;
        });

      } else if (t === "Table") {
        // "Same line as" candidates: hanya Table/File params yang tidak sedang mengikuti param lain
        const sameLineCands = (allParams || []).filter((p) => p.file && p.file.endsWith(".dat") && p.selectNextRow !== "SameLine");
        const sameLineOpts = sameLineCands.map((p) =>
          `<option value="same:${p.name}">Same line as ${p.name} (${p.rows} rows)</option>`
        ).join("");
        const snrOpts = SELECT_NEXT_ROW_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("") + sameLineOpts;

        extraEl.innerHTML = `
          <label class="flex flex-col gap-1.5">
            <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Values <span class="normal-case">(one per line)</span></span>
            <textarea id="pm-add-values" rows="10" class="ui-field w-full font-mono text-[12px] resize-y" placeholder="value1&#10;value2&#10;value3"></textarea>
            <div id="pm-add-table-note" class="text-[10px] text-[#5b6572]">Creates <span id="pm-add-dat-name" class="font-mono text-[#7d8896]">{name}.dat</span> with 0 rows.</div>
          </label>
          <div class="grid grid-cols-3 gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-[10px] text-[#7d8896] uppercase tracking-wide">Select Next Row</span>
              <select id="pm-add-snr" class="ui-field w-full">${snrOpts}</select>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[10px] text-[#7d8896] uppercase tracking-wide">Update Value On</span>
              <select id="pm-add-update" class="ui-field w-full">${optionsHtml(UPDATE_OPTIONS, "EachIteration")}</select>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[10px] text-[#7d8896] uppercase tracking-wide">When Out of Values</span>
              <select id="pm-add-oor" class="ui-field w-full">${optionsHtml(OUT_OF_RANGE_OPTIONS, "Cycle")}</select>
            </label>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-[11px] text-[#7d8896] uppercase tracking-wide">Preview</span>
            <div id="pm-add-preview" class="rounded px-3 py-1.5 bg-[#141922] border border-[#232a33] font-mono text-[12px] text-[#5b8db8] whitespace-pre-wrap min-h-[36px]"></div>
          </div>
        `;
        requestAnimationFrame(() => {
          const valuesEl = document.getElementById("pm-add-values");
          const snrEl = document.getElementById("pm-add-snr");
          const updateEl = document.getElementById("pm-add-update");
          const oorEl = document.getElementById("pm-add-oor");
          const noteEl = document.getElementById("pm-add-table-note");
          const datNameEl = document.getElementById("pm-add-dat-name");
          const prev = document.getElementById("pm-add-preview");
          function updTable() {
            const rows = (valuesEl?.value || "").split("\n").map((v) => v.trim()).filter(Boolean);
            const nm = nameEl?.value.trim() || "{name}";
            if (datNameEl) datNameEl.textContent = `${nm}.dat`;
            if (noteEl) noteEl.innerHTML = `Creates <span class="font-mono text-[#7d8896]">${nm}.dat</span> with ${rows.length} row${rows.length !== 1 ? "s" : ""}.`;
            if (prev) prev.textContent = rows.slice(0, 5).join("\n") + (rows.length > 5 ? `\n… (${rows.length - 5} more)` : "");
            // lock Update/OOR when "Same line as" is selected
            const isSame = snrEl?.value.startsWith("same:");
            if (updateEl) updateEl.disabled = isSame;
            if (oorEl) oorEl.disabled = isSame;
          }
          valuesEl?.addEventListener("input", updTable);
          nameEl?.addEventListener("input", updTable);
          snrEl?.addEventListener("change", updTable);
          updTable();
        });
      }
    }

    typeEl?.addEventListener("change", renderExtra);
    renderExtra();

    footer.innerHTML = "";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ui-btn ui-btn-primary";
    saveBtn.textContent = "Add";
    saveBtn.addEventListener("click", async () => {
      if (errorEl) errorEl.classList.add("hidden");
      const name = nameEl?.value.trim() ?? "";
      const type = typeEl?.value ?? "Custom";
      if (!name) { if (errorEl) { errorEl.textContent = "Parameter name is required."; errorEl.classList.remove("hidden"); } return; }

      const def = { name, type };

      if (type === "Time") {
        def.format = document.getElementById("pm-add-fmt")?.value || "%Y/%m/%d";
        const offVal = parseFloat(document.getElementById("pm-add-offset-val")?.value || "0") || 0;
        const offUnit = document.getElementById("pm-add-offset-unit")?.value || "Days";
        const mul = offUnit === "Years" ? 31536000 : offUnit === "Months" ? 2592000 : offUnit === "Hours" ? 3600 : offUnit === "Minutes" ? 60 : offUnit === "Seconds" ? 1 : 86400;
        def.offset = Math.round(offVal * mul);
        def.updateValueOn = document.getElementById("pm-add-update")?.value || "EachIteration";
      } else if (type === "RndNum") {
        def.min = parseInt(document.getElementById("pm-add-min")?.value || "0", 10);
        def.max = parseInt(document.getElementById("pm-add-max")?.value || "100", 10);
        def.updateValueOn = document.getElementById("pm-add-update")?.value || "EachIteration";
      } else if (type === "UniqueNumber") {
        def.startValue = parseInt(document.getElementById("pm-add-start")?.value || "0", 10);
        def.blockSize = parseInt(document.getElementById("pm-add-block")?.value || "100", 10);
      } else if (type === "Custom") {
        def.defaultValue = document.getElementById("pm-add-defval")?.value ?? "";
      } else if (type === "Table") {
        const raw = document.getElementById("pm-add-values")?.value || "";
        def.values = raw.split("\n").map((v) => v.trim()).filter(Boolean);
        const snrVal = document.getElementById("pm-add-snr")?.value || "Sequential";
        if (snrVal.startsWith("same:")) {
          def.selectNextRow = "SameLine";
          def.sameLineAs = snrVal.slice("same:".length);
        } else {
          def.selectNextRow = snrVal;
        }
        def.updateValueOn = document.getElementById("pm-add-update")?.value || "EachIteration";
        def.outOfRangePolicy = document.getElementById("pm-add-oor")?.value || "Cycle";
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Adding…";
      try {
        const updatedParams = await onAdd(def);
        if (updatedParams) {
          parameters.length = 0;
          parameters.push(...updatedParams);
        }
        onBack();
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err?.message || "Failed to add parameter.";
          errorEl.classList.remove("hidden");
        }
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Add";
      }
    });
    footer.append(saveBtn);
  });

  return frag;
}

/**
 * Buka modal manajemen parameter.
 * @param {any[]} parameters
 * @param {(name: string, changes: Record<string, unknown>) => void | Promise<void>} onSave
 * @param {(paramDef: object) => Promise<any[]>} [onAdd]
 * @returns {{ destroy: () => void }}
 */
export function openParamModal(parameters, onSave, onAdd) {
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
    content.replaceChildren(renderListView(parameters, showEdit, onAdd ? showAdd : null));
  }

  function makeBackHeader(labelText, labelType) {
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "flex items-center gap-1.5 text-[11px] text-[#7d8896] hover:text-[#e6edf3] transition-colors";
    backBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M6 1L1 5l5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg> Back`;
    backBtn.addEventListener("click", showList);
    const newTitle = document.createElement("span");
    newTitle.className = "flex items-center gap-2 text-[13px] font-medium text-[#e6edf3]";
    newTitle.append(backBtn);
    const paramLabel = document.createElement("span");
    paramLabel.className = "font-mono text-[#e6edf3]";
    paramLabel.textContent = labelText;
    const badgeEl = document.createElement("span");
    badgeEl.innerHTML = typeBadge(labelType);
    newTitle.append(paramLabel, badgeEl);
    return newTitle;
  }

  function showAdd() {
    header.replaceChildren(makeBackHeader("Add Parameter", null), closeBtn);
    footer.classList.remove("hidden");
    footer.className = "flex justify-end gap-2 px-4 py-3 border-t border-[#232a33]";
    content.replaceChildren(renderAddForm(footer, onAdd, showList, parameters));
  }

  function showEdit(param) {
    editingParam = param;
    const isDate = param.type === "Time" || param.type === "Date";

    header.replaceChildren(makeBackHeader(`{${param.name}}`, param.type), closeBtn);
    footer.classList.remove("hidden");
    footer.className = "flex justify-end gap-2 px-4 py-3 border-t border-[#232a33]";

    function handleSave(changes) {
      Promise.resolve(onSave(param.name, changes))
        .then(() => showList())
        .catch(() => {});
    }

    content.replaceChildren();
    if (isDate) {
      content.append(renderDateEditView(param, footer, handleSave));
    } else if (param.type === "RndNum") {
      content.append(renderRndNumEditView(param, footer, handleSave));
    } else if (param.type === "UniqueNumber") {
      content.append(renderUniqueNumEditView(param, footer, handleSave));
    } else if (param.type === "Custom") {
      content.append(renderCustomEditView(param, footer, handleSave));
    } else if (["GroupName", "Userid", "Machine", "IterationNumber"].includes(param.type)) {
      content.append(renderInfoEditView(param, footer));
    } else {
      content.append(renderTableEditView(param, parameters, footer, handleSave));
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
