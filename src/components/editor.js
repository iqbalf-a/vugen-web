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
import { EditorState } from "@codemirror/state";
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
     * Listen to editor events
     * @param {"cursorActivity"} event
     * @param {Function} handler
     */
    on(event, handler) {
      if (event === "cursorActivity") {
        // Use updateListener to detect cursor/selection changes
        return EditorView.updateListener.of((update) => {
          if (update.selectionSet) handler(update);
        });
      }
    },

    destroy() {
      view.destroy();
    },
  };
}
