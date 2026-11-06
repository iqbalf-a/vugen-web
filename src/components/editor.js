/**
 * Editor CodeMirror 6 (mode C) untuk satu file aktif.
 *
 * Tab multi-file ditangani pemanggil (src/main.js): modul ini hanya menampilkan
 * satu dokumen dan melaporkan perubahan.
 */

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { Compartment, EditorState, Prec, RangeSet, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Decoration,
  EditorView,
  GutterMarker,
  MatchDecorator,
  ViewPlugin,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { beautifyC } from "../utils/beautify.js";
import { makeCompletionExtension } from "../utils/vugenComplete.js";

// ── Pending-line highlight ────────────────────────────────────────────────────
/** Set pending line (1-based) or null to clear */
const setPendingLine = StateEffect.define();

/** Stores a DecorationSet for the currently-pending line */
const pendingLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setPendingLine)) continue;
      const lineNum = effect.value;
      if (!lineNum || lineNum < 1 || lineNum > tr.state.doc.lines) return Decoration.none;
      const line = tr.state.doc.line(lineNum);
      return Decoration.set([Decoration.line({ class: "cm-pending-line" }).range(line.from)]);
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const PENDING_THEME = EditorView.baseTheme({
  ".cm-pending-line": {
    backgroundColor: "rgba(210,162,76,0.30) !important",
    boxShadow: "inset 3px 0 0 #d2a24c",
    animation: "cm-pending-pulse 1.2s ease-in-out infinite",
  },
  ".cm-pending-line .cm-gutterElement": {
    color: "#d2a24c !important",
  },
  "@keyframes cm-pending-pulse": {
    "0%,100%": { backgroundColor: "rgba(210,162,76,0.22)" },
    "50%": { backgroundColor: "rgba(210,162,76,0.40)" },
  },
});

// ── Search highlight (custom, replaces CM built-in search panel) ─────────────
const searchMatchEffect = StateEffect.define();
const searchMatchField = StateField.define({
  create: () => Decoration.none,
  update(decos, tr) {
    for (const e of tr.effects) if (e.is(searchMatchEffect)) return e.value;
    return decos.map(tr.changes);
  },
  provide: f => EditorView.decorations.from(f),
});
const SEARCH_THEME = EditorView.baseTheme({
  ".cm-smatch":     { backgroundColor: "rgba(97,175,239,.18)", borderRadius: "2px" },
  ".cm-smatch-cur": { backgroundColor: "rgba(210,162,76,.55)", borderRadius: "2px", outline: "1px solid #d2a24c" },
});
const normalMatchMark  = Decoration.mark({ class: "cm-smatch" });
const currentMatchMark = Decoration.mark({ class: "cm-smatch-cur" });

// ── Function-call highlights ─────────────────────────────────────────────────
const FN_HIGHLIGHT_THEME = EditorView.theme({
  ".cm-fn-vugen, .cm-fn-vugen span": { color: "#61afef !important" },
  ".cm-fn-user, .cm-fn-user span":   { color: "#e5c07b !important" },
});

const vugenFnMark = Decoration.mark({ class: "cm-fn-vugen" });
const userFnMark  = Decoration.mark({ class: "cm-fn-user" });

const fnCallHighlighter = [FN_HIGHLIGHT_THEME, ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = this.build(view); }
    update(update) {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
    }
    build(view) {
      const builder = new RangeSetBuilder();
      const text = view.state.doc.toString();
      const re = /\b(lr_\w+|web_\w+|[A-Z]\w*)\s*(?=\()/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[1].length;
        builder.add(start, end, /^(lr_|web_)/.test(m[1]) ? vugenFnMark : userFnMark);
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
)];

// ── Highlight parameter {nama} ────────────────────────────────────────────────
const paramMark = Decoration.mark({ class: "cm-param-ref" });
const paramMissingMark = Decoration.mark({ class: "cm-param-ref cm-param-ref--unknown" });

