/**
 * src/components/logPanel.js — Panel log live.
 */

import { subscribe, getState } from "../store.js";
import { escapeHtml } from "../utils/html.js";

/** @type {HTMLElement|null} */
let root = null;
/** @type {HTMLElement|null} */
let contentEl = null;
/** @type {Function|null} */
let unsubscribe = null;
/** @type {HTMLElement|null} */
let countEl = null;
/** @type {boolean} */
let autoScroll = true;
/** Jumlah baris yang sudah dirender — untuk incremental append */
let renderedCount = 0;
/** runId yang sedang dirender — reset renderedCount saat run baru */
let renderedRunId = "";

const MAX_DISPLAY = 500;

function getLevelColor(level) {
  switch (level) {
    case "error": return "text-[#f08a8a]";
    case "warn": return "text-[#e3c664]";
    default: return "text-[#aab4c0]";
  }
}

function getLevelIcon(level) {
  switch (level) {
    case "error": return "✗";
    case "warn": return "⚠";
    default: return "·";
  }
}

function formatTime(ts) {
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", { hour12: false }) + "." + String(date.getMilliseconds()).padStart(3, "0");
}

function rowHtml(entry) {
  const location = entry.file ? `${entry.file}:${entry.line ?? ""}` : "";
  return `<div class="log-row grid grid-cols-[84px_104px_minmax(0,1fr)] items-baseline gap-x-3 px-3 py-0.5 hover:bg-[#161c24] ${getLevelColor(entry.level)}"><span class="font-mono text-[11px] tabular-nums text-[#5b6572]">${formatTime(entry.ts)}</span><span class="truncate font-mono text-[11px] text-[#7d8896]" title="${escapeHtml(location)}">${escapeHtml(location)}</span><span class="text-[12px] leading-snug [overflow-wrap:anywhere]"><span class="mr-1 inline-block w-3 text-center">${getLevelIcon(entry.level)}</span>${escapeHtml(entry.msg)}</span></div>`;
}

function render() {
  if (!contentEl) return;
  const state = getState();
  const run = state.currentRun;
  const logs = run?.log || [];
  const runId = run?.runId ?? "";

  // Run baru atau log dikosongkan → full re-render
  if (runId !== renderedRunId || logs.length < renderedCount) {
    renderedRunId = runId;
    renderedCount = 0;
    if (logs.length === 0) {
      contentEl.innerHTML = '<div class="p-4 text-center text-[12px] text-[#5b6572]">No log entries yet</div>';
      if (countEl) countEl.textContent = "0";
      return;
    }
    // Full render: tampilkan MAX_DISPLAY terakhir
    const start = Math.max(0, logs.length - MAX_DISPLAY);
    contentEl.innerHTML = logs.slice(start).map(rowHtml).join("");
    renderedCount = logs.length;
    if (countEl) countEl.textContent = String(logs.length);
    if (autoScroll) contentEl.scrollTop = contentEl.scrollHeight;
    return;
  }

  // Incremental: hanya append baris baru
  if (logs.length <= renderedCount) return;

  // Batasi MAX_DISPLAY total: buang baris awal bila perlu
  const newEntries = logs.slice(renderedCount);
  const totalAfter = renderedCount + newEntries.length;
  if (totalAfter > MAX_DISPLAY) {
    const excess = totalAfter - MAX_DISPLAY;
    const rows = contentEl.querySelectorAll(".log-row");
    for (let i = 0; i < Math.min(excess, rows.length); i++) rows[i].remove();
  }

  contentEl.insertAdjacentHTML("beforeend", newEntries.map(rowHtml).join(""));
  renderedCount = logs.length;
  if (countEl) countEl.textContent = String(logs.length);
  if (autoScroll) contentEl.scrollTop = contentEl.scrollHeight;
}

function onStateChange() {
  render();
}

export function createLogPanel(container) {
  root = container;
  root.innerHTML = `
    <div class="flex h-full flex-col bg-[#141922]">
      <div class="panel-toolbar">
        <span class="text-[12px] font-medium text-[#e6edf3]">Log</span>
        <span id="logCount" class="ui-count">0</span>
        <label class="ml-auto flex cursor-pointer items-center gap-2 text-[11px] text-[#7d8896]">
          <input type="checkbox" id="autoScroll" checked class="accent-[#d2a24c]">
          Auto-scroll
        </label>
      </div>
      <div id="content" class="min-h-0 flex-1 overflow-y-auto py-1"></div>
    </div>
  `;
  contentEl = root.querySelector("#content");
  countEl = root.querySelector("#logCount");
  root.querySelector("#autoScroll").addEventListener("change", (e) => {
    autoScroll = e.target.checked;
  });

  unsubscribe = subscribe(onStateChange);
  onStateChange();

  return {
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      root = null;
      contentEl = null;
      countEl = null;
      renderedCount = 0;
      renderedRunId = "";
    },
  };
}
