/**
 * src/components/responsePanel.js — Panel response detail.
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

/** Get status color */
function getStatusColor(status) {
  if (status >= 200 && status < 300) return "text-green-400";
  if (status >= 300 && status < 400) return "text-blue-400";
  if (status >= 400 && status < 500) return "text-yellow-400";
  if (status >= 500) return "text-red-400";
  return "text-gray-400";
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

/** Render response panel */
function render() {
  if (!contentEl) return;
  const state = getState();
  const step = state.selectedStep;

  if (!step || !step.response) {
    contentEl.innerHTML = '<div class="p-4 text-gray-500 text-center">Pilih step dari daftar kiri</div>';
    return;
  }

  const { response } = step;
  const statusColor = getStatusColor(response.status);

  contentEl.innerHTML = `
    <div class="p-4 space-y-4">
      <div class="flex items-center gap-4">
        <div>
          <div class="text-xs text-gray-500">Status</div>
          <div class="font-mono ${statusColor}">${response.status} ${response.statusText || ""}</div>
        </div>
        <div>
          <div class="text-xs text-gray-500">Content-Type</div>
          <div class="font-mono text-gray-300">${response.contentType || "-"}</div>
        </div>
        <div>
          <div class="text-xs text-gray-500">Size</div>
          <div class="font-mono text-gray-300">${response.size || 0} bytes${response.truncated ? " (truncated)" : ""}</div>
        </div>
      </div>
      <div>
        <div class="text-xs text-gray-500 mb-1">Headers</div>
        <pre class="font-mono text-xs text-gray-300 bg-gray-800 p-3 rounded overflow-auto max-h-40">${escapeHtml(formatHeaders(response.headers))}</pre>
      </div>
      ${response.redirectChain && response.redirectChain.length > 0 ? `
      <div>
        <div class="text-xs text-gray-500 mb-1">Redirect Chain</div>
        <pre class="font-mono text-xs text-gray-300 bg-gray-800 p-3 rounded overflow-auto max-h-40">${escapeHtml(JSON.stringify(response.redirectChain, null, 2))}</pre>
      </div>
      ` : ""}
    </div>
  `;
}

function onStateChange() {
  render();
}

export function createResponsePanel(container) {
  root = container;
  root.innerHTML = `
    <div class="flex flex-col h-full bg-gray-900">
      <div class="p-3 border-b border-gray-700">
        <span class="font-medium text-gray-300">Response</span>
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

export default { createResponsePanel };