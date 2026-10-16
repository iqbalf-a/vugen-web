/**
 * src/components/parameterPanel.js — Panel parameter (nilai param saat step).
 */

import { subscribe, getState } from "../store.js";
import { escapeHtml } from "../utils/html.js";

/** @type {HTMLElement|null} */
let root = null;
/** @type {HTMLElement|null} */
let contentEl = null;
/** @type {Function|null} */
let unsubscribe = null;

/** Render parameter panel */
function render() {
  if (!contentEl) return;
  const state = getState();
  const step = state.selectedStep;
  const run = state.currentRun;

  if (!step || !run) {
    contentEl.innerHTML = '<div class="p-4 text-gray-500 text-center">Pilih step dari daftar kiri</div>';
    return;
  }

  const params = run.params || {};

  if (Object.keys(params).length === 0) {
    contentEl.innerHTML = '<div class="p-4 text-gray-500 text-center">Belum ada parameter</div>';
    return;
  }

  contentEl.innerHTML = `
    <div class="p-4 space-y-2">
      ${Object.entries(params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `
        <div class="bg-gray-800 rounded p-3 border border-gray-700">
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs text-gray-400">${escapeHtml(key)}</span>
            <span class="text-xs text-gray-500">${typeof value === "string" ? value.length : "?"} chars</span>
          </div>
          <div class="font-mono text-xs text-green-300 mt-1 break-all bg-gray-900 p-2 rounded">${escapeHtml(String(value))}</div>
        </div>
        `).join("")}
    </div>
  `;
}

function onStateChange() {
  render();
}

export function createParameterPanel(container) {
  root = container;
  root.innerHTML = `
    <div class="flex flex-col h-full bg-gray-900">
      <div class="p-3 border-b border-gray-700">
        <span class="font-medium text-gray-300">Parameter</span>
      </div>
      <div id="content" class="flex-1 overflow-auto"></div>
    </div>
  `;
  contentEl = root.querySelector("#content");

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

export default { createParameterPanel };