/**
 * Sorot referensi parameter seperti {date}. Nama yang ada di .prm/.dat disorot penuh;
 * `{nama}` di dalam string literal yang tidak dikenal diberi gaya "unknown".
 * @param {string[]} paramNames
 */
function makeParamHighlighter(paramNames) {
  const known = new Set(paramNames);
  const matcher = new MatchDecorator({
    regexp: /\{(\w+)\}/g,
    decorate(add, from, to, match) {
      if (known.has(match[1])) add(from, to, paramMark);
      // Parameter tidak dikenal: tidak diberi dekorasi apapun
    },
  });
  return ViewPlugin.fromClass(
    class {
      constructor(view) { this.decorations = matcher.createDeco(view); }
      update(update) { this.decorations = matcher.updateDeco(update, this.decorations); }
    },
    { decorations: (v) => v.decorations },
  );
}

const PARAM_THEME = EditorView.baseTheme({
  ".cm-param-ref": {
    color: "#7ee0a1",
    backgroundColor: "rgba(126,224,161,0.14)",
    borderRadius: "3px",
    boxShadow: "0 0 0 1px rgba(126,224,161,0.35)",
    fontWeight: "600",
  },
  ".cm-param-ref--unknown": {
    color: "#f0a36b",
    backgroundColor: "rgba(240,163,107,0.12)",
    boxShadow: "0 0 0 1px rgba(240,163,107,0.35)",
    textDecoration: "underline wavy rgba(240,163,107,0.7)",
  },
});

// ── Breakpoint gutter ─────────────────────────────────────────────────────────
class BpMarker extends GutterMarker {
  constructor(active = true) {
    super();
    this.active = active;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.active ? "cm-bp-dot cm-bp-dot--on" : "cm-bp-dot cm-bp-dot--ghost";
    el.textContent = "●";
    return el;
  }
  eq(other) { return other instanceof BpMarker && other.active === this.active; }
}
const bpMarker = new BpMarker(true);
const bpGhostMarker = new BpMarker(false);

const toggleBpEffect = StateEffect.define(); // number: 1-based line to toggle
const setBpEffect = StateEffect.define();    // number[]: replace entire set

const bpField = StateField.define({
  create: () => new Set(),
  update(lines, tr) {
    for (const e of tr.effects) {
      if (e.is(toggleBpEffect)) {
        const next = new Set(lines);
        if (next.has(e.value)) next.delete(e.value);
        else next.add(e.value);
        return next;
      }
      if (e.is(setBpEffect)) return new Set(e.value);
    }
    return lines;
  },
});

const BP_THEME = EditorView.baseTheme({
  ".cm-bp-gutter": { width: "18px", cursor: "pointer" },
  ".cm-bp-gutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    lineHeight: "1",
  },
  ".cm-bp-gutter .cm-gutterElement:hover .cm-bp-dot--ghost": { opacity: "0.5" },
  ".cm-bp-dot": {
    fontSize: "13px",
    lineHeight: "1",
    userSelect: "none",
  },
  ".cm-bp-dot--on": { color: "#ef4444" },
  ".cm-bp-dot--ghost": { color: "#ef4444", opacity: "0" },
});

const bpGutter = gutter({
  class: "cm-bp-gutter",
  markers(view) {
    const lines = view.state.field(bpField);
    if (lines.size === 0) return RangeSet.empty;
    const marks = [];
    for (const ln of lines) {
      if (ln >= 1 && ln <= view.state.doc.lines) {
        marks.push(bpMarker.range(view.state.doc.line(ln).from));
      }
    }
    return RangeSet.of(marks, true);
  },
  initialSpacer: () => bpGhostMarker,
  lineMarker(view, line) {
    const ln = view.state.doc.lineAt(line.from).number;
    const lines = view.state.field(bpField);
    return lines.has(ln) ? null : bpGhostMarker;
  },
  lineMarkerChange: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(toggleBpEffect) || e.is(setBpEffect))),
  domEventHandlers: {
    mousedown(view, line) {
      if (view.state.readOnly) return true; // breakpoint dikunci selama run
      const ln = view.state.doc.lineAt(line.from).number;
      view.dispatch({ effects: toggleBpEffect.of(ln) });
      return true;
    },
  },
});

