/**
 * src/components/stepList.js — Daftar step hasil run + selector iterasi.
 *
 * Fitur:
 * - Tampil step live saat run berjalan (via SSE)
 * - Selector grup: vuser_init, Iterasi 1..N, vuser_end (step init/end tidak bercampur
 *   dengan Action iterasi 1, lihat utils/steps.js)
 * - Transaksi dikelompokkan per grup, masing-masing bisa expand/collapse; status Fail terlihat
 * - Klik step → store.selectedStep + callback `onSelect` (main.js membuka file & lompat ke baris)
 *
 * State pilihan (grup/iterasi terpilih, step terpilih) hanya ada di store.
 */

import { getStore, subscribe } from "../store.js";
import { escapeHtml } from "../utils/html.js";
import { availableGroups, groupLabel, stepGroupOf } from "../utils/steps.js";

/** @type {HTMLElement|null} */
let root = null;
/** @type {HTMLSelectElement|null} */
let groupSelect = null;
/** @type {HTMLElement|null} */
let stepListEl = null;
/** @type {Set<string>} nama transaksi yang dibuka (state tampilan lokal) */
const expandedTransactions = new Set();
/** @type {Function|null} */
let unsubscribe = null;
/** @type {((step: Object) => void)|null} */
let onSelectStep = null;
/** Kunci render terakhir; render ulang hanya bila datanya berubah */
let lastRenderKey = "";

/** Step dianggap OK bila tanpa error dan response < 400 */
function isOk(step) {
  return !step.error && step.response?.status > 0 && step.response.status < 400;
}

/** Ikon + warna untuk satu step (Fail = merah) */
function stepStyle(step) {
  if (step.error) return { icon: "✗", color: "text-red-400" };
  const status = step.response?.status;
  if (status >= 200 && status < 300) return { icon: "✓", color: "text-green-400" };
  if (status >= 300 && status < 400) return { icon: "→", color: "text-gray-400" };
  return { icon: "⚠", color: "text-yellow-400" };
}

/** Grup-grup yang punya masalah (step error / transaksi Fail), untuk tanda ✗ di selector */
function failedGroups(run, runLogic) {
  const failed = new Set();
  for (const step of run.steps ?? []) if (step.error) failed.add(stepGroupOf(step, runLogic));
  for (const tx of run.transactions ?? []) if (tx.status === "Fail") failed.add(tx.iteration);
  return failed;
}

/** Perbarui opsi selector grup tanpa mengubah pilihan di store */
function updateGroupSelector(state) {
  if (!groupSelect) return;
  const run = state.currentRun;
  const runLogic = state.project?.runLogic;
  const steps = run?.steps ?? [];
  const groups = availableGroups(steps, run?.options?.iterations ?? 1, runLogic);
  const failed = run ? failedGroups(run, runLogic) : new Set();

  groupSelect.replaceChildren(
    ...groups.map((group) => {
      const option = document.createElement("option");
      option.value = String(group);
      option.textContent = `${groupLabel(group)}${failed.has(group) ? " ✗" : ""}`;
      return option;
    }),
  );
  groupSelect.value = String(state.selectedIteration);
}

