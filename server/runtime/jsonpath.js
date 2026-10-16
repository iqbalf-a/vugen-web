/**
 * runtime/jsonpath.js — Evaluator JSONPath subset (tanpa dependency) untuk `web_reg_save_param_json`.
 *
 * Sintaks yang didukung:
 *   $              akar
 *   .nama          anak bernama `nama`
 *   ..nama         turunan bernama `nama` di kedalaman mana pun (pre-order: node ini dulu, baru anaknya)
 *   [n]            elemen array ke-n (0-based, tidak negatif)
 *   [*]            semua elemen array / semua nilai objek
 *   ['nama']       anak bernama (juga ["nama"]), untuk nama dengan spasi/tanda baca
 *
 * Sintaks lain (filter `?()`, slice, indeks negatif, `.*`) -> `compileJsonPath` melempar Error
 * dengan pesan yang menyebut bagian yang tidak didukung.
 */

/** @typedef {{ type: "child", name: string } | { type: "descendant", name: string } | { type: "index", index: number } | { type: "wildcard" }} Segment */

/**
 * @param {string} path
 * @returns {Segment[]}
 */
export function compileJsonPath(path) {
  const text = String(path ?? "").trim();
  if (!text.startsWith("$")) throw new Error(`JSONPath harus diawali "$": ${JSON.stringify(path)}`);

  /** @type {Segment[]} */
  const segments = [];
  let pos = 1;

  const readName = () => {
    const start = pos;
    while (pos < text.length && !/[.[\]\s]/.test(text[pos])) pos += 1;
    const name = text.slice(start, pos);
    if (name === "") throw new Error(`JSONPath: nama properti hilang setelah posisi ${start} di ${JSON.stringify(path)}`);
    if (name === "*") throw new Error(`JSONPath: ".*" tidak didukung; pakai "[*]" di ${JSON.stringify(path)}`);
    return name;
  };

  while (pos < text.length) {
    const char = text[pos];

    if (char === ".") {
      if (text[pos + 1] === ".") {
        pos += 2;
        segments.push({ type: "descendant", name: readName() });
      } else {
        pos += 1;
        segments.push({ type: "child", name: readName() });
      }
      continue;
    }

    if (char === "[") {
      const close = findClosingBracket(text, pos);
      if (close === UNCLOSED_QUOTE) throw new Error(`JSONPath: tanda kutip tidak ditutup di ${JSON.stringify(path)}`);
      if (close < 0) throw new Error(`JSONPath: tanda "]" tidak ditemukan di ${JSON.stringify(path)}`);
      const inner = text.slice(pos + 1, close).trim();
      pos = close + 1;

      if (inner === "*") {
        segments.push({ type: "wildcard" });
      } else if (/^\d+$/.test(inner)) {
        segments.push({ type: "index", index: Number(inner) });
      } else if (/^(['"]).*\1$/s.test(inner) && inner.length >= 2) {
        segments.push({ type: "child", name: inner.slice(1, -1) });
      } else {
        throw new Error(`JSONPath: isi kurung [${inner}] tidak didukung (hanya [n], [*], ['nama']) di ${JSON.stringify(path)}`);
      }
      continue;
    }

    throw new Error(`JSONPath: karakter tak terduga "${char}" di posisi ${pos} pada ${JSON.stringify(path)}`);
  }

  return segments;
}

const UNCLOSED_QUOTE = -2;

/** Cari `]` penutup dengan memperhitungkan kutip (nama boleh berisi `]`). -1: tidak ada; -2: kutip tidak ditutup. */
function findClosingBracket(text, open) {
  let quote = null;
  for (let i = open + 1; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "]") {
      return i;
    }
  }
  return quote ? UNCLOSED_QUOTE : -1;
}

const isContainer = (value) => value !== null && typeof value === "object";

/** Semua turunan bernama `name` di bawah `node` (node sendiri termasuk sebagai induk), pre-order. */
function scan(node, name, out) {
  if (Array.isArray(node)) {
    for (const element of node) scan(element, name, out);
    return;
  }
  if (!isContainer(node)) return;
  if (Object.hasOwn(node, name)) out.push(node[name]);
  for (const child of Object.values(node)) scan(child, name, out);
}

/**
 * @param {unknown} root
 * @param {Segment[]} segments hasil `compileJsonPath`
 * @returns {unknown[]} semua nilai yang cocok (urutan dokumen)
 */
export function queryJsonPath(root, segments) {
  /** @type {unknown[]} */
  let current = [root];

  for (const segment of segments) {
    /** @type {unknown[]} */
    const next = [];
    for (const node of current) {
      switch (segment.type) {
        case "child":
          if (isContainer(node) && !Array.isArray(node) && Object.hasOwn(node, segment.name)) next.push(node[segment.name]);
          break;
        case "index":
          if (Array.isArray(node) && segment.index < node.length) next.push(node[segment.index]);
          break;
        case "wildcard":
          if (Array.isArray(node)) next.push(...node);
          else if (isContainer(node)) next.push(...Object.values(node));
          break;
        case "descendant":
          scan(node, segment.name, next);
          break;
      }
    }
    current = next;
  }

  return current;
}
