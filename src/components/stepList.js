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
import { availableGroups, endpointLabel, formatMs, groupLabel, stepGroupOf } from "../utils/steps.js";

/** @type {HTMLElement|null} */
let root = null;
/** @type {HTMLSelectElement|null} */
let groupSelect = null;
/** @type {HTMLElement|null} */
let stepListEl = null;
/** @type {Set<string>} nama transaksi yang ditutup user (default semua terbuka; state tampilan lokal) */
const collapsedTransactions = new Set();
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

  // Format ringkas (sidebar sempit): "loadpage ▼  1 API  1/1 OK  29ms", lalu tiap API: "GET /path  5.2ms".
  // Nama API = endpoint dari URL request (bukan nama step di script); nama step, status, file:baris ada di tooltip.
  stepListEl.innerHTML = Array.from(txMap.entries()).map(([txName, txSteps]) => {
    const isExpanded = !collapsedTransactions.has(txName);
    const duration = txSteps.reduce((sum, s) => sum + (s.timing?.durationMs || 0), 0);
    const okCount = txSteps.filter(isOk).length;
    const txResult = (run.transactions ?? []).find((tx) => tx.name === txName && tx.iteration === txSteps[0].iteration);
    const txFailed = txResult?.status === "Fail" || okCount < txSteps.length;
    const txTitle = `${txName}${txResult ? ` — ${txResult.status}` : ""}`;

    return `
      <div class="tx-section mb-1">
        <div class="tx-header flex cursor-pointer select-none items-center gap-2 rounded-[3px] px-2 py-1 hover:bg-[#1b212b]"
             data-tx="${escapeHtml(txName)}" title="${escapeHtml(txTitle)}">
          <span class="min-w-0 truncate font-semibold ${txFailed ? "text-red-400" : "text-[#e6edf3]"}">${escapeHtml(txName)}</span>
          <span class="tx-toggle shrink-0 text-[10px] text-[#7d8896]" aria-expanded="${isExpanded}">${isExpanded ? "▼" : "▶"}</span>
          <span class="ml-auto shrink-0 text-[#7d8896]">${txSteps.length} API</span>
          <span class="shrink-0 ${txFailed ? "text-red-400" : "text-green-400"}">${okCount}/${txSteps.length} OK</span>
          <span class="tx-duration shrink-0 text-[#7d8896]">${escapeHtml(formatMs(duration))}</span>
        </div>
        <div class="tx-body ${isExpanded ? "" : "hidden"}" data-tx-body="${escapeHtml(txName)}">
          ${txSteps.map((step) => {
            const { icon, color } = stepStyle(step);
            const selected = step.seq === selectedSeq ? "bg-[#1b212b] text-[#e6edf3]" : "text-[#aab4c0]";
            const endpoint = endpointLabel(step);
            const detail = `${step.name} · #${step.seq} ${step.type} · ${step.response?.status || "-"} · ${formatMs(step.timing?.durationMs)} · ${step.file}:${step.line}`;
            return `
              <div class="step-item cursor-pointer rounded-[3px] py-0.5 pl-5 pr-2 hover:bg-[#1b212b] ${selected}"
                   data-seq="${escapeHtml(step.seq)}"
                   title="${escapeHtml(detail)}">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span class="shrink-0 text-[10px] ${color}">${icon}</span>
                  <span class="step-number shrink-0 text-[10px] text-[#5b6572]">#${escapeHtml(step.seq)}</span>
                  <span class="step-endpoint min-w-0 flex-1 truncate">${escapeHtml(endpoint)}</span>
                  <span class="step-duration shrink-0 text-[#7d8896]">${escapeHtml(formatMs(step.timing?.durationMs))}</span>
                </div>
                ${step.error ? `<div class="step-error break-all pl-4 text-[10.5px] text-red-400">${escapeHtml(step.error)}</div>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }).join("");

  // Toggle transaksi (default terbuka)
  stepListEl.querySelectorAll(".tx-header").forEach((el) => {
    el.addEventListener("click", () => {
      const txName = el.dataset.tx;
      if (collapsedTransactions.has(txName)) collapsedTransactions.delete(txName);
      else collapsedTransactions.add(txName);
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

/** seq step terpilih pada render terakhir; berubah -> buka transaksinya & scroll ke barisnya */
let lastSelectedSeq = null;

/** Render hanya bila data yang relevan berubah (store juga berubah tiap event log) */
function render() {
  const state = getStore().get();
  const run = state.currentRun;

  const selectionChanged = (state.selectedStep?.seq ?? null) !== lastSelectedSeq;
  lastSelectedSeq = state.selectedStep?.seq ?? null;
  // Step dipilih dari editor: pastikan transaksinya terbuka agar barisnya terlihat
  if (selectionChanged && state.selectedStep) collapsedTransactions.delete(state.selectedStep.transaction || "Tanpa Transaksi");

  const key = [
    run?.runId ?? "",
    run?.steps?.length ?? 0,
    run?.transactions?.length ?? 0,
    run?.options?.iterations ?? 0,
    state.selectedIteration,
    state.selectedStep?.seq ?? "",
    [...collapsedTransactions].join("|"),
  ].join("#");
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  updateGroupSelector(state);
  renderSteps(state);

  if (selectionChanged && state.selectedStep) {
    stepListEl?.querySelector(`.step-item[data-seq="${state.selectedStep.seq}"]`)?.scrollIntoView({ block: "nearest" });
  }
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
    collapsedTransactions.clear();
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