const THEME = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "#0e1116" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-gutters": { backgroundColor: "#121821", border: "none" },
  // Search panel
  ".cm-panels-bottom": { backgroundColor: "#141922", borderTop: "1px solid #232a33" },
  ".cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px 8px",
    padding: "8px 12px",
    fontSize: "12px",
  },
  ".cm-search br": { display: "none" },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    color: "#aab4c0",
  },
  ".cm-search input[type=checkbox]": { accentColor: "#d2a24c" },
  ".cm-textfield": {
    height: "26px",
    width: "220px",
    backgroundColor: "#0f141a",
    border: "1px solid #2a3644",
    borderRadius: "3px",
    color: "#e6edf3",
    padding: "0 6px",
    fontSize: "12px",
    outline: "none",
    boxSizing: "border-box",
  },
  ".cm-textfield:focus": { borderColor: "#d2a24c" },
  ".cm-button": {
    height: "26px",
    padding: "0 10px",
    backgroundColor: "#1b212b",
    border: "1px solid #2a3644",
    borderRadius: "3px",
    color: "#e6edf3",
    fontSize: "12px",
    backgroundImage: "none",
    cursor: "pointer",
  },
  ".cm-button:hover": { borderColor: "#3a4553" },
  "button[name=close]": {
    marginLeft: "auto",
    width: "20px",
    height: "20px",
    padding: "0",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    border: "none",
    color: "#7d8896",
    fontSize: "14px",
    cursor: "pointer",
    backgroundImage: "none",
  },
  "button[name=close]:hover": { color: "#e6edf3" },
  // Search match highlight
  ".cm-searchMatch": {
    backgroundColor: "rgba(210,162,76,.25)",
    outline: "1px solid rgba(210,162,76,.5)",
    borderRadius: "2px",
  },
  ".cm-searchMatch-selected": { backgroundColor: "rgba(210,162,76,.5)" },
});

/**
 * @param {HTMLElement} root
 * @param {{ onChange?: () => void }} [options]
 */
