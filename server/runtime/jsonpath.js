/**
 * runtime/jsonpath.js — Evaluator JSONPath subset (tanpa dependency) untuk `web_reg_save_param_json`.
 *
 * Sintaks yang didukung:
 *   $                          akar
 *   .nama                      anak bernama `nama`
 *   ..nama                     turunan bernama `nama` di kedalaman mana pun (pre-order)
 *   [n]                        elemen array ke-n (0-based, tidak negatif)
 *   [*]                        semua elemen array / semua nilai objek
 *   ['nama']                   anak bernama (juga ["nama"]), untuk nama dengan spasi/tanda baca
 *   [?(@.prop==value)]         filter: elemen array/objek di mana properti == value (string/number)
 *   [?(@.prop!="value")]       filter: elemen di mana properti != value
 *
 * Sintaks lain (slice, indeks negatif, `.*`) -> `compileJsonPath` melempar Error.
 */

/** @typedef {{ type: "child", name: string } | { type: "descendant", name: string } | { type: "index", index: number } | { type: "wildcard" } | { type: "filter", property: string, op: string, value: string }} Segment */

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
      } else if (/^\?\(/.test(inner)) {
        // Filter expression: [?(@.property=="value")] or [?(@.property==value)]
        const filterMatch = inner.match(/^\?\(@\.(\w+)\s*(==|!=)\s*(?:"([^"]*)"|'([^']*)'|(\S+?))\s*\)$/);
        if (!filterMatch) {
          throw new Error(`JSONPath: filter [${inner}] tidak didukung; hanya [?(@.prop==value)] di ${JSON.stringify(path)}`);
        }
        const [, property, op, dq, sq, bare] = filterMatch;
        segments.push({ type: "filter", property, op, value: dq ?? sq ?? bare ?? "" });
      } else {
        throw new Error(`JSONPath: isi kurung [${inner}] tidak didukung (hanya [n], [*], ['nama'], [?(...)]) di ${JSON.stringify(path)}`);
      }
      continue;
    }

    throw new Error(`JSONPath: karakter tak terduga "${char}" di posisi ${pos} pada ${JSON.stringify(path)}`);
  }

  return segments;
}

const UNCLOSED_QUOTE = -2;

/** Cari `]` penutup dengan memperhitungkan kutip dan tanda kurung `()` (untuk filter `?(...)` ). */
function findClosingBracket(text, open) {
  let quote = null;
  let depth = 0;
  for (let i = open + 1; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "]" && depth === 0) {
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
        case "filter": {
          const items = Array.isArray(node) ? node : (isContainer(node) ? Object.values(node) : []);
          for (const item of items) {
            if (!isContainer(item)) continue;
            const itemVal = Object.hasOwn(item, segment.property) ? String(item[segment.property]) : undefined;
            if (itemVal === undefined) continue;
            if (segment.op === "==" && itemVal === segment.value) next.push(item);
            else if (segment.op === "!=" && itemVal !== segment.value) next.push(item);
          }
          break;
        }
      }
    }
    current = next;
  }

  return current;
}
