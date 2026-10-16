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
import { escapeHtml } from "../utils/html.js";
import { groupLabel, snapshotInfo } from "../utils/steps.js";

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

/** Format headers object to string */
function formatHeaders(headers) {
  if (!headers || typeof headers !== 'object') return '-';
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

/** State lokal panel: toggle "Load resources" untuk HTML response */
let loadResources = false;

/** Bangun dokumen HTML untuk iframe sandbox (dipasang lewat DOM API, bukan innerHTML) */
function buildSnapshotDoc(text, withResources) {
  let baseHref = "";
  if (withResources) {
    try {
      baseHref = `<base href="${escapeHtml(new URL(currentStep.request?.url || "").origin)}/">`;
    } catch {
      baseHref = "";
    }
  }
  // Iframe tetap sandbox="" (tanpa allow-scripts); CSP hanya mengatur resource.
  const csp = withResources
    ? "default-src * data: blob:; script-src 'none'; form-action 'none';"
    : "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none';";

  return `<!DOCTYPE html>
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
</html>`;
}

/** Pasang iframe sandbox ke placeholder lewat DOM API */
function mountHtmlFrame(container, text) {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "");
  frame.className = "w-full bg-gray-900 border-0";
  frame.style.height = "480px";
  frame.srcdoc = buildSnapshotDoc(text, loadResources);
  container.replaceChildren(frame);
}

