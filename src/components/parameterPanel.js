/**
 * src/components/parameterPanel.js — Panel Parameter: tabel Name / Value, bisa diurutkan menurut nama.
 *
 * Dua versi:
 * - "Parameter VuGen": parameter `{nama}` — dari file `.dat`, `lr_save_string`, `web_reg_save_param*`
 *   (boundary / regexp / JSONPath), `lr_param_sprintf`, `web_convert_from_formatted`, `LR.setParam`.
 *   Nilainya adalah nilai PADA step terpilih (parameter yang diisi berulang, mis. transName, berubah per step).
 * - "Variabel C": variabel script C (`int i`, `double seq1`, `char* nama`, ...) yang terlihat di baris step terpilih.
 *
 * Asal-usul (sumber, tipe C, file:baris) ada di tooltip nama, bukan kolom tambahan.
 */

import { getState, subscribe } from "../store.js";
import { escapeHtml } from "../utils/html.js";
import { paramsAtEnd, paramsAtStep, sortByName } from "../utils/params.js";

/** @type {HTMLElement|null} */
let root = null;
/** @type {HTMLElement|null} */
let contentEl = null;
/** @type {Function|null} */
let unsubscribe = null;
/** @type {"vugen" | "c"} */
let mode = "vugen";
/** @type {"asc" | "desc"} */
let sortDirection = "asc";
let lastRenderKey = "";

/** Baris tabel mode VuGen: nilai pada step terpilih, atau keadaan terakhir run bila belum ada step terpilih */
function vugenRows(run, step) {
  const rows = step ? paramsAtStep(run.steps ?? [], step.seq) : paramsAtEnd(run);
  return rows.map((row) => ({
    name: row.name,
    value: row.value,
    hint: [row.source, row.file ? `${row.file}${row.line ? `:${row.line}` : ""}` : null].filter(Boolean).join(" · "),
  }));
}

/** Baris tabel mode C: variabel yang terlihat di baris step terpilih */
function cRows(step) {
  return (step?.vars ?? []).map((variable) => ({ name: variable.name, value: variable.value, hint: variable.type }));
}

/** Tabel Name / Value; header Name dapat diklik untuk mengurutkan */
function tableHtml(rows) {
  const sorted = sortByName(rows, sortDirection);
  const arrow = sortDirection === "asc" ? "▲" : "▼";
  return `
    <table class="param-table w-full table-fixed border-collapse text-[11px]">
      <thead class="sticky top-0 bg-gray-800 text-left text-gray-400">
        <tr>
          <th class="param-sort w-2/5 cursor-pointer select-none px-3 py-1.5 font-semibold hover:text-yellow-400" data-sort="name" title="Urutkan menurut nama">Name ${arrow}</th>
          <th class="px-3 py-1.5 font-semibold">Value</th>
        </tr>
      </thead>
      <tbody>
        ${sorted
          .map(
            (row) => `
        <tr class="param-row border-t border-gray-800 align-top hover:bg-gray-800">
          <td class="param-name break-all px-3 py-1 font-mono text-gray-300" title="${escapeHtml(row.hint)}">${escapeHtml(row.name)}</td>
          <td class="param-value break-all px-3 py-1 font-mono text-green-300">${escapeHtml(row.value)}</td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function emptyHtml(message) {
  return `<div class="p-4 text-center text-gray-500">${escapeHtml(message)}</div>`;
}

/** Render panel */
function render() {
  if (!contentEl) return;
  const state = getState();
  const run = state.currentRun;
  const step = state.selectedStep;

  const key = [mode, sortDirection, run?.runId ?? "", run?.steps?.length ?? 0, step?.seq ?? "", run?.params ? Object.keys(run.params).length : -1].join("#");
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  const vugen = run ? vugenRows(run, step) : [];
  const cVars = cRows(step);
  const rows = mode === "vugen" ? vugen : cVars;

  const scope = step ? `pada Snapshot #${step.seq} · ${step.file}:${step.line}` : run ? "keadaan terakhir run" : "";
  const tab = (id, label, count) =>
    `<button type="button" data-mode="${id}" class="param-mode rounded px-2.5 py-1 text-xs ${mode === id ? "bg-gray-700 text-yellow-400" : "text-gray-400 hover:text-gray-200"}">${escapeHtml(label)} <span class="text-gray-500">${escapeHtml(count)}</span></button>`;

  let body;
  if (!run) body = emptyHtml("Belum ada run");
  else if (mode === "c" && !step) body = emptyHtml("Pilih step (atau klik area API di editor) untuk melihat variabel C pada baris itu");
  else if (rows.length === 0) body = emptyHtml(mode === "vugen" ? "Belum ada parameter" : "Tidak ada variabel C pada baris ini");
  else body = tableHtml(rows);

  contentEl.innerHTML = `
    <div class="flex items-center gap-1 border-b border-gray-700 px-3 py-2">
      ${tab("vugen", "Parameter VuGen", vugen.length)}
      ${tab("c", "Variabel C", step ? cVars.length : "–")}
      <span class="param-scope ml-auto min-w-0 truncate text-[11px] text-gray-500" title="${escapeHtml(scope)}">${escapeHtml(scope)}</span>
    </div>
    <div class="param-body flex-1 overflow-auto">${body}</div>
  `;

  contentEl.querySelectorAll(".param-mode").forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.mode === "c" ? "c" : "vugen";
      lastRenderKey = "";
      render();
    });
  });
  contentEl.querySelector(".param-sort")?.addEventListener("click", () => {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
    lastRenderKey = "";
    render();
  });
}

export function createParameterPanel(container) {
  root = container;
  lastRenderKey = "";
  root.innerHTML = `<div id="content" class="flex h-full flex-col bg-gray-900"></div>`;
  contentEl = root.querySelector("#content");

  unsubscribe = subscribe(render);

  return {
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      root = null;
      contentEl = null;
    },
  };
}
