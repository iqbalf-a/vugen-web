/**
 * src/components/toolboxPanel.js — Panel Step Toolbox: daftar fungsi VuGen (atas)
 * dan penjelasan + contoh fungsi yang dipilih (bawah).
 *
 * Data dari src/data/toolbox/*.json (bersumber dari OpenText VuGen Function Reference).
 */

import { escapeHtml } from "../utils/html.js";
import { highlightC } from "../utils/cHighlight.js";
import { collectFunctions, filterFunctions, groupByCategory, markMatch } from "../utils/toolbox.js";

const modules = import.meta.glob("../data/toolbox/*.json", { eager: true });

const MIN_LIST_RATIO = 0.2;
const MAX_LIST_RATIO = 0.8;

/** Judul seksi + tombol Copy, bentuknya sama dengan seksi di panel Snapshot */
function section(title, { copyKey = "", badge = "", body }) {
  return `
    <section class="mt-3 first:mt-0">
      <div class="mb-1.5 flex h-5 items-center gap-2">
        <h3 class="text-[11px] font-semibold uppercase tracking-wide text-[#aab4c0]">${title}</h3>
        ${badge}
        ${copyKey ? `<button type="button" data-copy="${copyKey}" class="copy-btn ml-auto h-5 shrink-0 rounded-[3px] border border-[#2a3644] px-2 text-[10px] leading-none text-[#aab4c0] hover:border-[#d2a24c] hover:text-[#d2a24c]">Copy</button>` : ""}
      </div>
      ${body}
    </section>`;
}

function codeBlock(code) {
  return `<pre class="tb-code overflow-auto rounded-[3px] bg-[#1b212b] p-2 font-mono text-[11px] leading-[1.55] text-[#c5ced8]">${highlightC(code)}</pre>`;
}

