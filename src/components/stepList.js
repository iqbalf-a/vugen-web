/**
 * src/components/stepList.js — Daftar step hasil run + selector iterasi.
 *
 * Fitur:
 * - Tampil step live saat run berjalan (via SSE)
 * - Selector iterasi (1..N) untuk filter step
 * - Transaksi dikelompokkan per iterasi, masing-masing bisa expand/collapse
 * - Klik step → emit event 'stepSelect' dengan data step
 * - Highlight step aktif
 */

import { subscribe, getState } from "../store.js";
import { escapeHtml } from "../utils/html.js";

/** @type {HTMLElement|null} */
let root = null;
/** @type {HTMLSelectElement|null} */
let iterationSelect = null;
/** @type {HTMLElement|null} */
let stepListEl = null;
/** @type {number} */
let selectedIteration = 1;
/** @type {Set<string>} */
let expandedTransactions = new Set();
/** @type {number} */
let selectedStepSeq = null;
/** @type {Function|null} */
let unsubscribe = null;

/** Render daftar step yang dikelompokkan per transaksi */
function renderSteps() {
  if (!stepListEl) return;
  const state = getState();
  const run = state.currentRun;
  if (!run || !run.steps) {
    stepListEl.innerHTML = '<div class="text-muted text-sm p-4">Belum ada step</div>';
    return;
  }

  // Filter step by iteration
  const steps = run.steps.filter(s => s.iteration === selectedIteration);

  if (steps.length === 0) {
    stepListEl.innerHTML = `<div class="text-muted text-sm p-4">Tidak ada step untuk iterasi ${selectedIteration}</div>`;
    return;
  }

  // Group steps by transaction
  const txMap = new Map();
  for (const step of steps) {
    const tx = step.transaction || "Tanpa Transaksi";
    if (!txMap.has(tx)) txMap.set(tx, []);
    txMap.get(tx).push(step);
  }

  // Render each transaction as collapsible section
  stepListEl.innerHTML = Array.from(txMap.entries()).map(([txName, txSteps]) => {
    const isExpanded = expandedTransactions.has(txName);
    const duration = txSteps.reduce((sum, s) => sum + (s.timing?.durationMs || 0), 0);
    const successCount = txSteps.filter(s => s.response?.status >= 200 && s.response?.status < 300).length;
    const totalCount = txSteps.length;

    return `
      <div class="tx-section border-b border-gray-700">
        <!-- Transaction Header -->
        <div class="tx-header px-3 py-2 bg-gray-800 hover:bg-gray-750 cursor-pointer flex items-center gap-2"
             data-tx="${escapeHtml(txName)}"
             style="user-select: none;">
          <span class="tx-toggle font-mono text-xs text-gray-400 w-5" aria-expanded="${isExpanded}">
            ${isExpanded ? "▼" : "▶"}
          </span>
          <span class="font-medium text-gray-200 truncate flex-1">${escapeHtml(txName)}</span>
          <span class="font-mono text-xs text-gray-500">${txSteps.length} API</span>
          <span class="font-mono text-xs text-green-400">${successCount}/${totalCount} OK</span>
          <span class="font-mono text-xs text-gray-500">${duration}ms</span>
        </div>
        <!-- Transaction Body (API Steps) -->
        <div class="tx-body ${isExpanded ? "" : "hidden"}" data-tx-body="${escapeHtml(txName)}">
          ${txSteps.map(step => {
            const statusClass = step.error ? "text-red-400" :
              step.response?.status >= 200 && step.response?.status < 300 ? "text-green-400" :
              step.response?.status >= 400 ? "text-yellow-400" : "text-gray-400";
            const isSelected = step.seq === selectedStepSeq ? "bg-gray-700" : "";
            const statusIcon = step.error ? "✗" :
              step.response?.status >= 200 && step.response?.status < 300 ? "✓" : "⚠";

            return `
              <div class="step-item px-3 py-2 border-b border-gray-700 hover:bg-gray-800 cursor-pointer ${isSelected} ${statusClass} pl-6"
                   data-seq="${escapeHtml(step.seq)}"
                   data-iteration="${escapeHtml(step.iteration)}"
                   title="${escapeHtml(step.file)}:${escapeHtml(step.line)}">
                <div class="flex items-center gap-2">
                  <span class="font-mono text-xs">${statusIcon}</span>
                  <span class="font-mono text-xs text-gray-400">#${escapeHtml(step.seq)}</span>
                  <span class="flex-1 truncate">${escapeHtml(step.name)}</span>
                  <span class="font-mono text-xs">${escapeHtml(step.type)}</span>
                  <span class="font-mono text-xs text-gray-500">${escapeHtml(step.response?.status || "-")}</span>
                  <span class="font-mono text-xs text-gray-500">${escapeHtml(step.timing?.durationMs || 0)}ms</span>
                </div>
                <div class="text-xs text-gray-500 mt-1 truncate">${escapeHtml(step.file)}:${escapeHtml(step.line)}</div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }).join("");

  // Add click handlers for transaction headers (toggle)
  stepListEl.querySelectorAll(".tx-header").forEach(el => {
    el.addEventListener("click", () => {
      const txName = el.dataset.tx;
      if (expandedTransactions.has(txName)) {
        expandedTransactions.delete(txName);
      } else {
        expandedTransactions.add(txName);
      }
      renderSteps();
    });
  });

  // Add click handlers for step items
  stepListEl.querySelectorAll(".step-item").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent triggering tx-header click
      const seq = parseInt(el.dataset.seq, 10);
      const iteration = parseInt(el.dataset.iteration, 10);
      selectStep(seq, iteration);
    });
  });
}

