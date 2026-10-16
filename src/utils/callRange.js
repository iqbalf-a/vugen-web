/**
 * src/utils/callRange.js — Rentang baris satu pemanggilan fungsi di source C.
 *
 * Dipakai editor: mengklik di mana pun pada area pemanggilan API
 * (dari `web_custom_request(` sampai `LAST);`) memilih step-nya, seperti di VuGen.
 */

/**
 * Nomor baris (1-based) tempat tanda kurung penutup pemanggilan yang dimulai di `startLine`.
 * Kurung di dalam string, karakter, dan komentar diabaikan. Bila bukan pemanggilan fungsi atau
 * kurungnya tidak seimbang, mengembalikan `startLine`.
 *
 * @param {string} text isi file
 * @param {number} startLine baris awal pemanggilan (1-based), mis. `step.line`
 * @returns {number}
 */
export function callEndLine(text, startLine) {
  let pos = 0;
  for (let line = 1; line < startLine; line += 1) {
    const next = text.indexOf("\n", pos);
    if (next < 0) return startLine;
    pos = next + 1;
  }

  let line = startLine;
  let depth = 0;
  let opened = false;

  for (let i = pos; i < text.length; i += 1) {
    const char = text[i];

    if (char === "\n") {
      line += 1;
    } else if (char === '"' || char === "'") {
      // lewati literal string / karakter (dengan escape)
      for (i += 1; i < text.length && text[i] !== char; i += 1) {
        if (text[i] === "\\") i += 1;
        else if (text[i] === "\n") line += 1;
      }
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      i -= 1; // biarkan \n diproses di iterasi berikutnya
    } else if (char === "/" && text[i + 1] === "*") {
      for (i += 2; i < text.length && !(text[i] === "*" && text[i + 1] === "/"); i += 1) {
        if (text[i] === "\n") line += 1;
      }
      i += 1;
    } else if (char === "(") {
      depth += 1;
      opened = true;
    } else if (char === ")") {
      depth -= 1;
      if (opened && depth === 0) return line;
    } else if (!opened && (char === ";" || char === "{" || char === "}")) {
      return startLine; // bukan pemanggilan fungsi
    }
  }

  return startLine;
}