/** Render daftar step yang dikelompokkan per transaksi */
function renderSteps(state) {
  if (!stepListEl) return;
  const run = state.currentRun;
  if (!run || !run.steps) {
    stepListEl.innerHTML = '<div class="text-muted text-sm p-4">Belum ada step</div>';
    return;
  }

  const runLogic = state.project?.runLogic;
  const group = state.selectedIteration;
  const steps = run.steps.filter((step) => stepGroupOf(step, runLogic) === group);

  if (steps.length === 0) {
    stepListEl.innerHTML = `<div class="text-muted text-sm p-4">Tidak ada step untuk ${escapeHtml(groupLabel(group))}</div>`;
    return;
  }

  // Group steps by transaction
  const txMap = new Map();
  for (const step of steps) {
    const tx = step.transaction || "Tanpa Transaksi";
    if (!txMap.has(tx)) txMap.set(tx, []);
    txMap.get(tx).push(step);
  }

  const selectedSeq = state.selectedStep?.seq;

  stepListEl.innerHTML = Array.from(txMap.entries()).map(([txName, txSteps]) => {
    const isExpanded = expandedTransactions.has(txName);
    const duration = Math.round(txSteps.reduce((sum, s) => sum + (s.timing?.durationMs || 0), 0) * 100) / 100;
    const okCount = txSteps.filter(isOk).length;
    const txResult = (run.transactions ?? []).find((tx) => tx.name === txName && tx.iteration === txSteps[0].iteration);
    const txFailed = txResult?.status === "Fail";

    return `
      <div class="tx-section border-b border-gray-700">
        <div class="tx-header px-3 py-2 bg-gray-800 hover:bg-gray-750 cursor-pointer flex items-center gap-2"
             data-tx="${escapeHtml(txName)}"
             style="user-select: none;">
          <span class="tx-toggle font-mono text-xs text-gray-400 w-5" aria-expanded="${isExpanded}">
            ${isExpanded ? "▼" : "▶"}
          </span>
          <span class="font-medium ${txFailed ? "text-red-400" : "text-gray-200"} truncate flex-1">${escapeHtml(txName)}</span>
          ${txFailed ? '<span class="tx-status font-mono text-xs text-red-400">✗ Fail</span>' : txResult ? '<span class="tx-status font-mono text-xs text-green-400">Pass</span>' : ""}
          <span class="font-mono text-xs text-gray-500">${txSteps.length} API</span>
          <span class="font-mono text-xs ${okCount === txSteps.length ? "text-green-400" : "text-red-400"}">${okCount}/${txSteps.length} OK</span>
          <span class="font-mono text-xs text-gray-500">${escapeHtml(duration)}ms</span>
        </div>
        <div class="tx-body ${isExpanded ? "" : "hidden"}" data-tx-body="${escapeHtml(txName)}">
          ${txSteps.map((step) => {
            const { icon, color } = stepStyle(step);
            const selected = step.seq === selectedSeq ? "bg-gray-700" : "";
            return `
              <div class="step-item px-3 py-2 border-b border-gray-700 hover:bg-gray-800 cursor-pointer ${selected} ${color} pl-6"
                   data-seq="${escapeHtml(step.seq)}"
                   title="${escapeHtml(step.file)}:${escapeHtml(step.line)}">
                <div class="flex items-center gap-2">
                  <span class="font-mono text-xs">${icon}</span>
                  <span class="font-mono text-xs text-gray-400">#${escapeHtml(step.seq)}</span>
                  <span class="flex-1 truncate">${escapeHtml(step.name)}</span>
                  <span class="font-mono text-xs">${escapeHtml(step.type)}</span>
                  <span class="font-mono text-xs text-gray-500">${escapeHtml(step.response?.status || "-")}</span>
                  <span class="font-mono text-xs text-gray-500">${escapeHtml(step.timing?.durationMs || 0)}ms</span>
                </div>
                <div class="text-xs text-gray-500 mt-1 truncate">${escapeHtml(step.file)}:${escapeHtml(step.line)}</div>
                ${step.error ? `<div class="step-error text-xs text-red-400 mt-1 break-all">${escapeHtml(step.error)}</div>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }).join("");

  // Toggle transaksi
  stepListEl.querySelectorAll(".tx-header").forEach((el) => {
    el.addEventListener("click", () => {
      const txName = el.dataset.tx;
      if (expandedTransactions.has(txName)) expandedTransactions.delete(txName);
      else expandedTransactions.add(txName);
      lastRenderKey = ""; // paksa render ulang
      render();
    });
  });

  // Pilih step
  stepListEl.querySelectorAll(".step-item").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.stopPropagation(); // jangan memicu toggle transaksi
      selectStep(Number(el.dataset.seq));
    });
  });
}

/** Pilih step berdasarkan seq (di grup terpilih); state ke store, lompat editor lewat callback */
function selectStep(seq) {
  const store = getStore();
  const step = store.get().currentRun?.steps?.find((candidate) => candidate.seq === seq);
  if (!step) return;
  store.set({ selectedStep: step });
  onSelectStep?.(step);
}

/** Render hanya bila data yang relevan berubah (store juga berubah tiap event log) */
function render() {
  const state = getStore().get();
  const run = state.currentRun;
  const key = [
    run?.runId ?? "",
    run?.steps?.length ?? 0,
    run?.transactions?.length ?? 0,
    run?.options?.iterations ?? 0,
    state.selectedIteration,
    state.selectedStep?.seq ?? "",
    [...expandedTransactions].join("|"),
  ].join("#");
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  updateGroupSelector(state);
  renderSteps(state);
}

/**
 * @param {HTMLElement} container
 * @param {{ onSelect?: (step: Object) => void }} [options] callback saat user mengklik step
 */
export function createStepList(container, { onSelect } = {}) {
  root = container;
  onSelectStep = onSelect ?? null;
  lastRenderKey = "";
  root.innerHTML = `
    <div class="flex flex-col h-full bg-gray-900">
      <div class="p-3 border-b border-gray-700">
        <label class="block text-xs font-medium text-gray-400 mb-1" for="iterationSelect">Iterasi</label>
        <select id="iterationSelect" class="w-full bg-gray-800 border border-gray-700 text-white text-sm px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="1">Iterasi 1</option>
        </select>
      </div>
      <div id="stepListItems" class="flex-1 overflow-y-auto font-mono text-sm"></div>
    </div>
  `;

  groupSelect = root.querySelector("#iterationSelect");
  stepListEl = root.querySelector("#stepListItems");

  groupSelect.addEventListener("change", () => {
    const value = groupSelect.value;
    expandedTransactions.clear();
    getStore().set({ selectedIteration: value === "init" || value === "end" ? value : Number(value), selectedStep: null });
  });

  unsubscribe = subscribe(render);

  return {
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      root = null;
      groupSelect = null;
      stepListEl = null;
      onSelectStep = null;
    },
    selectStep,
  };
}