export function createEditor(root, { onChange, onBreakpointsChange } = {}) {
  root.replaceChildren();

  const wrapCompartment = new Compartment();
  const idleCompartment = new Compartment();
  const completionsCompartment = new Compartment();
  const paramHighlightCompartment = new Compartment();
  const idleExtensions = [highlightActiveLine(), highlightSelectionMatches(), EditorState.readOnly.of(false)];
  const runningExtensions = [EditorState.readOnly.of(true)];

  const state = EditorState.create({
    doc: "",
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      idleCompartment.of(idleExtensions),
      drawSelection(),
      history(),
      bracketMatching(),
      indentOnInput(),
      cpp(),
      oneDark,
      THEME,
      EditorView.editable.of(true),
      wrapCompartment.of([]), // word wrap off by default
      completionsCompartment.of([]),
      paramHighlightCompartment.of(makeParamHighlighter([])),
      PARAM_THEME,
      fnCallHighlighter,
      pendingLineField,
      PENDING_THEME,
      searchMatchField,
      SEARCH_THEME,
      bpField,
      BP_THEME,
      bpGutter,
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
        { key: "Ctrl-f", run: () => { _openSearchModal(); return true; } },
        { key: "Ctrl-h", run: () => { _openSearchModal(undefined, true); return true; } },
        { key: "F3",       run: () => { _navMatch(1);  return true; } },
        { key: "Shift-F3", run: () => { _navMatch(-1); return true; } },
        { key: "Escape",   run: () => { if (!_modalEl?.hidden) { _closeSearchModal(); return true; } return false; } },
        { key: "Shift-Alt-f", run: (view) => { if (!view.state.readOnly) { const cur = view.state.doc.toString(); const fmt = beautifyC(cur); if (fmt !== cur) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: fmt } }); } return true; } },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange?.();
        if (update.transactions.some((tr) => tr.effects.some((e) => e.is(toggleBpEffect) || e.is(setBpEffect)))) {
          onBreakpointsChange?.(new Set(update.state.field(bpField)));
        }
      }),
    ],
  });

  const view = new EditorView({ state, parent: root });

  // ── Search state ────────────────────────────────────────────────────────────
  let _smMatches = []; // {from,to,line,lineText,colStart,colEnd}
  let _smIdx = 0;
  let _smFindAllCb = null;

  function _buildMatches(text, caseSensitive, useRegexp) {
    if (!text) return [];
    const src = view.state.doc.toString();
    let re;
    try {
      const esc = useRegexp ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(esc, caseSensitive ? 'g' : 'gi');
    } catch { return []; }
    const doc = view.state.doc;
    const result = [];
    let m;
    while ((m = re.exec(src)) !== null) {
      const line = doc.lineAt(m.index);
      result.push({ from: m.index, to: m.index + m[0].length, line: line.number, lineText: line.text, colStart: m.index - line.from, colEnd: m.index - line.from + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
    return result;
  }

  function _applyHighlights(matches, idx) {
    if (!matches.length) { view.dispatch({ effects: searchMatchEffect.of(Decoration.none) }); return; }
    const builder = new RangeSetBuilder();
    matches.forEach((m, i) => builder.add(m.from, m.to, i === idx ? currentMatchMark : normalMatchMark));
    view.dispatch({ effects: searchMatchEffect.of(builder.finish()) });
  }

  function _navMatch(delta) {
    if (!_smMatches.length) return;
    _smIdx = ((_smIdx + delta) % _smMatches.length + _smMatches.length) % _smMatches.length;
    const m = _smMatches[_smIdx];
    view.dispatch({ selection: { anchor: m.from, head: m.to }, effects: EditorView.scrollIntoView(m.from, { y: 'center' }) });
    _applyHighlights(_smMatches, _smIdx);
    _smCountEl && (_smCountEl.textContent = `${_smIdx + 1}/${_smMatches.length}`);
  }

  // ── Search modal DOM ────────────────────────────────────────────────────────
  const _modalStyle = document.createElement('style');
  _modalStyle.textContent = `
    #_cmSM{position:fixed;z-index:200;background:#1a2030;border:1px solid #2d3748;border-radius:6px;
      box-shadow:0 4px 20px rgba(0,0,0,.55);font-family:ui-monospace,monospace;font-size:12px;color:#abb2bf;min-width:340px}
    #_cmSM .sm-row{display:flex;align-items:center;gap:3px;padding:5px 7px}
    #_cmSM .sm-rrow{padding-top:2px;padding-bottom:6px;border-top:1px solid #232a33}
    #_cmSM .sm-in{flex:1;min-width:0;background:#0e1116;border:1px solid #2d3748;border-radius:3px;
      color:#abb2bf;font-size:12px;padding:3px 7px;outline:none}
    #_cmSM .sm-in:focus{border-color:#61afef}
    #_cmSM .sm-opt,#_cmSM .sm-nav{background:none;border:1px solid transparent;border-radius:3px;
      color:#7d8896;cursor:pointer;font-size:11px;padding:2px 5px;line-height:1.3}
    #_cmSM .sm-opt:hover,#_cmSM .sm-nav:hover{background:#2d3748;color:#abb2bf}
    #_cmSM .sm-opt.on{border-color:#61afef55;background:#61afef22;color:#61afef}
    #_cmSM .sm-sep{width:1px;height:14px;background:#2d3748;margin:0 3px;flex-shrink:0}
    #_cmSM .sm-cnt{color:#5b6572;font-size:11px;min-width:38px;text-align:center;white-space:nowrap}
    #_cmSM .sm-btn{background:#1b212b;border:1px solid #2a3644;border-radius:3px;
      color:#c9d1d9;cursor:pointer;font-size:11px;padding:2px 8px;white-space:nowrap;line-height:1.5}
    #_cmSM .sm-btn:hover{border-color:#3a4553;color:#e6edf3}
    #_cmSM .sm-tog{background:none;border:1px solid transparent;border-radius:3px;
      color:#7d8896;cursor:pointer;font-size:9px;padding:2px 4px;line-height:1.3;flex-shrink:0}
    #_cmSM .sm-tog:hover{background:#2d3748;color:#abb2bf}
    #_cmSM .sm-tog.on{color:#61afef}
    #_cmSM .sm-x{background:none;border:none;color:#5b6572;cursor:pointer;font-size:16px;padding:0 3px;line-height:1}
    #_cmSM .sm-x:hover{color:#abb2bf}
    #_cmSM .sm-spc{width:17px;flex-shrink:0}
  `;
  document.head.appendChild(_modalStyle);

  const _modalEl = document.createElement('div');
  _modalEl.id = '_cmSM';
  _modalEl.hidden = true;
  _modalEl.innerHTML = `
  <div class="sm-row">
    <button class="sm-tog" data-role="tog" title="Toggle Replace (Ctrl+H)">▶</button>
    <input class="sm-in" type="text" placeholder="Search…" autocomplete="off" spellcheck="false">
    <button class="sm-opt" data-role="case" title="Match Case">Aa</button>
    <button class="sm-opt" data-role="re"   title="Use RegExp">.*</button>
    <span class="sm-sep"></span>
    <button class="sm-nav" data-role="prev" title="Previous (Shift+Enter)">↑</button>
    <button class="sm-nav" data-role="next" title="Next (Enter)">↓</button>
    <span class="sm-cnt">—</span>
    <button class="sm-btn" data-role="all"  title="Find All → Search panel (Ctrl+Enter)">Find All</button>
    <button class="sm-x"   data-role="close" title="Close (Esc)">×</button>
  </div>
  <div class="sm-row sm-rrow" hidden>
    <span class="sm-spc"></span>
    <input class="sm-in" data-role="rep" type="text" placeholder="Replace…" autocomplete="off" spellcheck="false">
    <button class="sm-btn" data-role="rep-one" title="Replace current (Enter)">Replace</button>
    <button class="sm-btn" data-role="rep-all" title="Replace All">All</button>
  </div>`;
  document.body.appendChild(_modalEl);

  const _smInput   = _modalEl.querySelector('.sm-row:first-child .sm-in');
  const _smCaseBtn = _modalEl.querySelector('[data-role="case"]');
  const _smReBtn   = _modalEl.querySelector('[data-role="re"]');
  const _smCountEl = _modalEl.querySelector('.sm-cnt');
  const _smTog     = _modalEl.querySelector('[data-role="tog"]');
  const _smRrow    = _modalEl.querySelector('.sm-rrow');
  const _smRepInput = _modalEl.querySelector('[data-role="rep"]');

  function _smCaseOn() { return _smCaseBtn.classList.contains('on'); }
  function _smReOn()   { return _smReBtn.classList.contains('on'); }

  function _runSearch() {
    const text = _smInput.value;
    _smMatches = text ? _buildMatches(text, _smCaseOn(), _smReOn()) : [];
    _smIdx = 0;
    if (!text) {
      _smCountEl.textContent = '—';
      _smInput.style.borderColor = '';
      view.dispatch({ effects: searchMatchEffect.of(Decoration.none) });
    } else if (_smMatches.length) {
      _smCountEl.textContent = `1/${_smMatches.length}`;
      _smInput.style.borderColor = '';
      _applyHighlights(_smMatches, 0);
    } else {
      _smCountEl.textContent = 'Not found';
      _smInput.style.borderColor = '#e06c75';
      view.dispatch({ effects: searchMatchEffect.of(Decoration.none) });
    }
  }

  function _toggleReplace(show) {
    const on = show ?? _smRrow.hidden;
    _smRrow.hidden = !on;
    _smTog.classList.toggle('on', on);
    _smTog.textContent = on ? '▼' : '▶';
    if (on) _smRepInput.focus();
  }

  function _doReplace() {
    if (view.state.readOnly || !_smMatches.length) return;
    const m = _smMatches[_smIdx];
    const repText = _smRepInput.value;
    view.dispatch({ changes: { from: m.from, to: m.to, insert: repText } });
    _runSearch();
    _smCountEl.textContent = _smMatches.length ? `${Math.min(_smIdx + 1, _smMatches.length)}/${_smMatches.length}` : '—';
  }

  function _doReplaceAll() {
    if (view.state.readOnly || !_smMatches.length) return;
    const repText = _smRepInput.value;
    // build changes in reverse order to preserve offsets
    const changes = _smMatches.slice().reverse().map(m => ({ from: m.from, to: m.to, insert: repText }));
    view.dispatch({ changes });
    _runSearch();
    _smCountEl.textContent = '—';
  }

  function _openSearchModal(initialText, withReplace = false) {
    const rect = root.getBoundingClientRect();
    _modalEl.style.top   = (rect.top + 6) + 'px';
    _modalEl.style.right = (window.innerWidth - rect.right + 8) + 'px';
    _modalEl.hidden = false;
    if (withReplace && _smRrow.hidden) _toggleReplace(true);
    if (initialText !== undefined) _smInput.value = initialText;
    _smInput.focus(); _smInput.select();
    _runSearch();
  }

  function _closeSearchModal() {
    _modalEl.hidden = true;
    _smMatches = [];
    _smInput.style.borderColor = '';
    _smCountEl.textContent = '—';
    view.dispatch({ effects: searchMatchEffect.of(Decoration.none) });
    view.focus();
  }

  _smInput.addEventListener('input', _runSearch);
  _smInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); _smFindAllCb?.(_smMatches.slice(), _smInput.value); return; }
    if (e.key === 'Enter') { e.preventDefault(); _navMatch(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); _closeSearchModal(); }
  });
  _smRepInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _doReplace(); }
    if (e.key === 'Escape') { e.preventDefault(); _closeSearchModal(); }
  });
  _smCaseBtn.addEventListener('click', () => { _smCaseBtn.classList.toggle('on'); _runSearch(); });
  _smReBtn.addEventListener('click',   () => { _smReBtn.classList.toggle('on');   _runSearch(); });
  _smTog.addEventListener('click',     () => _toggleReplace());
  _modalEl.querySelector('[data-role="prev"]').addEventListener('click',    () => _navMatch(-1));
  _modalEl.querySelector('[data-role="next"]').addEventListener('click',    () => _navMatch(1));
  _modalEl.querySelector('[data-role="all"]').addEventListener('click',     () => _smFindAllCb?.(_smMatches.slice(), _smInput.value));
  _modalEl.querySelector('[data-role="rep-one"]').addEventListener('click', () => _doReplace());
  _modalEl.querySelector('[data-role="rep-all"]').addEventListener('click', () => _doReplaceAll());
  _modalEl.querySelector('[data-role="close"]').addEventListener('click',   () => _closeSearchModal());

  window.addEventListener('resize', () => { if (!_modalEl.hidden) { const r = root.getBoundingClientRect(); _modalEl.style.top = (r.top+6)+'px'; _modalEl.style.right=(window.innerWidth-r.right+8)+'px'; } });

  return {
    /**
     * @param {number} line nomor baris 1-based
     */
    focusLine(line) {
      const total = view.state.doc.lines;
      const target = Math.min(Math.max(Math.trunc(Number(line)) || 1, 1), total);
      const info = view.state.doc.line(target);
      view.dispatch({
        selection: { anchor: info.from, head: info.to },
        scrollIntoView: true,
      });
      view.focus();
    },

    /** @param {string} text */
    setDoc(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },

    getValue() {
      return view.state.doc.toString();
    },

    focus() {
      view.focus();
    },

    /**
     * Pasang listener ke editor.
     * @param {"cursorActivity"} event dipanggil saat seleksi/kursor berubah
     * @param {Function} handler
     */
    on(event, handler) {
      if (event !== "cursorActivity") return;
      view.dispatch({
        effects: StateEffect.appendConfig.of(
          EditorView.updateListener.of((update) => {
            if (update.selectionSet) handler(update);
          }),
        ),
      });
    },

    /** Posisi kursor: { line } 0-based */
    getCursor() {
      return { line: view.state.doc.lineAt(view.state.selection.main.head).number - 1 };
    },

    /**
     * Highlight the given 1-based line as "pending" (pulsing amber).
     * Pass null or 0 to clear the highlight.
     * @param {number|null} lineNum
     */
    highlightPendingLine(lineNum) {
      const num = (lineNum && lineNum >= 1) ? lineNum : null;
      view.dispatch({ effects: setPendingLine.of(num) });
      if (num && num <= view.state.doc.lines) {
        const pos = view.state.doc.line(num).from;
        // Scroll hanya bila baris di luar area terlihat, supaya tidak melompat di tiap baris
        const coords = view.coordsAtPos(pos);
        const rect = view.scrollDOM.getBoundingClientRect();
        const visible = coords && coords.top >= rect.top + 40 && coords.bottom <= rect.bottom - 40;
        if (!visible) view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      }
    },

    /**
     * Selama run: read-only, tanpa highlight teks yang mirip / active line, dan seleksi dikecilkan
     * ke kursor supaya satu-satunya sorotan adalah baris yang sedang berjalan.
     * @param {boolean} running
     */
    setRunning(running) {
      if (view.state.readOnly === running) return;
      view.dispatch({
        effects: idleCompartment.reconfigure(running ? runningExtensions : idleExtensions),
        selection: running ? { anchor: view.state.selection.main.head } : undefined,
      });
    },

    /** Toggle soft word wrap on/off */
    setWordWrap(enabled) {
      view.dispatch({
        effects: wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
      });
    },

    /**
     * Update sumber autocomplete.
     * @param {string[]} paramNames - nama parameter dari .prm/.dat
     * @param {string[]} varNames   - variabel lokal + nama lr_save_string
     */
    setCompletions(paramNames = [], varNames = []) {
      view.dispatch({
        effects: [
          completionsCompartment.reconfigure(makeCompletionExtension(paramNames, varNames)),
          paramHighlightCompartment.reconfigure(makeParamHighlighter(paramNames)),
        ],
      });
    },

    /** Beautify (reindent) the document content in-place */
    beautify() {
      if (view.state.readOnly) return;
      const current = view.state.doc.toString();
      const formatted = beautifyC(current);
      if (formatted === current) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: formatted },
      });
    },

    /** Set breakpoints for the current doc (replaces all). @param {Set<number>|number[]} lines */
    setBreakpoints(lines) {
      const arr = lines instanceof Set ? [...lines] : (Array.isArray(lines) ? lines : []);
      view.dispatch({ effects: setBpEffect.of(arr) });
    },

    /** @returns {Set<number>} current breakpoints (1-based line numbers) */
    getBreakpoints() {
      return new Set(view.state.field(bpField));
    },

    /** Open the floating search modal, optionally pre-filling query text. */
    openSearch(text) {
      _openSearchModal(text);
    },

    /**
     * Run a search and return matches. Does NOT open the modal.
     * @param {string} text
     * @param {{ caseSensitive?: boolean, useRegexp?: boolean }} [opts]
     * @returns {{ from: number, to: number, line: number, lineText: string, colStart: number, colEnd: number }[]}
     */
    findAll(text, opts = {}) {
      return _buildMatches(text, opts.caseSensitive ?? false, opts.useRegexp ?? false);
    },

    /**
     * Scroll to and select a range in the document.
     * @param {number} from
     * @param {number} to
     */
    goToPosition(from, to) {
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: "center" }),
      });
      view.focus();
    },

    /**
     * Register a callback invoked when the user clicks "All" in the search modal.
     * @param {(matches: object[], query: string) => void} cb
     */
    setFindAllHandler(cb) {
      _smFindAllCb = cb;
    },

    destroy() {
      _modalEl.remove();
      _modalStyle.remove();
      view.destroy();
    },
  };
}
