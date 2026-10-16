/**
 * src/components/snapshotPanel.js — Panel snapshot (VuGen-style: request + response + raw).
 *
 * Fitur:
 * - Tab: Request / Response / Raw
 * - Request: URL, method, headers, body
 * - Response: status, headers, body (rendered)
 * - Raw: full dump
 * - Toggle "Load resources" untuk HTML response
 */

import { subscribe, getState } from "../store.js";
import { apiGet } from "../api.js";

/** @type {HTMLElement|null} */
let root = null;
/** @type {Function|null} */
let unsubscribe = null;
/** @type {Object|null} */
let currentStep = null;
/** @type {Object|null} */
let currentRun = null;
/** @type {string} */
let activeTab = 'response';

/** Determine content type category */
function getContentCategory(contentType) {
  if (!contentType) return "binary";
  const ct = contentType.toLowerCase();
  if (ct.includes("text/html")) return "html";
  if (ct.includes("application/json") || ct.includes("text/json")) return "json";
  if (ct.includes("xml") || ct.includes("text/xml")) return "xml";
  if (ct.startsWith("text/")) return "text";
  return "binary";
}

/** Pretty print JSON */
function prettyJson(str) {
  try {
    const obj = JSON.parse(str);
    return JSON.stringify(obj, null, 2);
  } catch {
    return str;
  }
}

/** Pretty print XML (simple) */
function prettyXml(str) {
  try {
    let indent = 0;
    return str.replace(/></g, ">\n<").split("\n").map(line => {
      if (line.match(/^\s*<\/?[^>]+>\s*$/)) {
        if (line.startsWith("</")) indent--;
        const result = "  ".repeat(Math.max(0, indent)) + line.trim();
        if (line.startsWith("<") && !line.startsWith("</") && !line.endsWith("/>")) indent++;
        return result;
      }
      return line;
    }).join("\n");
  } catch {
    return str;
  }
}

/** Escape HTML for safe display */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "&#34;")
    .replace(/'/g, "&#039;");
}

