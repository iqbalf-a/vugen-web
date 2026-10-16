/**
 * src/components/requestPanel.js — Panel request detail.
 */

import { subscribe, getState } from "../store.js";

/** @type {HTMLElement|null} */
let root = null;
/** @type {HTMLElement|null} */
let contentEl = null;
/** @type {Function|null} */
let unsubscribe = null;

/** Format headers for display */
function formatHeaders(headers) {
  if (!headers || Object.keys(headers).length === 0) return "Tidak ada header";
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
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

/** Render request panel */
function render() {
  if (!contentEl) return;
  const state = getState();
  const step = state.selectedStep;

  if (!step || !step.request) {
    contentEl.innerHTML = '<div class="p-4 text-gray-500 text-center">Pilih step dari daftar kiri</div>';
    return;
  }

  const { request } = step;
  const bodyPreview = request.bodyPreview || "(kosong)";

  contentEl.innerHTML = `
    <div class="p-4 space-y-4">
      <div>
        <div class="text-xs text-gray-500 mb-1">Method</div>
        <div class="font-mono text-green-400">${request.method || "-"}</div>
      </div>
      <div>
        <div class="text-xs text-gray-500 mb-1">URL</div>
        <div class="font-mono text-blue-400 break-all">${request.url || "-"}</div>
      </div>
      <div>
        <div class="text-xs text-gray-500 mb-1">Headers</div>
        <pre class="font-mono text-xs text-gray-300 bg-gray-800 p-3 rounded overflow-auto max-h-40">${escapeHtml(formatHeaders(request.headers))}</pre>
      </div>
      <div>
        <div class="text-xs text-gray-500 mb-1">Body Preview</div>
        <pre class="font-mono text-xs text-gray-300 bg-gray-800 p-3 rounded overflow-auto max-h-40">${escapeHtml(bodyPreview)}</pre>
      </div>
    </div>
  `;
}

function onStateChange() {
  render();
}

export function createRequestPanel(container) {
  root = container;
  root.innerHTML = `
    <div class="flex flex-col h-full bg-gray-900">
      <div class="p-3 border-b border-gray-700">
        <span class="font-medium text-gray-300">Request</span>
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

export default { createRequestPanel };