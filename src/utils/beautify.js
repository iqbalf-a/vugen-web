/**
 * src/utils/beautify.js — Simple C indentation normalizer for VuGen scripts.
 *
 * Adjusts indent based on brace depth ({/}) and adds +1 extra level for
 * continuation lines inside open parentheses (multi-line function calls).
 * Collapses consecutive blank lines to one and trims trailing whitespace.
 */

/**
 * Scan C source line from `from` for net {/} and (/  ) delta.
 * Skips string literals and // comments.
 * @returns {{ bracesDelta: number, parensDelta: number }}
 */
function scanDeltas(line, from = 0) {
  let inStr = false;
  let bracesDelta = 0;
  let parensDelta = 0;

  for (let i = from; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "/" && line[i + 1] === "/") break;
    if (ch === "{") bracesDelta++;
    else if (ch === "}") bracesDelta--;
    else if (ch === "(") parensDelta++;
    else if (ch === ")") parensDelta--;
  }

  return { bracesDelta, parensDelta };
}

/**
 * Normalize indentation of a C source file.
 *
 * - Lines inside `{}` blocks: indented by braceDepth × 4 spaces.
 * - Continuation lines (inside open `()`): one extra indent level.
 * - Preprocessor directives (`#...`): always at column 0.
 * - Multiple consecutive blank lines collapsed to one.
 *
 * @param {string} code
 * @returns {string}
 */
export function beautifyC(code) {
  const INDENT = "    "; // 4 spaces
  const lines = code.split(/\r?\n/);
  let braceDepth = 0;
  let parenDepth = 0;
  const out = [];
  let prevWasBlank = false;

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (trimmed === "") {
      if (!prevWasBlank && out.length > 0) out.push("");
      prevWasBlank = true;
      continue;
    }
    prevWasBlank = false;

    // Preprocessor directives are always at column 0
    if (trimmed.startsWith("#")) {
      out.push(trimmed);
      const { bracesDelta, parensDelta } = scanDeltas(trimmed);
      braceDepth = Math.max(0, braceDepth + bracesDelta);
      parenDepth = Math.max(0, parenDepth + parensDelta);
      continue;
    }

    // Leading `}` decrease brace depth before printing the line
    const leadingCloses = (trimmed.match(/^}+/) ?? [""])[0].length;
    for (let i = 0; i < leadingCloses; i++) braceDepth = Math.max(0, braceDepth - 1);

    // Indent = brace depth + 1 if inside open parens
    const totalDepth = braceDepth + (parenDepth > 0 ? 1 : 0);
    out.push(INDENT.repeat(totalDepth) + trimmed);

    // Scan after leading `}` to avoid double-counting them
    const { bracesDelta, parensDelta } = scanDeltas(trimmed, leadingCloses);
    braceDepth = Math.max(0, braceDepth + bracesDelta);
    parenDepth = Math.max(0, parenDepth + parensDelta);
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}