/** Format headers object to string */
function formatHeaders(headers) {
  if (!headers || typeof headers !== 'object') return '-';
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

/** Render content based on category */
function renderContent(text, category, loadResources, meta = {}) {
  if (category === "html") {
    const baseHref = loadResources ? `<base href="${new URL(currentStep.request?.url || "").origin}/">` : "";
    const csp = loadResources
      ? "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors 'self';"
      : "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;";

    return `
<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  ${baseHref}
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 10px; font-family: system-ui; background: #1a1a2e; color: #e0e0e0; }
    * { max-width: 100%; box-sizing: border-box; }
    img { max-width: 100%; height: auto; }
    a { color: #60a5fa; }
    form { display: inline; }
    input, button, select, textarea { background: #2d2d44; border: 1px solid #444; color: #e0e0e0; padding: 4px 8px; }
  </style>
</head>
<body>${text}</body>
</html>
    `;
  } else if (category === "json") {
    return `<pre class="p-4 bg-gray-800 rounded text-green-300 text-sm overflow-auto max-h-full">${escapeHtml(prettyJson(text))}</pre>`;
  } else if (category === "xml") {
    return `<pre class="p-4 bg-gray-800 rounded text-yellow-300 text-sm overflow-auto max-h-full">${escapeHtml(prettyXml(text))}</pre>`;
  } else if (category === "text") {
    return `<pre class="p-4 bg-gray-800 rounded text-gray-300 text-sm overflow-auto max-h-full">${escapeHtml(text)}</pre>`;
  } else {
    return `
      <div class="p-4 text-center text-gray-500">
        <div class="text-xl mb-2">📦</div>
        <div>Binary content</div>
        <div class="text-sm mt-1">${escapeHtml(meta.contentType || "-")}</div>
        <div class="text-sm">${((meta.size || 0) / 1024).toFixed(1)} KB</div>
        ${meta.truncated ? '<div class="text-red-400 text-xs mt-2">(Truncated - 5MB limit)</div>' : ''}
      </div>
    `;
  }
}

/** Switch tab */
function switchTab(tab) {
  activeTab = tab;
  renderSnapshot();
}

/** Render tab content for Request */
function renderRequestTab(req, snapshotRequest) {
  // Use snapshot's request if available (has full headers + body), fallback to step request
  const snapReq = snapshotRequest || req;
  const reqMethod = snapReq.method || '-';
  
  // Pretty-print request body based on content-type (same as response tab)
  const reqContentType = snapReq.headers?.['content-type'] || snapReq.headers?.['Content-Type'] || '';
  const reqCategory = getContentCategory(reqContentType);
  const reqBodyText = typeof snapReq.body === 'string' ? snapReq.body : (snapReq.body ? JSON.stringify(snapReq.body, null, 2) : '');
  const reqBodyHtml = reqBodyText ? renderContent(reqBodyText, reqCategory, false, { contentType: reqContentType, size: reqBodyText.length, truncated: false }) : '<div class="p-4 text-gray-500 text-center">No request body</div>';
  const reqSize = snapReq.body ? `${(new Blob([reqBodyText]).size / 1024).toFixed(1)} KB` : '0 KB';
  
  return `
    <div class="space-y-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="px-2 py-0.5 bg-blue-600 text-white text-xs rounded">${reqMethod}</span>
        <span class="font-mono text-xs text-gray-300 break-all">${snapReq.url || '-'}</span>
        <span class="text-xs text-gray-500">${reqCategory} • ${reqSize}</span>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-400 mb-1">Headers</label>
        <pre class="p-3 bg-gray-800 rounded text-gray-300 text-xs overflow-auto max-h-48">${escapeHtml(formatHeaders(snapReq.headers))}</pre>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-400 mb-1">Body (${reqCategory})</label>
        <div class="bg-gray-800 rounded overflow-hidden">${reqBodyHtml}</div>
      </div>
    </div>
  `;
}

/** Render tab content for Response */
function renderResponseTab(resp, contentHtml) {
  const respStatus = resp.status || '-';
  const respStatusText = resp.statusText || '-';
  const respSize = resp.size ? `${(resp.size / 1024).toFixed(1)} KB` : '-';
  
  return `
    <div class="space-y-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="px-2 py-0.5 ${respStatus >= 400 ? 'bg-red-600' : 'bg-green-600'} text-white text-xs rounded">${respStatus} ${respStatusText}</span>
        <span class="text-xs text-gray-500">${resp.contentType || '-'} • ${respSize}</span>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-400 mb-1">Headers</label>
        <pre class="p-3 bg-gray-800 rounded text-gray-300 text-xs overflow-auto max-h-48">${escapeHtml(formatHeaders(resp.headers))}</pre>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-400 mb-1">Body</label>
        <div class="bg-gray-800 rounded overflow-hidden">${contentHtml}</div>
      </div>
    </div>
  `;
}

/** Render tab content for Raw */
function renderRawTab(req, snapshotRequest) {
  const resp = currentStep.response || {};
  
  // Get snapshot's request if available (has full headers + body)
  let snapReq = snapshotRequest || req;
  const reqMethod = snapReq.method || 'GET';
  const reqUrl = snapReq.url || '-';
  const reqHeaders = formatHeaders(snapReq.headers);
  const reqBody = snapReq.body || '';
  
  // Build raw HTTP response
  const respStatus = resp.status || '-';
  const respStatusText = resp.statusText || '-';
  const respHeaders = formatHeaders(resp.headers);
  const respBody = resp.body || '';
  
  // Parse URL for host and path
  let host = '';
  let path;
  try {
    const urlObj = new URL(reqUrl || 'http://localhost/');
    host = urlObj.host;
    path = urlObj.pathname + urlObj.search;
  } catch {
    path = reqUrl || '/';
  }
  
  // Build raw request
  let rawRequest = `${reqMethod} ${path} HTTP/1.1\n`;
  rawRequest += `Host: ${host}\n`;
  if (reqHeaders && reqHeaders !== '-') {
    rawRequest += reqHeaders + '\n';
  }
  if (reqBody && reqBody !== '-') {
    rawRequest += '\n' + reqBody + '\n';
  }
  
  // Build raw response
  let rawResponse = `HTTP/1.1 ${respStatus} ${respStatusText}\n`;
  if (respHeaders && respHeaders !== '-') {
    rawResponse += respHeaders + '\n';
  }
  if (respBody && respBody !== '-') {
    rawResponse += '\n' + respBody + '\n';
  }
  
  return `
    <div class="space-y-4">
      <div>
        <label class="block text-xs font-medium text-gray-400 mb-1">Raw Request</label>
        <pre class="p-3 bg-gray-800 rounded text-green-300 text-xs overflow-auto max-h-64 font-mono">${escapeHtml(rawRequest)}</pre>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-400 mb-1">Raw Response</label>
        <pre class="p-3 bg-gray-800 rounded text-yellow-300 text-xs overflow-auto max-h-64 font-mono">${escapeHtml(rawResponse)}</pre>
      </div>
    </div>
  `;
}

/** Render snapshot panel */
async function renderSnapshot() {
  if (!root) return;
  
  if (!currentStep || !currentRun) {
    root.innerHTML = getEmptyStateHtml();
    return;
  }

  const { response, request } = currentStep;
  const snapshotName = currentStep.snapshot;
  
  let body = null;
  let contentType = response?.contentType || "application/octet-stream";
  let category;
  let truncated = response?.truncated;
  let loadResources = false;

  // Fetch body (from snapshot or step)
  if (snapshotName) {
    try {
      body = await apiGet(`/api/run/${currentRun.runId}/snapshot/${snapshotName}/body`, {
        params: { path: currentRun.scriptPath }
      });
      if (currentRun.snapshots && currentRun.snapshots[snapshotName]) {
        const snap = currentRun.snapshots[snapshotName];
        contentType = snap.response?.contentType || contentType;
        truncated = snap.response?.truncated;
      }
    } catch (error) {
      console.warn("Failed to fetch snapshot body:", error);
    }
  } else if (response && response.bodyFile) {
    try {
      body = await apiGet(`/api/run/${currentRun.runId}/step/${currentStep.seq}/body`, {
        params: { path: currentRun.scriptPath }
      });
    } catch (error) {
      console.warn("Failed to fetch step body:", error);
    }
  }

  category = getContentCategory(contentType);
  const text = body ? new TextDecoder("utf-8").decode(body) : '';
  const contentHtml = renderContent(text, category, loadResources, { contentType, size: body?.byteLength ?? 0, truncated });

  // Request info - use snapshot's request if available (has full headers + body)
  const req = request || {};
  // Response info
  const resp = response || {};

  // Get snapshot's request data if available
  let snapshotRequest = null;
  if (snapshotName && currentRun.snapshots && currentRun.snapshots[snapshotName]) {
    snapshotRequest = currentRun.snapshots[snapshotName].request;
  }

  // Build content based on active tab
  let contentInnerHtml;
  if (activeTab === 'request') {
    contentInnerHtml = renderRequestTab(req, snapshotRequest);
  } else if (activeTab === 'response') {
    contentInnerHtml = renderResponseTab(resp, contentHtml);
  } else {
    contentInnerHtml = renderRawTab(req, snapshotRequest);
  }

  const respStatus = resp.status || '-';
  const respStatusText = resp.statusText || '-';
  const respContentType = resp.contentType || '-';
  const respSize = resp.size ? `${(resp.size / 1024).toFixed(1)} KB` : '-';

  root.innerHTML = `
    <div class="flex flex-col h-full bg-gray-900">
      <!-- Header with tabs -->
      <div class="p-3 border-b border-gray-700 flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="font-medium text-gray-300">Snapshot: ${currentStep.name || 'Step ' + currentStep.seq}</span>
          <span class="text-xs text-gray-500">${respStatus} ${respStatusText} • ${respContentType} • ${respSize}</span>
        </div>
        <div class="flex gap-1 border-b border-gray-700">
          <button data-tab="request" class="tab-btn px-3 py-1 text-xs font-medium rounded-t transition-colors ${activeTab === 'request' ? 'bg-gray-800 text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-500 hover:text-gray-200'}">Request</button>
          <button data-tab="response" class="tab-btn px-3 py-1 text-xs font-medium rounded-t transition-colors ${activeTab === 'response' ? 'bg-gray-800 text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-500 hover:text-gray-200'}">Response</button>
          <button data-tab="raw" class="tab-btn px-3 py-1 text-xs font-medium rounded-t transition-colors ${activeTab === 'raw' ? 'bg-gray-800 text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-500 hover:text-gray-200'}">Raw</button>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-auto p-3">
        ${contentInnerHtml}
      </div>
    </div>
  `;

  // Attach tab listeners
  root.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

/** Empty state HTML */
function getEmptyStateHtml() {
  return `
    <div class="flex flex-col h-full bg-gray-900">
      <div class="p-3 border-b border-gray-700 flex items-center justify-between">
        <span class="font-medium text-gray-300">Snapshot</span>
      </div>
      <div class="flex-1 overflow-auto flex items-center justify-center">
        <div class="p-4 text-gray-500 text-center">Pilih step dari daftar kiri</div>
      </div>
    </div>
  `;
}

/** Handle state changes */
function onStateChange() {
  const state = getState();
  if (state.selectedStep && state.currentRun) {
    currentStep = state.selectedStep;
    currentRun = state.currentRun;
    renderSnapshot();
  }
}

/** Create component */
export function createSnapshotPanel(container) {
  root = container;
  unsubscribe = subscribe(onStateChange);
  onStateChange();

  return {
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      root = null;
      currentStep = null;
      currentRun = null;
    },
  };
}

export default { createSnapshotPanel };