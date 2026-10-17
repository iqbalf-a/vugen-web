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
import { EditorState, StateEffect } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";

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

const ID_PHRASES = EditorState.phrases.of({
  "Find": "Cari",
  "Replace": "Ganti",
  "next": "Berikutnya",
  "previous": "Sebelumnya",
  "all": "Semua",
  "match case": "Huruf besar/kecil",
  "regexp": "Regex",
  "by word": "Kata utuh",
  "replace": "Ganti",
  "replace all": "Ganti semua",
  "close": "Tutup",
});

/**
 * @param {HTMLElement} root
 * @param {{ onChange?: () => void }} [options]
 */
export function createEditor(root, { onChange } = {}) {
  root.replaceChildren();

  const state = EditorState.create({
    doc: "",
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      bracketMatching(),
      indentOnInput(),
      highlightSelectionMatches(),
      cpp(),
      oneDark,
      THEME,
      ID_PHRASES,
      EditorView.editable.of(true),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange?.();
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

    destroy() {
      view.destroy();
    },
  };
}
