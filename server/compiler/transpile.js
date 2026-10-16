/**
 * Transpiler C -> JS internal (plan §7.2).
 *
 * Aturan yang dipegang:
 * - Setiap statement hasil transpile diawali `__vu.__at("Action.c", 45)` supaya
 *   step/error bisa dipetakan balik ke baris C tanpa source map penuh.
 * - Pemanggilan `web_*` / `lr_*` yang didukung dibuat `await`.
 * - Statement di luar subset -> `await __vu.__unsupported("<teks asli>", ...)`;
 *   runtime mencatat warning lalu lanjut (plan §4.5), tidak pernah crash.
 * - Substitusi `{param}` TIDAK dilakukan di sini, melainkan di runtime
 *   (plan §7.2) karena nilai param bisa berubah (correlation).
 *
 * Fungsi yang dihasilkan memakai variabel modul `__vu` (di-bind lewat
 * `__bind(vu)`) supaya tidak perlu membawa parameter ke tiap fungsi hasil
 * transpile, dan tetap bisa dipanggil antar file (Action General memanggil
 * fungsi dari file .c lain).
 *
 * Hasil transpile ditulis ke `.cache/<hash>/build/script.js` (plan §4.2) lalu
 * dijalankan runner lewat `import()` + `pathToFileURL` (plan §3).
 *
 * @typedef {import("./parser.js").AstNode} AstNode
 * @typedef {{ file: string, line: number, message: string }} TranspileWarning
 * @typedef {{ file: string, ast: import("./parser.js").Program }} ParsedProgram
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { toPosix } from "../project/paths.js";
import { parse } from "./parser.js";

/** Fungsi tahap inti yang didukung (plan §7.1). Urutan hanya untuk dokumentasi. */
export const CORE_FUNCTIONS = Object.freeze([
  "web_url",
  "web_custom_request",
  "web_rest",
  "web_submit_data",
  "web_submit_form",
  "lr_start_transaction",
  "lr_end_transaction",
  "lr_set_transaction",
  "lr_get_transaction_status",
  "lr_think_time",
  "lr_save_string",
  "lr_eval_string",
  "lr_output_message",
  "lr_error_message",
  "web_add_header",
  "web_add_auto_header",
  "web_reg_save_param",
  "web_reg_save_param_ex",
  "web_reg_save_param_regexp",
  "web_reg_find",
  "web_add_cookie",
  "web_cleanup_cookies",
  "web_set_user",
  "strcmp",
  "strstr",
  "sprintf",
  "atoi",
  "strcpy",
]);

const CORE_FUNCTION_SET = new Set(CORE_FUNCTIONS);

/**
 * Makro VuGen yang dikenal tokenizer. Nilainya diterjemahkan langsung saat
 * transpile menjadi string sentinel — persis seperti yang diterima VuGen di
 * runtime, sehingga parser argumen di `vuser-api.js` bisa membedakannya.
 */
const MACRO_VALUES = {
  LAST: '"LAST"',
  ITEMDATA: '"ITEMDATA"',
  ENDITEM: '"ENDITEM"',
  EXTRARES: '"EXTRARES"',
  SEARCH_FILTERS: '"SEARCH_FILTERS"',
  SOURCES: '"SOURCES"',
  LR_AUTO: '"LR_AUTO"',
  LR_PASS: '"LR_PASS"',
  LR_FAIL: '"LR_FAIL"',
  LR_EXIT_ITERATION_AND_CONTINUE: '"LR_EXIT_ITERATION_AND_CONTINUE"',
  LR_EXIT_ITERATION: '"LR_EXIT_ITERATION"',
  NULL: "null",
};

const INDENT = "  ";

function quote(value) {
  return JSON.stringify(String(value));
}

function numberToJs(value) {
  return Number.isFinite(value) ? String(value) : "0";
}

/** Identifier JS aman untuk nama fungsi C (`__fn_<nama>`). */
function functionIdentifier(name) {
  return `__fn_${name}`;
}

/**
 * Terjemahkan satu ekspresi. Semua pemanggilan fungsi menghasilkan `await`,
 * jadi fungsi pembungkusnya wajib `async`.
 *
 * @param {AstNode} node
 * @param {{ names: Set<string>, warnings: TranspileWarning[] }} context
 * @returns {string}
 */
