/**
 * runtime/jsonpath.js — Evaluator JSONPath subset untuk `web_reg_save_param_json`.
 *
 * Sintaks yang didukung:
 *   $                          akar
 *   .nama                      anak bernama `nama`
 *   ..nama                     turunan bernama `nama` di kedalaman mana pun (pre-order)
 *   [n]                        elemen array ke-n (0-based, tidak negatif)
 *   [*]                        semua elemen array / semua nilai objek
 *   ['nama']                   anak bernama (juga ["nama"]), untuk nama dengan spasi/tanda baca
 *   [?(@.prop==value)]         filter: elemen di mana properti cocok
 *   [?(@.a=='x' && @.b!='y')] filter: kondisi AND majemuk
 *   [?(@.prop=~/pattern/)]     filter: regex match
 *   [?(!(@.prop=~/pattern/))]  filter: negated regex match
 *
 * Sintaks lain (slice, indeks negatif, `.*`) -> `compileJsonPath` melempar Error.
 */

/**
 * @typedef {{ property: string, op: "==" | "!=" | "=~", value: string, negate: boolean }} FilterCondition
 * @typedef {{ type: "child", name: string } | { type: "descendant", name: string } | { type: "index", index: number } | { type: "wildcard" } | { type: "filter", conditions: FilterCondition[] }} Segment
 */

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
        const conditions = parseFilterExpr(inner, path);
        segments.push({ type: "filter", conditions });
      } else {
        throw new Error(`JSONPath: isi kurung [${inner}] tidak didukung (hanya [n], [*], ['nama'], [?(...)]) di ${JSON.stringify(path)}`);
      }
      continue;
    }

    throw new Error(`JSONPath: karakter tak terduga "${char}" di posisi ${pos} pada ${JSON.stringify(path)}`);
  }

  return segments;
}

/**
 * Parse [?(...)] filter expression menjadi daftar FilterCondition.
 * Support: ==, !=, =~  dan &&  dan !(...) untuk negasi.
 */
function parseFilterExpr(inner, path) {
  // inner = "?(@.a == 'x' && !(@.b =~ /pat/))"
  const expr = inner.slice(2, -1).trim(); // hapus "?(" dan ")"
  const parts = splitTopLevel(expr, "&&");
  const conditions = [];

  for (const part of parts) {
    const trimmed = part.trim();

    // Negasi: !(@.prop op value)
    const negMatch = trimmed.match(/^!\((.+)\)$/);
    const negate = !!negMatch;
    const condExpr = negate ? negMatch[1].trim() : trimmed;

    // @.property op value
    // op: ==, !=, =~
    // value: 'str', "str", /regex/, bare
    const condMatch = condExpr.match(
      /^@\.(\w+)\s*(==|!=|=~)\s*(?:'([^']*)'|"([^"]*)"|\/([^/]*)\/|(\S+?))$/
    );
    if (!condMatch) {
      throw new Error(`JSONPath: kondisi filter "${condExpr}" tidak didukung di ${JSON.stringify(path)}`);
    }
    const [, property, op, sq, dq, regex, bare] = condMatch;
    const value = sq ?? dq ?? regex ?? bare ?? "";
    conditions.push({ property, op, value, negate });
  }

  return conditions;
}

/** Split string `s` oleh `sep` hanya di level parentheses 0 (tidak dalam kurung). */
function splitTopLevel(s, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(s.slice(start, i).trim());
      i += sep.length - 1;
      start = i + 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts.filter(Boolean);
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

/** Evaluasi satu FilterCondition terhadap item. */
function evalCondition(item, cond) {
  if (!Object.hasOwn(item, cond.property)) return false;
  const str = String(item[cond.property]);
  let match;
  switch (cond.op) {
    case "==": match = str === cond.value; break;
    case "!=": match = str !== cond.value; break;
    case "=~": {
      try { match = new RegExp(cond.value).test(str); } catch { match = false; }
      break;
    }
    default: match = false;
  }
  return cond.negate ? !match : match;
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
            if (segment.conditions.every((c) => evalCondition(item, c))) next.push(item);
          }
          break;
        }
      }
    }
    current = next;
  }

  return current;
}
