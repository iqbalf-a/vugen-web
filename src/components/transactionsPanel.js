/**
 * src/components/transactionsPanel.js — Panel Transaksi: ringkasan per nama transaksi.
 *
 * Menampilkan tabel: Nama · Iterasi · Status · Durasi (ms).
 * Baris dikelompokkan per nama; warna status Pass=hijau Fail=merah.
 */

import { getState, subscribe } from "../store.js";
import { escapeHtml } from "../utils/html.js";

/** @type {HTMLElement|null} */
let root = null;
/** @type {HTMLElement|null} */
let contentEl = null;
/** @type {Function|null} */
let unsubscribe = null;
let lastRenderKey = "";

/** Hitung ringkasan per nama dari array transaksi */
function summarize(transactions) {
  const map = new Map();
  for (const t of transactions) {
    let entry = map.get(t.name);
    if (!entry) {
      entry = { name: t.name, count: 0, pass: 0, fail: 0, minMs: Infinity, maxMs: -Infinity, totalMs: 0, rows: [] };
      map.set(t.name, entry);
    }
    entry.count++;
    if (t.status === "Pass") entry.pass++;
    else entry.fail++;
    entry.minMs = Math.min(entry.minMs, t.durationMs);
    entry.maxMs = Math.max(entry.maxMs, t.durationMs);
    entry.totalMs += t.durationMs;
    entry.rows.push(t);
  }
  return [...map.values()];
}

function fmtMs(ms) {
  return ms === Infinity || ms === -Infinity ? "–" : `${ms.toFixed(0)}`;
}

function emptyHtml(msg) {
  return `<div class="p-4 text-center text-[12px] text-[#5b6572]">${escapeHtml(msg)}</div>`;
}

function render() {
  if (!contentEl) return;
  const state = getState();
  const run = state.currentRun;
  const transactions = run?.transactions ?? [];

  const key = [run?.runId ?? "", transactions.length].join("#");
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  if (!run) {
    contentEl.innerHTML = emptyHtml("Belum ada run");
    return;
  }
  if (transactions.length === 0) {
    contentEl.innerHTML = emptyHtml("Belum ada transaksi");
    return;
  }

  const summary = summarize(transactions);

  const rows = summary.map(s => {
    const avgMs = s.count > 0 ? s.totalMs / s.count : 0;
    const statusClass = s.fail > 0 ? "text-red-400" : "text-green-400";
    const statusLabel = s.fail > 0 ? `${s.pass}P ${s.fail}F` : `${s.pass}P`;
    return `
      <tr class="border-t border-[#232a33] align-top hover:bg-[#161c24]">
        <td class="px-3 py-1 font-mono text-[#aab4c0] [overflow-wrap:anywhere]">${escapeHtml(s.name)}</td>
        <td class="px-3 py-1 text-right text-[#7d8896]">${s.count}</td>
        <td class="px-3 py-1 text-center font-semibold ${statusClass}">${statusLabel}</td>
        <td class="px-3 py-1 text-right text-[#aab4c0]">${fmtMs(s.minMs)}</td>
        <td class="px-3 py-1 text-right text-[#aab4c0]">${fmtMs(avgMs)}</td>
        <td class="px-3 py-1 text-right text-[#aab4c0]">${fmtMs(s.maxMs)}</td>
      </tr>`;
  }).join("");

  contentEl.innerHTML = `
    <div class="flex-1 overflow-auto">
      <table class="w-full table-fixed border-collapse text-[11px]">
        <thead class="sticky top-0 bg-[#1b212b] text-left text-[#7d8896]">
          <tr>
            <th class="px-3 py-1.5 font-semibold">Nama</th>
            <th class="px-3 py-1.5 text-right font-semibold">N</th>
            <th class="px-3 py-1.5 text-center font-semibold">Status</th>
            <th class="px-3 py-1.5 text-right font-semibold">Min (ms)</th>
            <th class="px-3 py-1.5 text-right font-semibold">Avg (ms)</th>
            <th class="px-3 py-1.5 text-right font-semibold">Max (ms)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function createTransactionsPanel(container) {
  root = container;
  lastRenderKey = "";
  root.innerHTML = `<div id="txn-content" class="flex h-full flex-col bg-[#141922]"></div>`;
  contentEl = root.querySelector("#txn-content");

  unsubscribe = subscribe(render);

  return {
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      root = null;
      contentEl = null;
    },
  };
}