/** Render content based on category */
function renderContent(text, category, meta = {}) {
  if (category === "html") {
    return '<div data-html-frame></div>';
  } else if (category === "json") {
    return `<pre class="snap-code p-2 text-green-300 text-[11px] leading-snug overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">${escapeHtml(prettyJson(text))}</pre>`;
  } else if (category === "xml") {
    return `<pre class="snap-code p-2 text-yellow-300 text-[11px] leading-snug overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">${escapeHtml(prettyXml(text))}</pre>`;
  } else if (category === "text") {
    return `<pre class="snap-code p-2 text-gray-300 text-[11px] leading-snug overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">${escapeHtml(text)}</pre>`;
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

/** Teks untuk tombol Copy per render; disimpan di sini (bukan di atribut HTML) */
const copyTexts = new Map();

/** Tombol Copy kecil; `text` disalin saat diklik */
function copyButton(text, label = "Copy") {
  const id = String(copyTexts.size + 1);
  copyTexts.set(id, text);
  return `<button type="button" data-copy="${id}" class="copy-btn shrink-0 rounded border border-gray-600 px-1.5 py-0.5 text-[10px] text-gray-300 hover:border-yellow-400 hover:text-yellow-400">${escapeHtml(label)}</button>`;
}

/**
 * Satu bagian panel dengan judul, keterangan, dan tombol Copy (gaya sama di tab Request, Response, dan Raw).
 * @param {string} title judul (teks biasa)
 * @param {string} detail keterangan di sebelah judul (teks biasa)
 * @param {string|null} copyText isi yang disalin; null = tanpa tombol
 * @param {string} innerHtml isi (sudah di-escape pemanggil)
 */
function section(title, detail, copyText, innerHtml) {
  return `
    <section class="snap-section">
      <div class="mb-1 flex items-center gap-2">
        <h3 class="snap-section-title text-[11px] font-semibold uppercase tracking-wide text-gray-400">${escapeHtml(title)}</h3>
        <span class="min-w-0 truncate text-[11px] text-gray-500">${escapeHtml(detail)}</span>
        <span class="ml-auto">${copyText ? copyButton(copyText) : ""}</span>
      </div>
      <div class="rounded bg-gray-800 overflow-hidden">${innerHtml}</div>
    </section>
  `;
}

/** Teks body seperti yang ditampilkan (JSON/XML dirapikan) — juga yang disalin */
function displayBody(text, category) {
  if (category === "json") return prettyJson(text);
  if (category === "xml") return prettyXml(text);
  return text;
}

/** Section Headers: judul, jumlah header, tombol Copy */
function headersSection(headers) {
  const count = headers && typeof headers === "object" ? Object.keys(headers).length : 0;
  const text = count > 0 ? formatHeaders(headers) : "";
  const inner = count > 0
    ? `<pre class="snap-code p-2 text-gray-300 text-[11px] leading-snug overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] max-h-48">${escapeHtml(text)}</pre>`
    : '<div class="p-2 text-[11px] text-gray-500">(tidak ada header)</div>';
  return section("Headers", `${count} header`, count > 0 ? text : null, inner);
}

/** Section Body: judul "Body (json)" dst., ukuran, tombol Copy (tidak untuk biner) */
function bodySection(text, category, htmlInner, sizeText) {
  if (text === "" && category !== "binary") return section("Body", "(kosong)", null, '<div class="p-2 text-[11px] text-gray-500">Tidak ada body</div>');
  return section(`Body (${category})`, sizeText, category === "binary" ? null : displayBody(text, category), htmlInner);
}

/** Render tab content for Request */
function renderRequestTab(snapReq) {
  const reqContentType = snapReq.headers?.['content-type'] || snapReq.headers?.['Content-Type'] || '';
  const reqCategory = getContentCategory(reqContentType) === 'html' ? 'text' : getContentCategory(reqContentType);
  const reqBodyText = snapReq.bodyPreview || '';
  const reqSize = `${(new Blob([reqBodyText]).size / 1024).toFixed(1)} KB${reqBodyText.length >= 2048 ? ' (dipotong 2 KB)' : ''}`;
  const bodyHtml = reqBodyText ? renderContent(reqBodyText, reqCategory, { contentType: reqContentType, size: reqBodyText.length, truncated: false }) : '';

  const requestLine = `
    <div class="flex items-center gap-2 p-2">
      <span class="rounded bg-blue-600 px-2 py-0.5 text-[11px] text-white">${escapeHtml(snapReq.method || '-')}</span>
      <span class="break-all font-mono text-[11px] text-gray-300">${escapeHtml(snapReq.url || '-')}</span>
    </div>`;

  return `
    <div class="space-y-3">
      ${section("Request", "", snapReq.url || null, requestLine)}
      ${headersSection(snapReq.headers)}
      ${bodySection(reqBodyText, reqCategory, bodyHtml, reqSize)}
    </div>
  `;
}

/** Render tab content for Response */
function renderResponseTab(resp, contentHtml, category, text) {
  const respStatus = resp.status || '-';
  const respStatusText = resp.statusText || '-';
  const respSize = resp.size ? `${(resp.size / 1024).toFixed(1)} KB` : '-';

  const statusLine = `
    <div class="flex items-center gap-2 p-2">
      <span class="rounded px-2 py-0.5 text-[11px] text-white ${respStatus >= 400 ? 'bg-red-600' : 'bg-green-600'}">${escapeHtml(respStatus)} ${escapeHtml(respStatusText)}</span>
      <span class="text-[11px] text-gray-500">${escapeHtml(resp.contentType || '-')} • ${escapeHtml(respSize)}</span>
      ${category === 'html' ? `<label class="ml-auto flex cursor-pointer items-center gap-1 text-[11px] text-gray-400"><input type="checkbox" data-load-resources class="accent-blue-500" ${loadResources ? 'checked' : ''}> Load resources</label>` : ''}
    </div>`;

  return `
    <div class="space-y-3">
      ${section("Response", "", null, statusLine)}
      ${headersSection(resp.headers)}
      ${bodySection(text, category, contentHtml, respSize)}
    </div>
  `;
}

/** Render tab content for Raw */
function renderRawTab(snapReq, bodyText) {
  const resp = currentStep.response || {};
  
  const reqMethod = snapReq.method || 'GET';
  const reqUrl = snapReq.url || '-';
  const reqHeaders = formatHeaders(snapReq.headers);
  const reqBody = snapReq.bodyPreview || '';
  
  // Build raw HTTP response
  const respStatus = resp.status || '-';
  const respStatusText = resp.statusText || '-';
  const respHeaders = formatHeaders(resp.headers);
  const respBody = bodyText || '';
  
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
  
  const rawPre = (value, color) => `<pre class="snap-code p-2 font-mono text-[11px] leading-snug overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] max-h-64 ${color}">${escapeHtml(value)}</pre>`;

  return `
    <div class="space-y-3">
      ${section("Raw Request", "", rawRequest, rawPre(rawRequest, "text-green-300"))}
      ${section("Raw Response", "", rawResponse, rawPre(rawResponse, "text-yellow-300"))}
    </div>
  `;
}

/** Render snapshot panel */
async function renderSnapshot() {
  if (!root) return;
  copyTexts.clear();
  
  if (!currentStep || !currentRun) {
    root.innerHTML = getEmptyStateHtml();
    return;
  }

  const { response, request } = currentStep;
  
  let body = null;
  let contentType = response?.contentType || "application/octet-stream";
  let category;
  let truncated = response?.truncated;

  // Fetch body step (runner menulis ke steps/<seq>.body)
  if (response && response.bodyFile) {
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
  const contentHtml = renderContent(text, category, { contentType, size: body?.byteLength ?? 0, truncated });

  const req = request || {};
  // Response info
  const resp = response || {};

  // Build content based on active tab
  let contentInnerHtml;
  if (activeTab === 'request') {
    contentInnerHtml = renderRequestTab(req);
  } else if (activeTab === 'response') {
    contentInnerHtml = renderResponseTab(resp, contentHtml, category, text);
  } else {
    contentInnerHtml = renderRawTab(req, text);
  }

  const respStatus = resp.status || '-';
  const respStatusText = resp.statusText || '-';
  const respContentType = resp.contentType || '-';
  const respSize = resp.size ? `${(resp.size / 1024).toFixed(1)} KB` : '-';

  // Identitas snapshot: nomor (= #seq di daftar step), endpoint, dan petunjuk duplikat
  const snap = snapshotInfo(currentStep, currentRun.steps ?? [currentStep], getState().project?.runLogic);
  const snapMeta = [
    currentStep.name,
    currentStep.snapshot ? `Snapshot=${currentStep.snapshot}` : null,
    groupLabel(snap.group),
    `${currentStep.file}:${currentStep.line}`,
  ].filter(Boolean).join(" · ");

  root.innerHTML = `
    <div class="flex flex-col h-full bg-gray-900">
      <!-- Header with tabs -->
      <div class="p-3 border-b border-gray-700 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="snapshot-title min-w-0 truncate font-medium text-gray-300"><span class="snapshot-number text-yellow-400">Snapshot #${escapeHtml(snap.number)}</span> ${escapeHtml(snap.endpoint)}${snap.duplicate ? ` <span class="snapshot-duplicate text-xs text-gray-400">(ke-${escapeHtml(snap.duplicate.index)} dari ${escapeHtml(snap.duplicate.total)} pemanggilan endpoint ini)</span>` : ""}</span>
          <span class="shrink-0 text-xs text-gray-500">${escapeHtml(respStatus)} ${escapeHtml(respStatusText)} • ${escapeHtml(respContentType)} • ${escapeHtml(respSize)}</span>
        </div>
        <div class="snapshot-meta truncate text-[11px] text-gray-500" title="${escapeHtml(snapMeta)}">${escapeHtml(snapMeta)}</div>
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

  // Pasang iframe sandbox HTML (DOM API) + toggle Load resources
  const frameSlot = root.querySelector('[data-html-frame]');
  if (frameSlot) mountHtmlFrame(frameSlot, text);
  root.querySelector('[data-load-resources]')?.addEventListener('change', (e) => {
    loadResources = e.target.checked;
    renderSnapshot();
  });

  // Tombol Copy
  root.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => void copyToClipboard(copyTexts.get(button.dataset.copy) ?? '', button));
  });

  // Attach tab listeners
  root.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

/** Salin teks ke clipboard (fallback textarea bila Clipboard API tidak tersedia); beri umpan balik di tombol */
async function copyToClipboard(text, button) {
  let ok = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    ok = document.execCommand('copy');
    area.remove();
  }
  const original = button.textContent;
  button.textContent = ok ? 'Tersalin ✓' : 'Gagal';
  setTimeout(() => {
    if (button.isConnected) button.textContent = original;
  }, 1200);
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
