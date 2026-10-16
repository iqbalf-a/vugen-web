/**
 * src/components/logPanel.js — Panel log live.
 */

import { subscribe, getState } from "../store.js";

/** @type {HTMLElement|null} */
let root = null;
/** @type {HTMLElement|null} */
let contentEl = null;
/** @type {Function|null} */
let unsubscribe = null;
/** @type {boolean} */
let autoScroll = true;

/** Get level color */
function getLevelColor(level) {
  switch (level) {
    case "error": return "text-red-400";
    case "warn": return "text-yellow-400";
    case "transaction": return "text-blue-400";
    case "step": return "text-green-400";
    default: return "text-gray-300";
  }
}

/** Get level icon */
function getLevelIcon(level) {
  switch (level) {
    case "error": return "✗";
    case "warn": return "⚠";
    case "transaction": return "⟳";
    case "step": return "▶";
    default: return "ℹ";
  }
}

/** Format timestamp */
function formatTime(ts) {
  const date = new Date(ts);
  return date.toLocaleTimeString("id-ID", { hour12: false }) + "." + String(date.getMilliseconds()).padStart(3, "0");
}

/** Escape HTML for safe display */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "\"")
    .replace(/'/g, "'");
}

/** Render log panel */
function render() {
  if (!contentEl) return;
  const state = getState();
  const run = state.currentRun;
  const logs = run?.log || [];

  if (logs.length === 0) {
    contentEl.innerHTML = '<div class="p-4 text-gray-500 text-center">Belum ada log</div>';
    return;
  }

  // Keep only last 500 entries for performance
  const displayLogs = logs.slice(-500);

  contentEl.innerHTML = displayLogs.map(entry => `
    <div class="px-3 py-1 border-b border-gray-800 hover:bg-gray-800 ${getLevelColor(entry.level)}">
      <div class="flex items-start gap-2 text-xs">
        <span class="font-mono text-gray-500 shrink-0">${formatTime(entry.ts)}</span>
        <span class="font-mono shrink-0">${getLevelIcon(entry.level)}</span>
        <span class="font-mono text-gray-400 shrink-0">${entry.file || ""}:${entry.line || ""}</span>
        <span class="flex-1 break-all">${escapeHtml(entry.msg)}</span>
      </div>
    </div>
  `).join("");

  // Auto scroll to bottom
  if (autoScroll) {
    contentEl.scrollTop = contentEl.scrollHeight;
  }
}

function onStateChange() {
  render();
}

export function createLogPanel(container) {
  root = container;
  root.innerHTML = `
    <div class="flex flex-col h-full bg-gray-900">
      <div class="p-3 border-b border-gray-700 flex items-center justify-between">
        <span class="font-medium text-gray-300">Log</span>
        <label class="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" id="autoScroll" checked class="accent-blue-500">
          Auto-scroll
        </label>
      </div>
      <div id="content" class="flex-1 overflow-y-auto font-mono text-sm"></div>
    </div>
  `;
  contentEl = root.querySelector("#content");
  const autoScrollCheckbox = root.querySelector("#autoScroll");
  autoScrollCheckbox.addEventListener("change", (e) => {
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
    },
  };
}

export default { createLogPanel };