function expressionToJs(node, context) {
  switch (node.type) {
    case "StringLiteral":
      return quote(node.value);

    case "NumberLiteral":
      return numberToJs(node.value);

    case "Identifier": {
      if (Object.hasOwn(MACRO_VALUES, node.name)) {
        return MACRO_VALUES[node.name];
      }
      context.warnings.push({
        file: node.file,
        line: node.line,
        message: `Variabel "${node.name}" belum didukung pada tahap ini; dipakai sebagai identifier JS.`,
      });
      return node.name;
    }

    case "CallExpression": {
      const name = node.callee?.type === "Identifier" ? node.callee.name : null;
      const args = node.arguments.map((argument) => expressionToJs(argument, context)).join(", ");

      if (name && CORE_FUNCTION_SET.has(name)) return `await __vu.${name}(${args})`;
      if (name && context.names.has(name)) return `await ${functionIdentifier(name)}(${args})`;

      const label = name ?? node.raw ?? "ekspresi";
      context.warnings.push({
        file: node.file,
        line: node.line,
        message: `Fungsi "${name ?? label}" belum didukung pada tahap ini; dipanggil sebagai unsupported.`,
      });
      return `await __unsupportedCall(${quote(label)}, ${quote(node.file)}, ${node.line})`;
    }

    case "UnaryExpression": {
      if (["-", "+", "!"].includes(node.operator)) {
        return `(${node.operator === "!" ? "!" : node.operator}${expressionToJs(node.argument, context)})`;
      }
      break;
    }

    case "AssignmentExpression": {
      const left = expressionToJs(node.left, context);
      const right = expressionToJs(node.right, context);
      return `(${left} ${node.operator} ${right})`;
    }

    case "UpdateExpression": {
      const arg = expressionToJs(node.argument, context);
      const op = node.operator;
      if (node.prefix) return `(${op}${arg})`;
      return `(${arg}${op})`;
    }

    case "BinaryExpression": {
      const left = expressionToJs(node.left, context);
      const right = expressionToJs(node.right, context);
      return `(${left} ${node.operator} ${right})`;
    }

    case "ConditionalExpression": {
      const test = expressionToJs(node.test, context);
      const consequent = expressionToJs(node.consequent, context);
      const alternate = expressionToJs(node.alternate, context);
      return `(${test} ? ${consequent} : ${alternate})`;
    }

    case "SequenceExpression": {
      return node.expressions.map((e) => expressionToJs(e, context)).join(", ");
    }

    case "MemberExpression": {
      const obj = expressionToJs(node.object, context);
      const prop = node.computed ? `[${expressionToJs(node.property, context)}]` : `.${node.property.name}`;
      return `${obj}${prop}`;
    }

    default:
      break;
  }

  context.warnings.push({
    file: node.file,
    line: node.line,
    message: `Ekspresi ${node.type} belum didukung pada tahap ini; dilewati.`,
  });
  return `await __unsupportedCall(${quote(node.raw ?? node.type)}, ${quote(node.file)}, ${node.line})`;
}

/**
 * Terjemahkan satu statement menjadi array baris JS (sudah termasuk indentasi).
 *
 * Setiap statement yang menghasilkan kode diawali `__at(file, line)` (plan §7.2)
 * supaya step/log berikutnya bisa dipetakan balik ke baris C.
 *
 * @param {AstNode} node
 * @param {{ names: Set<string>, warnings: TranspileWarning[] }} context
 * @returns {string[]}
 */
