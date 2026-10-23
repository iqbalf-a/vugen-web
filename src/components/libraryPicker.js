/**
 * src/components/libraryPicker.js — Picker 2-level: Channel → Script BP.
 * Muncul sebagai popover di bawah tombol Browse.
 */

import { fetchLibraryChannels, fetchLibraryScripts } from "../api.js";

/** @type {HTMLElement|null} */
let panel = null;
/** @type {((scriptPath: string) => void)|null} */
let onPickCallback = null;
/** @type {string|null} */
let activeChannel = null;
/** @type {Array<{name:string,path:string}>} */
let currentScripts = [];
/** @type {string[]} */
let currentChannels = [];

function close() {
  if (panel) panel.hidden = true;
  activeChannel = null;
}

function getSearchInput() {
  return panel?.querySelector("#libSearch");
}

function renderLoading() {
  const list = panel?.querySelector("#libList");
  if (list) list.innerHTML = `<div class="px-4 py-3 text-[12px] text-[#7d8896]">Loading…</div>`;
}

function renderError(msg) {
  const list = panel?.querySelector("#libList");
  if (list) list.innerHTML = `<div class="px-4 py-3 text-[12px] text-red-400">${msg}</div>`;
}

function applyChannelFilter(query) {
  const list = panel?.querySelector("#libList");
  if (!list) return;
  const q = query.toLowerCase();
  const filtered = q ? currentChannels.filter((ch) => ch.toLowerCase().includes(q)) : currentChannels;
  list.innerHTML = filtered.length === 0
    ? `<div class="px-4 py-3 text-[12px] text-[#5b6572]">No channels match.</div>`
    : filtered.map((ch) => `
        <div class="lib-channel cursor-pointer px-4 py-2 font-mono text-[12px] text-[#c9d1d9] hover:bg-[#1e2734] hover:text-[#e6edf3]"
             data-channel="${ch}">
          ${ch}
        </div>
      `).join("");

  list.querySelectorAll(".lib-channel").forEach((el) => {
    el.addEventListener("click", () => showScripts(el.dataset.channel));
  });
}

function applyScriptFilter(query) {
  const list = panel?.querySelector("#libList");
  if (!list) return;
  const q = query.toLowerCase();
  const filtered = q ? currentScripts.filter((s) => s.name.toLowerCase().includes(q)) : currentScripts;
  list.innerHTML = filtered.length === 0
    ? `<div class="px-4 py-3 text-[12px] text-[#5b6572]">No scripts match.</div>`
    : filtered.map(({ name, path }) => `
        <div class="lib-item cursor-pointer px-4 py-2 font-mono text-[12px] text-[#c9d1d9] hover:bg-[#1e2734] hover:text-[#e6edf3]"
             data-path="${path.replace(/"/g, "&quot;")}">
          ${name}
        </div>
      `).join("");

  list.querySelectorAll(".lib-item").forEach((el) => {
    el.addEventListener("click", () => {
      close();
      onPickCallback?.(el.dataset.path);
    });
  });
}

function buildShell({ headerHtml, onSearch }) {
  panel.innerHTML = `
    <div id="libHeader" class="border-b border-[#232a33]">${headerHtml}</div>
    <div class="px-3 py-2 border-b border-[#1e2530]">
      <input id="libSearch" type="text" placeholder="Search…" autocomplete="off" spellcheck="false"
        class="h-7 w-full rounded-[3px] border border-[#232a33] bg-[#0e1116] px-2.5 font-mono text-[12px] text-[#e6edf3]
               outline-none placeholder:text-[#3d4553] focus:border-[#d2a24c]" />
    </div>
    <div id="libList" class="max-h-[420px] overflow-y-auto py-1"></div>
  `;
  const input = panel.querySelector("#libSearch");
  input.addEventListener("input", () => onSearch(input.value));
  // focus search on render
  requestAnimationFrame(() => input.focus());
}

async function showScripts(channel) {
  activeChannel = channel;
  buildShell({
    headerHtml: `
      <div class="flex items-center gap-2 px-3 py-2">
        <button id="libBackBtn" class="shrink-0 text-[11px] text-[#7d8896] hover:text-[#e6edf3]">← Channels</button>
        <span class="truncate font-mono text-[12px] font-semibold text-[#d2a24c]">${channel}</span>
      </div>`,
    onSearch: applyScriptFilter,
  });

  panel.querySelector("#libBackBtn")?.addEventListener("click", () => showChannels());

  const list = panel.querySelector("#libList");
  list.innerHTML = `<div class="px-4 py-3 text-[12px] text-[#7d8896]">Loading…</div>`;
  try {
    const { scripts } = await fetchLibraryScripts(channel);
    currentScripts = scripts;
    applyScriptFilter(getSearchInput()?.value ?? "");
  } catch (err) {
    renderError(err.message);
  }
}

async function showChannels() {
  activeChannel = null;
  buildShell({
    headerHtml: `
      <div class="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[#7d8896]">
        Select Channel
      </div>`,
    onSearch: applyChannelFilter,
  });

  const list = panel.querySelector("#libList");
  list.innerHTML = `<div class="px-4 py-3 text-[12px] text-[#7d8896]">Loading…</div>`;
  try {
    const { channels } = await fetchLibraryChannels();
    currentChannels = channels;
    applyChannelFilter(getSearchInput()?.value ?? "");
  } catch (err) {
    renderError(err.message);
  }
}

/**
 * @param {HTMLElement} anchor
 * @param {(scriptPath: string) => void} onPick
 */
export function toggleLibraryPicker(anchor, onPick) {
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "libraryPickerPanel";
    panel.className = [
      "absolute z-50 mt-1 w-[560px] rounded-[4px]",
      "border border-[#2a3644] bg-[#141922]",
      "shadow-[0_12px_32px_rgba(0,0,0,0.5)]",
    ].join(" ");
    panel.hidden = true;
    document.body.appendChild(panel);

    document.addEventListener("pointerdown", (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== anchor) close();
    }, { capture: true });
  }

  if (!panel.hidden) {
    close();
    return;
  }

  onPickCallback = onPick;

  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + window.scrollY + 4}px`;
  panel.style.left = `${rect.left + window.scrollX}px`;
  panel.hidden = false;

  showChannels();
}
