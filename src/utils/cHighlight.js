/**
 * src/utils/cHighlight.js — Pewarna sintaks C ringan untuk potongan kode statis (Step Toolbox).
 * Warna kelas `tok-*` didefinisikan di style.css dan mengikuti tema editor (One Dark).
 */

import { escapeHtml } from "./html.js";

const KEYWORDS = "if|else|for|while|do|switch|case|default|break|continue|return|goto|sizeof|typedef|struct|union|enum|static|const|extern|void|char|int|long|short|float|double|unsigned|signed";

const TOKEN = new RegExp([
  String.raw`(?<comment>\/\*[\s\S]*?\*\/|\/\/[^\n]*)`,
  String.raw`(?<string>"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')`,
  String.raw`(?<pre>^[ \t]*#[ \t]*\w+)`,
  String.raw`(?<number>\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)\b)`,
  String.raw`(?<keyword>\b(?:${KEYWORDS})\b)`,
  String.raw`(?<call>\b[A-Za-z_]\w*(?=[ \t]*\())`,
  String.raw`(?<constant>\b[A-Z][A-Z0-9_]{2,}\b)`,
].join("|"), "gm");

const CLASS_BY_GROUP = {
  comment: "tok-comment",
  string: "tok-string",
  pre: "tok-keyword",
  number: "tok-number",
  keyword: "tok-keyword",
  call: "tok-call",
  constant: "tok-constant",
};

/**
 * @param {string} code
 * @returns {string} HTML aman (semua teks sudah di-escape)
 */
export function highlightC(code) {
  const text = String(code ?? "");
  let out = "";
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const group = Object.keys(match.groups).find(key => match.groups[key] !== undefined);
    out += escapeHtml(text.slice(last, match.index));
    out += `<span class="${CLASS_BY_GROUP[group]}">${escapeHtml(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  return out + escapeHtml(text.slice(last));
}