function statementToJs(node, context) {
  const pad = INDENT;
  const at = `${pad}__at(${quote(node.file)}, ${node.line});`;

  function replaceCoreFunctions(raw) {
    let result = raw;
      // Function names are handled by the parser in expressionToJs
      // for (const func of CORE_FUNCTIONS) {
      //       const regex = new RegExp(`\\b${func}\\s*\\(`, "g");
      //       result = result.replace(regex, `__vu.${func}(`);
      // }
      // Also replace VuGen macro identifiers (LR_FAIL, LR_AUTO, etc.)
    for (const [macro, value] of Object.entries(MACRO_VALUES)) {
      const regex = new RegExp(`\\b${macro}\\b`, "g");
      result = result.replace(regex, value);
    }
    return result;
  }

  switch (node.type) {
    case "Directive":
    case "EmptyStatement":
      return [];

    case "BlockStatement":
      return node.body.flatMap((child) => statementToJs(child, context));

    case "ExpressionStatement":
      return [at, `${pad}${expressionToJs(node.expression, context)};`];

    case "ReturnStatement": {
      const lines = [at];
      if (node.argument) lines.push(`${pad}${expressionToJs(node.argument, context)};`);
      lines.push(`${pad}return;`);
      return lines;
    }

    case "IfStatement": {
      const lines = [at];
      const cond = node.header?.raw ? `(${replaceCoreFunctions(node.header.raw)})` : "true";
      lines.push(`${pad}if ${cond} {`);
      const consequent = node.consequent.flatMap ? node.consequent.flatMap((s) => statementToJs(s, context)) : statementToJs(node.consequent, context);
      lines.push(...consequent.map(l => `${pad}  ${l.replace(/^ {2}/, "")}`));
      lines.push(`${pad}}`);
      if (node.alternate) {
        lines.push(`${pad}else {`);
        const alternate = node.alternate.flatMap ? node.alternate.flatMap((s) => statementToJs(s, context)) : statementToJs(node.alternate, context);
        lines.push(...alternate.map(l => `${pad}  ${l.replace(/^ {2}/, "")}`));
        lines.push(`${pad}}`);
      }
      return lines;
    }

    case "ForStatement": {
      const lines = [at];
      let header = node.header?.raw ? node.header.raw.trim() : "; ;";
      if (header.startsWith("(") && header.endsWith(")")) {
        header = header.slice(1, -1).trim();
      }
      header = replaceCoreFunctions(header);
      lines.push(`${pad}for (${header}) {`);
      const body = node.body.flatMap ? node.body.flatMap((s) => statementToJs(s, context)) : statementToJs(node.body, context);
      lines.push(...body.map(l => `${pad}  ${l.replace(/^ {2}/, "")}`));
      lines.push(`${pad}}`);
      return lines;
    }

    case "WhileStatement": {
      const lines = [at];
      const cond = node.header?.raw ? `(${replaceCoreFunctions(node.header.raw)})` : "true";
      lines.push(`${pad}while ${cond} {`);
      const body = node.body.flatMap ? node.body.flatMap((s) => statementToJs(s, context)) : statementToJs(node.body, context);
      lines.push(...body.map(l => `${pad}  ${l.replace(/^ {2}/, "")}`));
      lines.push(`${pad}}`);
      return lines;
    }

    case "DoWhileStatement": {
      const lines = [at];
      const cond = node.header?.raw ? `(${replaceCoreFunctions(node.header.raw)})` : "true";
      lines.push(`${pad}do {`);
      const body = node.body.flatMap ? node.body.flatMap((s) => statementToJs(s, context)) : statementToJs(node.body, context);
      lines.push(...body.map(l => `${pad}  ${l.replace(/^ {2}/, "")}`));
      lines.push(`${pad}} while ${cond};`);
      return lines;
    }

    case "BreakStatement":
      return [at, `${pad}break;`];

    case "ContinueStatement":
      return [at, `${pad}continue;`];

    case "LabeledStatement": {
      const label = node.label;
      const lines = [at];
      lines.push(`${pad}${label}: {`);
      const body = node.body.flatMap ? node.body.flatMap((s) => statementToJs(s, context)) : statementToJs(node.body, context);
      lines.push(...body.map(l => `${pad}  ${l.replace(/^ {2}/, "")}`));
      lines.push(`${pad}}`);
      return lines;
    }

    default:
      break;
  }

  // Handle Unsupported statements that are actually variable declarations
  // e.g., "int i;", "int user_count = 3;", "char buf[256];"
  if (node.type === "Unsupported" && node.raw) {
    const rawText = node.raw.trim();
    // Match simple variable declarations: type name [= value];
    // Also handles array declarations: char buf[256];
    const declMatch = /^(int|char|short|long|float|double)\s+(\w+)(?:\[\s*\d+\s*\])?(?:\s*=\s*([^;]+))?\s*;?\s*$/i.exec(rawText);
    if (declMatch) {
      const type = declMatch[1].toLowerCase();
      const name = declMatch[2];
      const init = declMatch[3];
      let jsType = "let";
      let defaultValue = "";
      if (type === "char" && !init) defaultValue = '""';
      else if (!init) defaultValue = "0";
      if (init) {
        // Transpile the init expression: replace known function calls with __vu. calls
        let initJs = init;
      // Function names are handled by the parser in expressionToJs
      // for (const func of CORE_FUNCTIONS) {
      //           const regex = new RegExp(`\\b${func}\\s*\\(`, "g");
      //           initJs = initJs.replace(regex, `__vu.${func}(`);
      // }
        return [at, `${pad}${jsType} ${name} = ${initJs};`];
      } else {
        return [at, `${pad}${jsType} ${name} = ${defaultValue};`];
      }
    }

  // Control flow (if/for/while/do), break/continue, label, statement C yang
  // belum didukung, dan sisa tipe lain -> lewati dengan warning runtime.
  const rawValue = node.raw ?? node.type;
  return [at, `${pad}await __unsupported(${quote(rawValue)}, ${quote(node.file)}, ${node.line});`];
}
}

