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
import { availableGroups, endpointParts, formatMs, groupLabel, shortPath, stepGroupOf } from "../utils/steps.js";

/** @type {HTMLElement|null} */
let root = null;
/** @type {HTMLSelectElement|null} */
let groupSelect = null;
/** @type {HTMLElement|null} */
let stepListEl = null;
/** @type {HTMLElement|null} */
let resultBanner = null;
/** @type {HTMLButtonElement|null} */
let collapseAllBtn = null;
/** @type {HTMLButtonElement|null} */
let expandAllBtn = null;
/** @type {Set<string>} nama transaksi yang ditutup user (default semua tertutup; state tampilan lokal) */
const collapsedTransactions = new Set();
/** @type {Set<string>} transaksi yang sudah pernah muncul di run ini; baru → auto-collapse */
const seenTransactions = new Set();
/** runId run terakhir yang dirender; berubah = reset seenTransactions */
let seenRunId = "";
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

/** Render baris pending (request sedang berlangsung) */
function renderPendingRow(pending) {
  if (!pending) return "";
  const { method, url, name, transaction } = pending;
  let path = url || "";
  try { path = new URL(url).pathname; } catch { /* keep as-is */ }
  const parts = path.split("/").filter(Boolean);
  const short = parts.length > 2 ? "…/" + parts.slice(-2).join("/") : path;
  const txLabel = transaction ? escapeHtml(transaction) : "No Transaction";
  const methodLabel = method ? escapeHtml(method) : "";
  return `
    <div class="pending-step-section mt-2 first:mt-1">
      <div class="tx-header flex items-center gap-2 px-3 py-1.5 bg-[#161c24]">
        <span class="w-3 shrink-0 text-center text-[12px] text-[#7d8896]">▾</span>
        <span class="min-w-0 flex-1 truncate font-sans font-semibold text-[#7d8896]">${txLabel}</span>
        <span class="text-[10px] text-[#5b6572] italic">running…</span>
      </div>
      <div class="border-l-2 border-[#d2a24c] py-1 pl-[18px] pr-3 bg-[#1a1e28]">
        <div class="flex min-w-0 items-center gap-2">
          <span class="w-3 shrink-0 text-center text-[10px] text-[#d2a24c] animate-spin" style="display:inline-block">⟳</span>
          <span class="step-number shrink-0 text-[10px] tabular-nums text-[#5b6572]">#${escapeHtml(String(pending.seq))}</span>
          ${methodLabel ? `<span class="w-9 shrink-0 text-center text-[10px] text-[#d2a24c]">${methodLabel}</span>` : ""}
          <span class="min-w-0 flex-1 truncate text-[#d2a24c] text-[12px]">${escapeHtml(short || name || "…")}</span>
          <span class="shrink-0 text-[11px] text-[#5b6572] italic animate-pulse">pending</span>
        </div>
      </div>
    </div>
  `;
}

