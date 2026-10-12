/**
 * Tokenizer untuk subset C yang dipakai script VuGen.
 *
 * Yang wajib dipahami (plan §7.2):
 * - string literal + escape (`\"`, `\\`, `\n`, `\x..`)
 * - concatenation literal bersebelahan (`"a" "b"` -> satu token)
 * - komentar `//` dan `/* *\/`
 * - makro `LAST`, `ITEMDATA`, `ENDITEM`, `EXTRARES` (tetap token identifier biasa;
 *   pemetaannya dilakukan di transpiler)
 * - direktif preprocessor (`#include`, `#define`) sebagai token `directive`
 *
 * @typedef {object} Token
 * @property {"string" | "char" | "number" | "identifier" | "punct" | "directive" | "eof"} type
 * @property {string} value nilai ter-decode (string sudah di-unescape)
 * @property {string} raw potongan sumber asli
 * @property {number} line baris 1-based
 * @property {number} col kolom 1-based
 * @property {number} start offset karakter awal
 * @property {number} end offset karakter setelah token
 *
 * @typedef {object} LexWarning
 * @property {number} line
 * @property {number} col
 * @property {string} message
 */

const PUNCTUATORS = [
  ">>=",
  "<<=",
  "->",
  "++",
  "--",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<",
  ">>",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ";",
  ",",
  ".",
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "<",
  ">",
  "!",
  "&",
  "|",
  "^",
  "~",
  "?",
  ":",
  "#",
];

const NUMBER_PATTERN = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)[uUlLfF]*/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*/;

/**
 * Decode satu escape sequence yang mulai di `source[start]` (yaitu `\`).
 * Kembalikan null bila tidak ada karakter setelah backslash.
 *
 * @param {string} source
 * @param {number} start
 * @returns {{ text: string, length: number } | null}
 */
function decodeEscape(source, start) {
  const marker = source[start + 1];
  if (marker === undefined) return null;

  switch (marker) {
    case "n":
      return { text: "\n", length: 2 };
    case "t":
      return { text: "\t", length: 2 };
    case "r":
      return { text: "\r", length: 2 };
    case "b":
      return { text: "\b", length: 2 };
    case "f":
      return { text: "\f", length: 2 };
    case "v":
      return { text: "\v", length: 2 };
    case "a":
      return { text: "\x07", length: 2 };
    case "0":
      return { text: "\0", length: 2 };
    case "\\":
      return { text: "\\", length: 2 };
    case '"':
      return { text: '"', length: 2 };
    case "'":
      return { text: "'", length: 2 };
    case "?":
      return { text: "?", length: 2 };
    case "x": {
      const match = /^[0-9a-fA-F]{1,2}/.exec(source.slice(start + 2));
      if (!match) return { text: "x", length: 2 };
      return { text: String.fromCharCode(Number.parseInt(match[0], 16)), length: 2 + match[0].length };
    }
    case "\n":
      // Line continuation: backslash + newline tidak menghasilkan karakter.
      return { text: "", length: 2 };
    case "\r":
      return { text: "", length: source[start + 2] === "\n" ? 3 : 2 };
    default:
      // Escape yang tidak dikenal: pertahankan karakternya apa adanya.
      return { text: marker, length: 2 };
  }
}

/**
 * Tokenize sumber C.
 *
 * @param {string} source
 * @returns {{ tokens: Token[], warnings: LexWarning[] }}
 */