/** Pilih step dan emit event */
function selectStep(seq, iteration) {
  selectedStepSeq = seq;
  selectedIteration = iteration;
  renderSteps();

  const state = getState();
  const run = state.currentRun;
  const step = run?.steps?.find(s => s.seq === seq && s.iteration === iteration);
  if (step) {
    // Emit custom event for other components (bubbles to document)
    root.dispatchEvent(new CustomEvent("stepSelect", { detail: { step, run }, bubbles: true }));
  }
}

/** Update iteration selector options */
function updateIterationSelector() {
  if (!iterationSelect) return;
  const state = getState();
  const run = state.currentRun;
  if (!run || !run.options) return;

  const totalIterations = run.options.iterations || 1;
  const currentValue = iterationSelect.value;

  iterationSelect.innerHTML = Array.from({ length: totalIterations }, (_, i) => i + 1)
    .map(i => `<option value="${i}" ${i == currentValue ? "selected" : ""}>Iterasi ${i}</option>`)
    .join("");

  // Restore selection if valid
  if (currentValue && parseInt(currentValue, 10) <= totalIterations) {
    iterationSelect.value = currentValue;
  }
}

/** Handle state changes */
function onStateChange() {
  const state = getState();
  if (state.currentRunId && state.currentRunId !== state.lastRunId) {
    // New run started
    selectedStepSeq = null;
    selectedIteration = 1;
    expandedTransactions.clear();
    updateIterationSelector();
  }
  renderSteps();
}

/** Create component */
export function createStepList(container) {
  root = container;
  root.innerHTML = `
    <div class="flex flex-col h-full bg-gray-900">
      <div class="p-3 border-b border-gray-700">
        <label class="block text-xs font-medium text-gray-400 mb-1">Iterasi</label>
        <select id="iterationSelect" class="w-full bg-gray-800 border border-gray-700 text-white text-sm px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="1">Iterasi 1</option>
        </select>
      </div>
      <div id="stepList" class="flex-1 overflow-y-auto font-mono text-sm"></div>
    </div>
  `;

  iterationSelect = root.querySelector("#iterationSelect");
  stepListEl = root.querySelector("#stepList");

  iterationSelect.addEventListener("change", () => {
    selectedIteration = parseInt(iterationSelect.value, 10);
    expandedTransactions.clear();
    renderSteps();
  });

  unsubscribe = subscribe(onStateChange);
  onStateChange();

  return {
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      root = null;
      iterationSelect = null;
      stepListEl = null;
    },
    selectStep,
  };
}

export default { createStepList };