export function createToolboxPanel(rootEl) {
  const all = collectFunctions(modules);
  let query = "";
  let selected = groupByCategory(all)[0]?.items[0]?.name ?? null;
  let listRatio = 0.45;
  const collapsed = new Set();

  rootEl.innerHTML = `
    <div id="tbRoot" class="flex h-full min-h-0 flex-col bg-[#141922]">
      <div class="panel-toolbar">
        <input id="tbSearch" type="search" placeholder="Search functions" autocomplete="off" spellcheck="false" aria-label="Search functions"
          class="h-7 min-w-0 flex-1 rounded-[3px] border border-[#232a33] bg-[#1b212b] px-2 font-mono text-[12px] text-[#e6edf3] outline-none placeholder:text-[#5b6572] focus:border-[#d2a24c]" />
        <span id="tbCount" class="ui-count" aria-live="polite"></span>
      </div>
      <div id="tbList" role="listbox" aria-label="Functions" tabindex="0" class="tb-list min-h-0 overflow-auto"></div>
      <div id="tbSplit" role="separator" aria-orientation="horizontal" aria-label="Resize list and details" tabindex="0" class="tb-split"></div>
      <div id="tbDetail" class="min-h-0 flex-1 overflow-auto p-3"></div>
    </div>`;

  const searchEl = rootEl.querySelector("#tbSearch");
  const countEl = rootEl.querySelector("#tbCount");
  const listEl = rootEl.querySelector("#tbList");
  const splitEl = rootEl.querySelector("#tbSplit");
  const detailEl = rootEl.querySelector("#tbDetail");
  const rootBox = rootEl.querySelector("#tbRoot");

  let visible = all;
  const copyTexts = new Map();

  function applyRatio() {
    listEl.style.flex = `0 0 ${(listRatio * 100).toFixed(1)}%`;
  }

  function renderList() {
    visible = filterFunctions(all, query);
    countEl.textContent = query.trim() ? `${visible.length} / ${all.length}` : String(all.length);
    if (visible.length === 0) {
      listEl.innerHTML = `<div class="p-4 text-center text-[12px] text-[#5b6572]">${all.length === 0 ? "No function data available" : `No functions match "${escapeHtml(query.trim())}"`}</div>`;
      return;
    }
    const searching = query.trim() !== "";
    listEl.innerHTML = groupByCategory(visible).map(group => {
      const open = searching || !collapsed.has(group.category);
      return `
        <div class="tb-cat" role="presentation" data-cat="${escapeHtml(group.category)}" aria-expanded="${open}">
          <span class="tb-chevron" aria-hidden="true">${open ? "▼" : "▶"}</span>
          <span class="truncate">${escapeHtml(group.category)}</span>
          <span class="ml-auto">${group.items.length}</span>
        </div>
        ${open ? group.items.map(fn => `
          <div role="option" class="tb-row" data-fn="${escapeHtml(fn.name)}" aria-selected="${fn.name === selected}">${markMatch(fn.name, query)}</div>`).join("") : ""}`;
    }).join("");
  }

  function renderDetail() {
    copyTexts.clear();
    const fn = all.find(item => item.name === selected);
    if (!fn) {
      detailEl.innerHTML = `<div class="flex h-full items-center justify-center"><p class="text-center text-[12px] text-[#5b6572]">Select a function to see its description</p></div>`;
      return;
    }
    const args = Array.isArray(fn.args) ? fn.args : [];
    const link = /^https?:\/\//.test(fn.docUrl ?? "")
      ? `<a href="${escapeHtml(fn.docUrl)}" target="_blank" rel="noopener noreferrer" class="shrink-0 text-[11px] text-[#aab4c0] hover:text-[#d2a24c]">Docs ↗</a>`
      : "";
    const sourceBadge = fn.exampleSource === "composed"
      ? `<span class="rounded-[3px] border border-[#6b5a2a] px-1.5 py-0.5 font-mono text-[10px] text-[#e3c664]" title="The official docs have no example for this function; this one was written for Step Toolbox">composed</span>`
      : `<span class="rounded-[3px] border border-[#2a3644] px-1.5 py-0.5 font-mono text-[10px] text-[#aab4c0]" title="Example taken from the official docs">from docs</span>`;

    if (fn.signature) copyTexts.set("signature", fn.signature);
    if (fn.example) copyTexts.set("example", fn.example);

    detailEl.innerHTML = `
      <div class="flex min-w-0 items-center gap-2">
        <h2 class="min-w-0 truncate font-mono text-[13px] font-semibold text-[#e6edf3]" title="${escapeHtml(fn.name)}">${escapeHtml(fn.name)}</h2>
        <span class="shrink-0 rounded-[3px] bg-[#1b212b] px-1.5 py-0.5 font-mono text-[10px] text-[#aab4c0]">${escapeHtml(fn.category)}</span>
        <span class="ml-auto">${link}</span>
      </div>
      ${fn.description ? `<p class="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-[#aab4c0]">${escapeHtml(fn.description)}</p>` : ""}
      <div class="mt-3">
        ${fn.signature ? section("Syntax", { copyKey: "signature", body: codeBlock(fn.signature) }) : ""}
        ${args.length ? section("Arguments", {
          body: `<dl class="tb-args rounded-[3px] bg-[#1b212b] p-2 text-[12px]">${args.map(arg => `<dt class="font-mono text-[#d2a24c]">${escapeHtml(arg.name)}</dt><dd class="leading-5 text-[#aab4c0]">${escapeHtml(arg.desc)}</dd>`).join("")}</dl>`,
        }) : ""}
        ${fn.example ? section("Example", { copyKey: "example", badge: sourceBadge, body: codeBlock(fn.example) }) : ""}
      </div>`;
  }

  function select(name, { scroll = false } = {}) {
    if (!name || name === selected) return;
    selected = name;
    renderList();
    renderDetail();
    detailEl.scrollTop = 0;
    if (scroll) listEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  searchEl.addEventListener("input", () => {
    query = searchEl.value;
    renderList();
  });

  searchEl.addEventListener("keydown", event => {
    if (event.key === "Escape" && searchEl.value) {
      searchEl.value = "";
      query = "";
      renderList();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      listEl.focus();
      if (!visible.some(fn => fn.name === selected)) select(visible[0]?.name, { scroll: true });
    }
  });

  listEl.addEventListener("click", event => {
    const cat = event.target.closest(".tb-cat");
    if (cat) {
      if (query.trim()) return;
      const name = cat.dataset.cat;
      if (collapsed.has(name)) collapsed.delete(name);
      else collapsed.add(name);
      const top = listEl.scrollTop;
      renderList();
      listEl.scrollTop = top;
      return;
    }
    const row = event.target.closest(".tb-row");
    if (row) {
      select(row.dataset.fn);
      listEl.focus();
    }
  });

  listEl.addEventListener("keydown", event => {
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = visible.findIndex(fn => fn.name === selected);
    if (event.key === "ArrowUp" && index <= 0) {
      searchEl.focus();
      return;
    }
    const next = Math.min(visible.length - 1, Math.max(0, (index < 0 ? 0 : index) + step));
    select(visible[next]?.name, { scroll: true });
  });

  detailEl.addEventListener("click", async event => {
    const button = event.target.closest("button[data-copy]");
    if (!button) return;
    const text = copyTexts.get(button.dataset.copy) ?? "";
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    const original = button.textContent;
    button.textContent = ok ? "Copied ✓" : "Failed";
    setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1200);
  });

  splitEl.addEventListener("pointerdown", event => {
    event.preventDefault();
    splitEl.setPointerCapture(event.pointerId);
    const move = moveEvent => {
      const box = rootBox.getBoundingClientRect();
      const toolbar = rootBox.querySelector(".panel-toolbar").offsetHeight;
      const ratio = (moveEvent.clientY - box.top - toolbar) / Math.max(1, box.height - toolbar);
      listRatio = Math.min(MAX_LIST_RATIO, Math.max(MIN_LIST_RATIO, ratio));
      applyRatio();
    };
    const stop = () => {
      splitEl.removeEventListener("pointermove", move);
      splitEl.removeEventListener("pointerup", stop);
      splitEl.removeEventListener("pointercancel", stop);
    };
    splitEl.addEventListener("pointermove", move);
    splitEl.addEventListener("pointerup", stop);
    splitEl.addEventListener("pointercancel", stop);
  });

  splitEl.addEventListener("keydown", event => {
    const delta = { ArrowUp: -0.05, ArrowDown: 0.05 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    listRatio = Math.min(MAX_LIST_RATIO, Math.max(MIN_LIST_RATIO, listRatio + delta));
    applyRatio();
  });

  applyRatio();
  renderList();
  renderDetail();
}