function tokenizeInternal(source) {
  /** @type {Token[]} */
  const tokens = [];
  /** @type {LexWarning[]} */
  const warnings = [];

  let index = 0;
  let line = 1;
  let lineStart = 0;
  let atLineStart = true;

  const col = () => index - lineStart + 1;

  function advanceLines(segment) {
    for (let i = 0; i < segment.length; i += 1) {
      if (segment[i] === "\n") {
        line += 1;
        lineStart = index + i + 1;
      }
    }
  }

  /** Tambahkan token; gabungkan string literal yang bersebelahan (C concatenation). */
  function emit(token) {
    if (token.type === "string") {
      const previous = tokens[tokens.length - 1];
      if (previous && previous.type === "string") {
        previous.value += token.value;
        previous.raw = source.slice(previous.start, token.end);
        previous.end = token.end;
        return;
      }
    }
    tokens.push(token);
  }

  while (index < source.length) {
    const char = source[index];

    // Spasi & baris baru.
    if (char === "\n") {
      index += 1;
      line += 1;
      lineStart = index;
      atLineStart = true;
      continue;
    }
    if (char === "\r") {
      index += 1;
      if (source[index] !== "\n") {
        line += 1;
        lineStart = index;
      }
      atLineStart = true;
      continue;
    }
    if (char === " " || char === "\t" || char === "\f" || char === "\v") {
      index += 1;
      continue;
    }

    // Komentar.
    if (char === "/" && source[index + 1] === "/") {
      const newline = source.indexOf("\n", index);
      index = newline === -1 ? source.length : newline;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      const raw = close === -1 ? source.slice(index) : source.slice(index, close + 2);
      advanceLines(raw);
      if (close === -1) {
        warnings.push({ line, col: col(), message: "Komentar /* tidak ditutup." });
        index = source.length;
      } else {
        index = close + 2;
      }
      continue;
    }

    // Direktif preprocessor (hanya di awal baris).
    if (char === "#" && atLineStart) {
      const start = index;
      const startLine = line;
      const startCol = col();
      while (index < source.length) {
        const current = source[index];
        if (current === "\\" && (source[index + 1] === "\n" || source[index + 1] === "\r")) {
          index += source[index + 1] === "\r" && source[index + 2] === "\n" ? 3 : 2;
          continue;
        }
        if (current === "\n") break;
        index += 1;
      }
      const raw = source.slice(start, index);
      advanceLines(raw);
      emit({
        type: "directive",
        value: raw.replace(/^#\s*/, "").trimEnd(),
        raw,
        line: startLine,
        col: startCol,
        start,
        end: index,
      });
      atLineStart = false;
      continue;
    }

    // String / char literal.
    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      const startLine = line;
      const startCol = col();
      index += 1;

      let value = "";
      let terminated = false;

      while (index < source.length) {
        const current = source[index];
        if (current === "\n" || current === "\r") break;
        if (current === "\\") {
          const decoded = decodeEscape(source, index);
          if (!decoded) break;
          value += decoded.text;
          index += decoded.length;
          continue;
        }
        if (current === quote) {
          index += 1;
          terminated = true;
          break;
        }
        value += current;
        index += 1;
      }

      if (!terminated) {
        warnings.push({ line: startLine, col: startCol, message: `Literal ${quote} tidak ditutup.` });
      }

      emit({
        type: quote === '"' ? "string" : "char",
        value,
        raw: source.slice(start, index),
        line: startLine,
        col: startCol,
        start,
        end: index,
      });
      atLineStart = false;
      continue;
    }

    // Angka.
    if (char >= "0" && char <= "9") {
      const match = NUMBER_PATTERN.exec(source.slice(index));
      const text = match ? match[0] : char;
      const start = index;
      const startLine = line;
      const startCol = col();
      index += text.length;
      // Sufiks `u`/`U`/`l`/`L` (dan `f`/`F` untuk desimal) dibuang. Untuk
      // hex/binary `f` adalah digit, jadi hanya `uUlL` yang boleh dibuang.
      const suffix = /^0[xXbB]/.test(text) ? /[uUlL]+$/ : /[uUlLfF]+$/;
      emit({
        type: "number",
        value: text.replace(suffix, ""),
        raw: text,
        line: startLine,
        col: startCol,
        start,
        end: index,
      });
      atLineStart = false;
      continue;
    }

    // Identifier / keyword.
    if (/[A-Za-z_$]/.test(char)) {
      const match = IDENTIFIER_PATTERN.exec(source.slice(index));
      const text = match ? match[0] : char;
      const start = index;
      const startLine = line;
      const startCol = col();
      index += text.length;
      emit({
        type: "identifier",
        value: text,
        raw: text,
        line: startLine,
        col: startCol,
        start,
        end: index,
      });
      atLineStart = false;
      continue;
    }

    // Punctuator (coba 3 lalu 2 karakter sebelum 1).
    const punct =
      PUNCTUATORS.find((candidate) => source.startsWith(candidate, index) && candidate.length === 3) ??
      PUNCTUATORS.find((candidate) => candidate.length === 2 && source.startsWith(candidate, index)) ??
      PUNCTUATORS.find((candidate) => candidate.length === 1 && source.startsWith(candidate, index));

    const start = index;
    const startLine = line;
    const startCol = col();

    if (punct) {
      index += punct.length;
    } else {
      warnings.push({ line: startLine, col: startCol, message: `Karakter tidak dikenal: ${JSON.stringify(char)}` });
      index += 1;
    }

    emit({
      type: "punct",
      value: punct ?? char,
      raw: source.slice(start, index),
      line: startLine,
      col: startCol,
      start,
      end: index,
    });
    atLineStart = false;
  }

  tokens.push({
    type: "eof",
    value: "",
    raw: "",
    line,
    col: col(),
    start: index,
    end: index,
  });

  return { tokens, warnings };
}

/**
 * Tokenize sumber C dan kembalikan daftar token + warning leksikal.
 *
 * @param {string} source
 * @returns {{ tokens: Token[], warnings: LexWarning[] }}
 */
export function tokenize(source) {
  if (typeof source !== "string") {
    throw new TypeError("tokenize() butuh source berupa string.");
  }
  return tokenizeInternal(source);
}


export { PUNCTUATORS };