/**
 * Transpile sekumpulan AST (semua file `.c`/`.h` dalam satu folder script)
 * menjadi satu modul JS.
 *
 * @param {ParsedProgram[]} programs
 * @returns {{ code: string, warnings: TranspileWarning[], functions: string[], entries: string[] }}
 */
export function transpilePrograms(programs) {
  /** @type {TranspileWarning[]} */
  const warnings = [];
  /** @type {Set<string>} */
  const names = new Set();
  /** @type {Map<string, AstNode[]>} */
  const functionsByFile = new Map();

  const seenFunctions = new Map();

  for (const program of programs) {
    /** @type {AstNode[]} */
    const declared = [];

    for (const node of program.ast.body) {
      if (node.type === "FunctionDeclaration") {
        if (seenFunctions.has(node.name)) {
          warnings.push({
            file: node.file,
            line: node.line,
            message: `Fungsi "${node.name}" didefinisikan lebih dari sekali; definisi di ${node.file}:${node.line} dipakai.`,
          });
        }
        seenFunctions.set(node.name, node);
        names.add(node.name);
        declared.push(node);
        continue;
      }
      if (node.type === "Directive" || node.type === "EmptyStatement") continue;

      warnings.push({
        file: node.file,
        line: node.line,
        message: `Statement di luar fungsi diabaikan saat transpile: ${node.type}.`,
      });
    }

    functionsByFile.set(program.file, declared);
  }

  const lines = [
    "// Hasil transpile otomatis vugen-web dari script VuGen. JANGAN diedit manual.",
    "// Modul ini ditulis ke .cache/<hash>/build/ dan dijalankan runner lewat import().",
    "",
    "let __vu = null;",
    "let startTime = 0; // Global timer handle (from globals.h)",
    "",
    "export function __bind(vu) {",
    "  __vu = vu;",
    "}",
    "",
    "function __at(file, line) {",
    "  __vu.__at(file, line);",
    "}",
    "",
    "function __unsupported(raw, file, line) {",
    "  return __vu.__unsupported(raw, file, line);",
    "}",
    "",
    "function __unsupportedCall(name, file, line) {",
    "  return __vu.__unsupportedCall(name, file, line);",
    "}",
    "",
  ];

  for (const program of programs) {
    for (const node of functionsByFile.get(program.file) ?? []) {
      const params = (node.params || []).map(p => p.name).join(", ");
      lines.push(`export async function ${functionIdentifier(node.name)}(${params}) {`);
      const body = node.body.flatMap((statement) => statementToJs(statement, { names, warnings }));
      if (body.length === 0) lines.push(`${INDENT}// (kosong)`);
      else lines.push(...body);
      lines.push("}", "");
    }
  }

  /** @type {Record<string, string>} */
  const entries = {};
  for (const program of programs) {
    const declared = functionsByFile.get(program.file) ?? [];
    if (declared.length === 0) continue;

    const base = path.basename(program.file, path.extname(program.file));
    const match = declared.find((node) => node.name === base) ?? (declared.length === 1 ? declared[0] : null);
    if (!match) continue;

    entries[base] = functionIdentifier(match.name);
  }

  lines.push("/** Nama action (basename file .c) -> fungsi hasil transpile. */");
  lines.push("export const __entries = {");
  for (const [key, value] of Object.entries(entries)) lines.push(`${INDENT}${quote(key)}: ${value},`);
  lines.push("};", "");

  return {
    code: lines.join("\n"),
    warnings,
    functions: [...names],
    entries: Object.keys(entries),
  };
}

