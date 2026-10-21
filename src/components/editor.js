/**
 * Editor CodeMirror 6 (mode C) untuk satu file aktif.
 *
 * Tab multi-file ditangani pemanggil (src/main.js): modul ini hanya menampilkan
 * satu dokumen dan melaporkan perubahan.
 */

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Decoration,
  EditorView,
  GutterMarker,
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
      pendingLineField,
      PENDING_THEME,
      bpField,
      BP_THEME,
      bpGutter,
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
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
        effects: completionsCompartment.reconfigure(makeCompletionExtension(paramNames, varNames)),
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

    destroy() {
      view.destroy();
    },
  };
}
