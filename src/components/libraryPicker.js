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

function close() {
  if (panel) panel.hidden = true;
  activeChannel = null;
}

function renderLoading() {
  panel.innerHTML = `<div class="px-4 py-3 text-[12px] text-[#7d8896]">Loading…</div>`;
}

function renderError(msg) {
  panel.innerHTML = `<div class="px-4 py-3 text-[12px] text-red-400">${msg}</div>`;
}

async function showScripts(channel) {
  activeChannel = channel;
  renderLoading();
  try {
    const { scripts } = await fetchLibraryScripts(channel);
    panel.innerHTML = `
      <div class="flex items-center gap-2 border-b border-[#232a33] px-3 py-2">
        <button id="libBackBtn" class="text-[11px] text-[#7d8896] hover:text-[#e6edf3]">← Channels</button>
        <span class="font-mono text-[12px] font-semibold text-[#d2a24c]">${channel}</span>
      </div>
      <div class="max-h-[360px] overflow-y-auto py-1">
        ${scripts.length === 0
          ? `<div class="px-4 py-3 text-[12px] text-[#5b6572]">No scripts in this channel.</div>`
          : scripts.map(({ name, path }) => `
            <div class="lib-item cursor-pointer px-4 py-1.5 font-mono text-[12px] text-[#c9d1d9] hover:bg-[#1e2734] hover:text-[#e6edf3]"
                 data-path="${path.replace(/"/g, "&quot;")}">
              ${name}
            </div>
          `).join("")}
      </div>
    `;

    panel.querySelector("#libBackBtn")?.addEventListener("click", () => showChannels());

    panel.querySelectorAll(".lib-item").forEach((el) => {
      el.addEventListener("click", () => {
        const scriptPath = el.dataset.path;
        close();
        onPickCallback?.(scriptPath);
      });
    });
  } catch (err) {
    renderError(err.message);
  }
}

async function showChannels() {
  activeChannel = null;
  renderLoading();
  try {
    const { channels } = await fetchLibraryChannels();
    panel.innerHTML = `
      <div class="border-b border-[#232a33] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[#7d8896]">
        Select Channel
      </div>
      <div class="max-h-[360px] overflow-y-auto py-1">
        ${channels.map((ch) => `
          <div class="lib-channel cursor-pointer px-4 py-1.5 font-mono text-[12px] text-[#c9d1d9] hover:bg-[#1e2734] hover:text-[#e6edf3]"
               data-channel="${ch}">
            ${ch}
          </div>
        `).join("")}
      </div>
    `;

    panel.querySelectorAll(".lib-channel").forEach((el) => {
      el.addEventListener("click", () => showScripts(el.dataset.channel));
    });
  } catch (err) {
    renderError(err.message);
  }
}

/**
 * @param {HTMLElement} anchor - tombol Browse sebagai referensi posisi
 * @param {(scriptPath: string) => void} onPick - callback saat script dipilih
 */
export function toggleLibraryPicker(anchor, onPick) {
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "libraryPickerPanel";
    panel.className = [
      "absolute z-50 mt-1 w-[380px] rounded-[4px]",
      "border border-[#2a3644] bg-[#141922]",
      "shadow-[0_12px_32px_rgba(0,0,0,0.5)]",
    ].join(" ");
    panel.hidden = true;
    document.body.appendChild(panel);

    // Tutup saat klik di luar
    document.addEventListener("pointerdown", (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== anchor) close();
    }, { capture: true });
  }

  if (!panel.hidden) {
    close();
    return;
  }

  onPickCallback = onPick;

  // Posisi di bawah anchor
  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + window.scrollY + 4}px`;
  panel.style.left = `${rect.left + window.scrollX}px`;
  panel.hidden = false;

  showChannels();
}
