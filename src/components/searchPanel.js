/**
 * Search panel — right-panel tab that shows clickable Find All results.
 */

/**
 * @param {HTMLElement} container
 * @returns {{ populate: (matches: object[], query: string) => void }}
 */
export function createSearchPanel(container) {
  container.innerHTML = `
    <div class="flex h-full flex-col">
      <div class="flex shrink-0 items-center gap-1.5 border-b border-[#232a33] px-2 py-2">
        <input id="spInput" type="text" placeholder="Search in editor…" autocomplete="off" spellcheck="false"
          class="flex-1 min-w-0 h-7 rounded-[3px] border border-[#2a3644] bg-[#0e1116] px-2 font-mono text-[11.5px] text-[#e6edf3] outline-none placeholder:text-[#5b6572] focus:border-[#61afef]" />
        <button id="spCaseBtn" title="Match Case" class="sp-opt h-7 px-1.5 rounded-[3px] border border-transparent text-[11px] text-[#7d8896] hover:bg-[#1e2734] hover:text-[#abb2bf]">Aa</button>
        <button id="spReBtn"   title="Use RegExp" class="sp-opt h-7 px-1.5 rounded-[3px] border border-transparent text-[11px] text-[#7d8896] hover:bg-[#1e2734] hover:text-[#abb2bf]">.*</button>
        <button id="spRunBtn"  title="Find All"
          class="h-7 shrink-0 rounded-[3px] border border-[#61afef44] bg-[#61afef1a] px-2.5 text-[11px] text-[#61afef] hover:bg-[#61afef30]">Find</button>
      </div>
      <div id="spStatus" class="hidden shrink-0 border-b border-[#232a33] px-3 py-1 font-mono text-[11px] text-[#5b6572]"></div>
      <div id="spResults" class="min-h-0 flex-1 overflow-y-auto"></div>
    </div>
  `;

  const inputEl   = container.querySelector("#spInput");
  const caseBtn   = container.querySelector("#spCaseBtn");
  const reBtn     = container.querySelector("#spReBtn");
  const runBtn    = container.querySelector("#spRunBtn");
  const statusEl  = container.querySelector("#spStatus");
  const resultsEl = container.querySelector("#spResults");

  function toggleOpt(btn) {
    const on = btn.classList.toggle("on");
    btn.classList.toggle("border-[#61afef55]", on);
    btn.classList.toggle("bg-[#61afef22]", on);
    btn.classList.toggle("text-[#61afef]", on);
  }

  caseBtn.addEventListener("click", () => toggleOpt(caseBtn));
  reBtn.addEventListener("click",   () => toggleOpt(reBtn));

  let _goTo = null;

  function _escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function _highlight(lineText, colStart, colEnd) {
    const before = _escHtml(lineText.slice(0, colStart));
    const match  = _escHtml(lineText.slice(colStart, colEnd));
    const after  = _escHtml(lineText.slice(colEnd));
    return `${before}<mark class="sp-mark">${match}</mark>${after}`;
  }

  /**
   * Populate the results list from an array of match objects.
   * Called by main.js after the editor's Find All returns.
   * @param {{ from: number, to: number, line: number, lineText: string, colStart: number, colEnd: number }[]} matches
   * @param {string} query
   */
  function populate(matches, query) {
    if (!matches.length) {
      statusEl.textContent = query ? `No results for "${query}"` : "No results.";
      statusEl.classList.remove("hidden");
      resultsEl.innerHTML = "";
      return;
    }

    statusEl.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"} for "${query}"`;
    statusEl.classList.remove("hidden");

    resultsEl.innerHTML = matches.map((m, i) => `
      <button type="button" class="sp-row w-full text-left px-2.5 py-1.5 hover:bg-[#1a2030] border-b border-[#1c2330] font-mono" data-idx="${i}">
        <div class="flex items-baseline gap-2 leading-none">
          <span class="text-[10px] text-[#5b6572] shrink-0 w-[3ch] text-right">${m.line}</span>
          <span class="text-[11.5px] text-[#abb2bf] truncate">${(() => { const lead = m.lineText.length - m.lineText.trimStart().length; return _highlight(m.lineText.trim(), Math.max(0, m.colStart - lead), Math.max(0, m.colEnd - lead)); })()}</span>
        </div>
      </button>
    `).join("");

    resultsEl.querySelectorAll(".sp-row").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const m = matches[idx];
        _goTo?.(m.from, m.to);
        resultsEl.querySelectorAll(".sp-row").forEach(b => b.classList.remove("bg-[#1e2d40]"));
        btn.classList.add("bg-[#1e2d40]");
      });
    });
  }

  /** Wire a callback to navigate the editor to a position. */
  function setGoToHandler(fn) {
    _goTo = fn;
  }

  /** Trigger a Find All using the current input text, using the editor's findAll API. */
  function setRunHandler(fn) {
    runBtn.addEventListener("click", () => {
      const text = inputEl.value.trim();
      if (!text) { resultsEl.innerHTML = ""; statusEl.classList.add("hidden"); return; }
      const matches = fn(text, { caseSensitive: caseBtn.classList.contains("on"), useRegexp: reBtn.classList.contains("on") });
      populate(matches, text);
    });

    inputEl.addEventListener("keydown", e => {
      if (e.key === "Enter") runBtn.click();
    });
  }

  // inject mark style once
  if (!document.getElementById("_spStyle")) {
    const s = document.createElement("style");
    s.id = "_spStyle";
    s.textContent = `.sp-mark{background:rgba(97,175,239,.25);color:#61afef;border-radius:2px;font-weight:600}`;
    document.head.appendChild(s);
  }

  return { populate, setGoToHandler, setRunHandler };
}