/**
 * Cari file `#include "x"` relatif ke folder script (plan §6).
 *
 * @param {string} scriptDir
 * @param {string} fromFile
 * @param {string} target
 */
async function resolveInclude(scriptDir, fromFile, target) {
  const candidates = [path.resolve(scriptDir, target), path.resolve(scriptDir, path.dirname(fromFile), target)];

  for (const candidate of candidates) {
    const relative = path.relative(scriptDir, candidate);
    if (relative.startsWith("..") || path.isAbsolute(target)) continue;
    try {
      const stats = await fs.stat(candidate);
      if (!stats.isFile()) continue;
      return toPosix(relative);
    } catch {
      // coba kandidat berikutnya
    }
  }
  return null;
}

/** Ambil target `#include` dari teks direktif, atau null. */
function includeTarget(directiveValue) {
  const match = /^include\s*["<]([^">]+)[">]/.exec(String(directiveValue).trim());
  return match ? match[1] : null;
}

/**
 * Baca + parse semua file `.c` (beserta `#include` transitif), lalu tulis modul
 * JS hasil transpile ke `<cacheDir>/build/script.js`.
 *
 * @param {{ scriptDir: string, cacheDir: string, files: Array<{ path: string, ext: string }> }} input
 * @returns {Promise<{ modulePath: string, files: string[], warnings: TranspileWarning[], entries: string[], functions: string[] }>}
 */
export async function compileScript({ scriptDir, cacheDir, files }) {
  /** @type {TranspileWarning[]} */
  const warnings = [];
  /** @type {ParsedProgram[]} */
  const programs = [];
  const visited = new Set();

  const queue = files.filter((file) => file.ext === ".c").map((file) => file.path);

  // Always include globals.h if it exists (contains global vars like startTime, compareDuration)
  const globalsH = files.find((file) => file.name.toLowerCase() === "globals.h");
  if (globalsH) queue.push(globalsH.path);

  while (queue.length > 0) {
    const display = queue.shift();
    const key = display.toLowerCase();
    if (visited.has(key)) continue;
    visited.add(key);

    let source;
    try {
      source = await fs.readFile(path.join(scriptDir, ...display.split("/")), "utf8");
    } catch (error) {
      warnings.push({ file: display, line: 1, message: `Gagal membaca file: ${error.message}` });
      continue;
    }

    const ast = parse(source, { file: display });
    programs.push({ file: display, ast });

    // Warning tokenizer/parser dikumpulkan di level file.
    for (const warning of ast.warnings) warnings.push(warning);

    for (const node of ast.body) {
      if (node.type !== "Directive") continue;
      const target = includeTarget(node.value);
      if (!target) continue;

      const resolved = await resolveInclude(scriptDir, display, target);
      if (resolved) queue.push(resolved);
      else warnings.push({ file: display, line: node.line, message: `#include tidak ditemukan: ${target}` });
    }
  }

  const result = transpilePrograms(programs);

  const buildDir = path.join(cacheDir, "build");
  await fs.mkdir(buildDir, { recursive: true });
  const modulePath = path.join(buildDir, "script.js");
  await fs.writeFile(modulePath, result.code, "utf8");

  return {
    modulePath,
    files: programs.map((program) => program.file),
    warnings: [...warnings, ...result.warnings],
    entries: result.entries,
    functions: result.functions,
  };
}
export { includeTarget };