/**
 * src/components/openingDialog.js — Dialog progress saat membuka script folder.
 *
 * Karena openProject adalah satu API call tanpa streaming, progress disimulasi
 * lewat beberapa tahap animasi, lalu loncat ke 100% saat selesai.
 */

/** @type {HTMLElement|null} */
let overlay = null;
/** @type {HTMLElement|null} */
let bar = null;
/** @type {HTMLElement|null} */
let stageEl = null;
/** @type {HTMLElement|null} */
let pctEl = null;
/** @type {number|null} */
let tickTimer = null;

const STAGES = [
  { pct: 10, label: "Reading file list…" },
  { pct: 30, label: "Loading parameters .prm / .dat…" },
  { pct: 55, label: "Analyzing run logic…" },
  { pct: 75, label: "Compiling script…" },
  { pct: 92, label: "Preparing view…" },
];

let stageIdx = 0;
let currentPct = 0;

function setProgress(pct, label) {
  currentPct = pct;
  if (bar) bar.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
  if (label && stageEl) stageEl.textContent = label;
}

function tick() {
  if (stageIdx >= STAGES.length) return;
  const stage = STAGES[stageIdx];
  if (currentPct < stage.pct) {
    const step = Math.max(0.8, (stage.pct - currentPct) * 0.12);
    setProgress(Math.min(currentPct + step, stage.pct), stage.label);
    tickTimer = setTimeout(tick, 60);
  } else {
    stageIdx += 1;
    tickTimer = setTimeout(tick, 350);
  }
}

function ensureOverlay() {
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.className = [
    "fixed inset-0 z-[200] flex items-center justify-center",
    "bg-black/60 backdrop-blur-[2px]",
  ].join(" ");
  overlay.hidden = true;

  overlay.innerHTML = `
    <div class="w-[420px] rounded-[6px] border border-[#2a3644] bg-[#141922] shadow-[0_20px_48px_rgba(0,0,0,0.7)] px-6 py-5">
      <div class="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[#7d8896]">Opening script</div>
      <div id="openDlgPath" class="mb-4 truncate font-mono text-[12px] text-[#e6edf3]"></div>
      <div class="mb-2 h-2 w-full overflow-hidden rounded-full bg-[#232a33]">
        <div id="openDlgBar" class="h-full rounded-full bg-[#d2a24c] transition-[width] duration-75 ease-linear" style="width:0%"></div>
      </div>
      <div class="flex items-center justify-between">
        <span id="openDlgStage" class="font-mono text-[11px] text-[#7d8896]">Starting…</span>
        <span id="openDlgPct" class="font-mono text-[11px] tabular-nums text-[#7d8896]">0%</span>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  bar = overlay.querySelector("#openDlgBar");
  stageEl = overlay.querySelector("#openDlgStage");
  pctEl = overlay.querySelector("#openDlgPct");
}

/**
 * Tampilkan dialog dan mulai animasi progress.
 * @param {string} scriptPath
 */
export function showOpeningDialog(scriptPath) {
  ensureOverlay();
  stageIdx = 0;
  currentPct = 0;
  setProgress(0, "Starting…");

  const pathEl = overlay.querySelector("#openDlgPath");
  if (pathEl) pathEl.textContent = scriptPath;

  overlay.hidden = false;
  clearTimeout(tickTimer);
  tickTimer = setTimeout(tick, 80);
}

/** Selesai sukses — lompat ke 100%, tutup setelah sebentar. */
export function completeOpeningDialog() {
  clearTimeout(tickTimer);
  setProgress(100, "Done!");
  tickTimer = setTimeout(() => {
    if (overlay) overlay.hidden = true;
  }, 400);
}

/** Gagal — tutup segera. */
export function failOpeningDialog() {
  clearTimeout(tickTimer);
  if (overlay) overlay.hidden = true;
}