/** Render daftar step yang dikelompokkan per transaksi */
function renderSteps(state) {
  if (!stepListEl) return;
  const run = state.currentRun;
  const pendingStep = state.pendingStep;
  if (!run || !run.steps) {
    stepListEl.innerHTML = '<div class="px-3 py-2 text-[12px] text-[#5b6572]">No steps yet</div>';
    if (pendingStep) stepListEl.innerHTML += renderPendingRow(pendingStep);
    return;
  }

  const runLogic = state.project?.runLogic;
  const group = state.selectedIteration;
  const steps = run.steps.filter((step) => stepGroupOf(step, runLogic) === group);

  if (steps.length === 0) {
    stepListEl.innerHTML = `<div class="px-3 py-2 text-[12px] text-[#5b6572]">No steps for ${escapeHtml(groupLabel(group))}</div>`;
    return;
  }

  // Group steps by transaction
  const txMap = new Map();
  for (const step of steps) {
    const tx = step.transaction || "No Transaction";
    if (!txMap.has(tx)) txMap.set(tx, []);
    txMap.get(tx).push(step);
  }

  // Transaksi baru yang belum pernah muncul di run ini → auto-collapse (default tertutup)
  const runId = run.runId ?? "";
  if (runId !== seenRunId) { seenRunId = runId; seenTransactions.clear(); }
  for (const txName of txMap.keys()) {
    if (!seenTransactions.has(txName)) {
      seenTransactions.add(txName);
      collapsedTransactions.add(txName);
    }
  }

  const selectedSeq = state.selectedStep?.seq;

  // Header transaksi: "▼ nama (diprioritaskan)  1/2 OK  58ms". Baris API: "✓ #1 [POST] …/content/inquiry  30ms".
  // Nama API = endpoint dari URL request (bukan nama step di script); nama step, status, file:baris ada di tooltip.
  stepListEl.innerHTML = Array.from(txMap.entries()).map(([txName, txSteps]) => {
    const isExpanded = !collapsedTransactions.has(txName);
    const duration = txSteps.reduce((sum, s) => sum + (s.timing?.durationMs || 0), 0);
    const okCount = txSteps.filter(isOk).length;
    const txResult = (run.transactions ?? []).find((tx) => tx.name === txName && tx.iteration === txSteps[0].iteration);
    const txFailed = txResult?.status === "Fail" || okCount < txSteps.length;
    const txTitle = `${txName}${txResult ? ` — ${txResult.status}` : ""} · ${txSteps.length} API`;

    return `
      <div class="tx-section mt-2 first:mt-1">
        <div class="tx-header flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 hover:bg-[#161c24]"
             data-tx="${escapeHtml(txName)}" title="${escapeHtml(txTitle)}">
          <span class="tx-toggle w-3 shrink-0 text-center text-[12px] leading-none text-[#7d8896]" aria-expanded="${isExpanded}">${isExpanded ? "▾" : "▸"}</span>
          <span class="tx-name min-w-0 flex-1 truncate font-sans font-semibold ${txFailed ? "text-red-400" : "text-[#e6edf3]"}">${escapeHtml(txName)}</span>
          <span class="shrink-0 text-[11px] tabular-nums ${txFailed ? "text-red-400" : "text-green-400"}">${okCount}/${txSteps.length} OK</span>
          <span class="tx-duration w-14 shrink-0 text-right text-[11px] tabular-nums text-[#7d8896]">${escapeHtml(formatMs(duration))}</span>
        </div>
        <div class="tx-body ${isExpanded ? "" : "hidden"}" data-tx-body="${escapeHtml(txName)}">
          ${txSteps.map((step) => {
            const { icon, color } = stepStyle(step);
            const { method, path } = endpointParts(step);
            const selected = step.seq === selectedSeq;
            const detail = `${step.name} · ${method} ${path} · #${step.seq} ${step.type} · ${step.response?.status || "-"} · ${formatMs(step.timing?.durationMs)} · ${step.file}:${step.line}`;
            return `
              <div class="step-item cursor-pointer border-l-2 py-1 pl-[18px] pr-3 ${selected ? "border-[#d2a24c] bg-[#1b212b] text-[#e6edf3]" : "border-transparent text-[#aab4c0] hover:bg-[#161c24]"}"
                   data-seq="${escapeHtml(step.seq)}"
                   title="${escapeHtml(detail)}">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="w-3 shrink-0 text-center text-[10px] ${color}">${icon}</span>
                  <span class="step-number shrink-0 text-[10px] tabular-nums text-[#5b6572]">#${escapeHtml(step.seq)}</span>
                  ${method ? `<span class="step-method w-9 shrink-0 text-center text-[10px] text-[#7d8896]">${escapeHtml(method)}</span>` : ""}
                  <span class="step-endpoint min-w-0 flex-1 truncate">${escapeHtml(shortPath(path))}</span>
                  <span class="step-duration w-14 shrink-0 text-right text-[11px] tabular-nums text-[#7d8896]">${escapeHtml(formatMs(step.timing?.durationMs))}</span>
                </div>
                ${step.error ? `<div class="step-error break-words pl-[20px] pt-0.5 text-[11px] text-red-400 [overflow-wrap:anywhere]">${escapeHtml(step.error)}</div>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }).join("") + renderPendingRow(
    // Show pending only if it belongs to the current group
    pendingStep && (pendingStep.iteration === group || (group === "init" && pendingStep.file?.includes("vuser_init")) || (group === "end" && pendingStep.file?.includes("vuser_end")))
      ? pendingStep : null
  );

  // Scroll pending row into view when it appears
  if (pendingStep) {
    setTimeout(() => stepListEl?.querySelector(".pending-step-section")?.scrollIntoView({ block: "nearest" }), 0);
  }

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

/** Render banner status run (passed / failed / stopped / running) */
function updateBanner(state) {
  if (!resultBanner) return;
  const run = state.currentRun;
  const isRunning = state.isRunning;

  if (!run) {
    resultBanner.hidden = true;
    return;
  }

  const status = run.status;
  if (isRunning || status === "running") {
    resultBanner.hidden = true;
    return;
  }

  const steps = run.steps ?? [];
  const okCount = steps.filter((s) => !s.error && s.response?.status >= 200 && s.response?.status < 400).length;
  const durationSec = run.durationMs ? (run.durationMs / 1000).toFixed(1) + "s" : "";

  const isPassed = status === "passed";
  const isStopped = status === "stopped";

  const icon = isPassed ? "✓" : isStopped ? "■" : "✗";
  const label = isPassed ? "PASSED" : isStopped ? "STOPPED" : "FAILED";
  const colorClass = isPassed
    ? "bg-green-900/60 border-green-600 text-green-300"
    : isStopped
      ? "bg-yellow-900/60 border-yellow-600 text-yellow-300"
      : "bg-red-900/60 border-red-700 text-red-300";
  const iconColor = isPassed ? "text-green-400" : isStopped ? "text-yellow-400" : "text-red-400";

  resultBanner.hidden = false;
  resultBanner.className = `shrink-0 flex items-center gap-2 px-3 py-1.5 border-b ${colorClass}`;
  resultBanner.innerHTML = `
    <span class="text-[13px] font-bold ${iconColor}">${icon}</span>
    <span class="font-mono text-[12px] font-bold tracking-wide">${label}</span>
    <span class="ml-auto font-mono text-[11px] opacity-70">${okCount}/${steps.length} OK${durationSec ? " · " + durationSec : ""}</span>
  `;
}

/** Render hanya bila data yang relevan berubah (store juga berubah tiap event log) */
function render() {
  const state = getStore().get();
  const run = state.currentRun;

  const selectionChanged = (state.selectedStep?.seq ?? null) !== lastSelectedSeq;
  lastSelectedSeq = state.selectedStep?.seq ?? null;
  // Step dipilih dari editor: pastikan transaksinya terbuka agar barisnya terlihat
  if (selectionChanged && state.selectedStep) collapsedTransactions.delete(state.selectedStep.transaction || "No Transaction");

  const key = [
    run?.runId ?? "",
    run?.status ?? "",
    run?.steps?.length ?? 0,
    run?.transactions?.length ?? 0,
    run?.options?.iterations ?? 0,
    state.isRunning ? "1" : "0",
    state.selectedIteration,
    state.selectedStep?.seq ?? "",
    state.pendingStep?.seq ?? "",
    [...collapsedTransactions].join("|"),
  ].join("#");
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  updateGroupSelector(state);
  updateBanner(state);
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
    <div class="flex h-full flex-col bg-[#121821]">
      <div id="runResultBanner" hidden class="shrink-0"></div>
      <div class="flex shrink-0 items-center gap-2 px-3 py-2">
        <label class="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[#7d8896]" for="iterationSelect">View</label>
        <select id="iterationSelect" class="h-7 min-w-0 flex-1 rounded-[3px] border border-[#232a33] bg-[#1b212b] px-2 text-[12px] text-[#e6edf3] outline-none focus:border-[#d2a24c]">
          <option value="1">Iteration 1</option>
        </select>
        <button id="expandAllBtn" title="Expand all transactions" class="h-7 w-7 shrink-0 rounded-[3px] border border-[#232a33] bg-[#1b212b] text-[14px] text-[#7d8896] hover:border-[#d2a24c] hover:text-[#e6edf3]">▾</button>
        <button id="collapseAllBtn" title="Collapse all transactions" class="h-7 w-7 shrink-0 rounded-[3px] border border-[#232a33] bg-[#1b212b] text-[14px] text-[#7d8896] hover:border-[#d2a24c] hover:text-[#e6edf3]">▸</button>
      </div>
      <div id="stepListItems" class="min-h-0 flex-1 overflow-y-auto font-mono text-[12px]"></div>
    </div>
  `;

  resultBanner = root.querySelector("#runResultBanner");
  groupSelect = root.querySelector("#iterationSelect");
  stepListEl = root.querySelector("#stepListItems");
  collapseAllBtn = root.querySelector("#collapseAllBtn");
  expandAllBtn = root.querySelector("#expandAllBtn");

  collapseAllBtn.addEventListener("click", () => {
    const state = getStore().get();
    const run = state.currentRun;
    const runLogic = state.project?.runLogic;
    const group = state.selectedIteration;
    const steps = (run?.steps ?? []).filter((step) => stepGroupOf(step, runLogic) === group);
    for (const step of steps) collapsedTransactions.add(step.transaction || "No Transaction");
    lastRenderKey = "";
    render();
  });

  expandAllBtn.addEventListener("click", () => {
    collapsedTransactions.clear();
    lastRenderKey = "";
    render();
  });

  groupSelect.addEventListener("change", () => {
    const value = groupSelect.value;
    collapsedTransactions.clear();
    seenTransactions.clear();
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
      resultBanner = null;
      collapseAllBtn = null;
      expandAllBtn = null;
      onSelectStep = null;
    },
    selectStep,
  };
}
