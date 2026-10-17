/**
 * Transpiler C -> JS internal (plan §7.2).
 *
 * Aturan yang dipegang:
 * - Setiap statement hasil transpile diawali `__at("Action.c", 45)` supaya
 *   step/error bisa dipetakan balik ke baris C tanpa source map penuh.
 * - Pemanggilan fungsi yang didukung runtime (`runtime/api-names.js`) dibuat
 *   `await __vu.<nama>(...)`; fungsi user -> `await __fn_<nama>(...)`.
 * - Semua ekspresi (termasuk kondisi if/for/while dan inisialisasi variabel)
 *   ditranspile dari AST lewat `expressionToJs`; tidak ada jalur teks mentah.
 * - Statement/fungsi di luar subset -> warning compile + panggilan
 *   `__unsupported*` di runtime yang hanya mencatat warning lalu lanjut
 *   (plan §4.5), tidak pernah crash.
 * - Variabel global (mis. dari globals.h) menjadi `let` level modul.
 * - Makro status LoadRunner (`LR_PASS`, `LR_FAIL`, `LR_AUTO`, `LR_EXIT_*`) bernilai
 *   angka seperti di C; makro argumen web (`LAST`, `ITEMDATA`, ...) tetap string sentinel.
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
 * @typedef {{ names: Set<string>, scopes: Map<string, string>[], warnings: TranspileWarning[] }} Context
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { toPosix } from "../project/paths.js";
import { SUPPORTED_FUNCTION_SET } from "../runtime/api-names.js";
import { parse } from "./parser.js";
import { findReferencedParams } from "./referenced-params.js";

/**
 * Makro VuGen/LoadRunner. Status & opsi exit bernilai angka (sama dengan C);
 * makro argumen web menjadi string sentinel yang dibedakan parser argumen
 * di `vuser-api.js`.
 */
const MACRO_VALUES = {
  LAST: '"LAST"',
  ITEMDATA: '"ITEMDATA"',
  ENDITEM: '"ENDITEM"',
  EXTRARES: '"EXTRARES"',
  SEARCH_FILTERS: '"SEARCH_FILTERS"',
  SOURCES: '"SOURCES"',
  NULL: "null",
  LR_PASS: "0",
  LR_FAIL: "1",
  LR_AUTO: "2",
  LR_STOP: "3",
  LR_EXIT_VUSER: "0",
  LR_EXIT_ACTION_AND_CONTINUE: "1",
  LR_EXIT_ITERATION_AND_CONTINUE: "2",
  LR_EXIT_VUSER_AFTER_ITERATION: "3",
  LR_EXIT_VUSER_AFTER_ACTION: "4",
};

/** Header sistem LoadRunner: `#include`-nya diabaikan tanpa warning. */
const LOADRUNNER_HEADERS = new Set(["lrun.h", "web_api.h", "lrw_custom_body.h", "as_web.h"]);

/**
 * File hasil generate VuGen (bukan sumber script): `pre_cci.c` (keluaran preprocessor),
 * `combined_*.c` (gabungan semua action), dan salinan rekaman di `data/`.
 * Meng-compile-nya hanya menggandakan definisi fungsi.
 */
const GENERATED_FILE_PATTERNS = [/^pre_cci.c$/i, /^combined_.+.c$/i];

/** @param {string} display path relatif POSIX */
function isGeneratedFile(display) {
  return display.toLowerCase().startsWith("data/") || GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(path.posix.basename(display)));
}

/** Kata reserved JS yang sah sebagai identifier C; diberi akhiran `_` agar kode hasil transpile valid. */
const JS_RESERVED = new Set([
  "await", "async", "class", "debugger", "delete", "export", "extends", "false", "finally", "function",
  "import", "in", "instanceof", "let", "new", "null", "of", "super", "this", "true", "try", "typeof",
  "var", "with", "yield", "arguments", "eval", "undefined", "NaN", "Infinity",
]);

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

/** Nama variabel C -> nama variabel JS (hindari kata reserved JS). */
function jsName(name) {
  return JS_RESERVED.has(name) ? `${name}_` : name;
}

/** @param {string[]} lines */
function indent(lines) {
  return lines.map((line) => `${INDENT}${line}`);
}

/** @param {Context} context @param {string} name */
function isDeclared(context, name) {
  return context.scopes.some((scope) => scope.has(name));
}

/** @param {Context} context @param {string} name */
function declare(context, name, type = "") {
  context.scopes.at(-1).set(name, type);
}

/** Fungsi yang menghasilkan step: pernyataan yang memanggilnya menyertakan variabel C yang terlihat (untuk panel Parameter). */
const STEP_FUNCTIONS = new Set(["web_url", "web_custom_request", "web_submit_data", "web_submit_form", "web_rest"]);

/** Apakah subtree AST ini memuat pemanggilan fungsi penghasil step? */
function containsStepCall(node) {
  if (Array.isArray(node)) return node.some(containsStepCall);
  if (!node || typeof node !== "object") return false;
  if (node.type === "CallExpression" && node.callee?.type === "Identifier" && STEP_FUNCTIONS.has(node.callee.name)) return true;
  return Object.values(node).some((value) => value && typeof value === "object" && containsStepCall(value));
}

/** Bagian statement yang dievaluasi di baris itu sendiri (tanpa body statement bersarang, yang punya __at sendiri). */
function ownParts(node) {
  switch (node.type) {
    case "ExpressionStatement":
      return [node.expression];
    case "ReturnStatement":
      return [node.argument];
    case "VariableDeclaration":
      return node.declarations.map((declarator) => declarator.init);
    case "IfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
      return [node.test];
    case "ForStatement":
      return [node.init, node.test, node.update];
    case "SwitchStatement":
      return [node.discriminant];
    default:
      return [];
  }
}

/** Label tipe C untuk tampilan: "int", "char*", "char[256]" */
function typeLabel(dataType, declarator) {
  const base = String(dataType || "").replace(/\s+/g, " ").trim();
  if (declarator.array) return `${base}${declarator.pointer ? "*" : ""}[${declarator.arraySize?.type === "NumberLiteral" ? declarator.arraySize.value : ""}]`;
  return `${base}${declarator.pointer ? "*" : ""}`;
}

/**
 * Pemanggilan `__at(file, line)`. Untuk pernyataan yang memanggil fungsi penghasil step ditambah getter
 * `() => [[nama, nilai, tipe], ...]` berisi variabel C yang terlihat DI BARIS ITU (global + lokal + parameter);
 * runtime memanggilnya saat step dikirim sehingga nilainya adalah nilai pada saat request dijalankan.
 */
function atStatement(node, context) {
  if (!ownParts(node).some(containsStepCall)) return `await __at(${quote(node.file)}, ${node.line});`;

  /** @type {Map<string, string>} */
  const visible = new Map();
  for (const scope of context.scopes) for (const [name, type] of scope) visible.set(name, type);
  const entries = [...visible].map(([name, type]) => `[${quote(name)}, ${jsName(name)}, ${quote(type)}]`);
  return `await __at(${quote(node.file)}, ${node.line}, () => [${entries.join(", ")}]);`;
}

/** @param {Context} context @param {AstNode} node @param {string} message */
function warn(context, node, message) {
  context.warnings.push({ file: node.file, line: node.line, message });
}

/** Panggilan `__unsupportedCall` untuk fungsi/ekspresi di luar subset. */
function unsupportedCall(label, node) {
  return `await __unsupportedCall(${quote(label)}, ${quote(node.file)}, ${node.line})`;
}

/**
 * Sisi kiri assignment / operand ++ --: identifier tidak dikenal tetap ditulis
 * sebagai nama JS (dengan warning), bukan `undefined`, supaya sintaks tetap valid.
 *
 * @param {AstNode} node
 * @param {Context} context
 */
function lvalueToJs(node, context) {
  if (node.type === "Identifier") {
    if (!isDeclared(context, node.name)) {
      warn(context, node, `Variabel "${node.name}" tidak dideklarasikan; assignment dipertahankan apa adanya.`);
    }
    return jsName(node.name);
  }
  return expressionToJs(node, context);
}

/**
 * Terjemahkan pemanggilan fungsi.
 *
 * @param {AstNode} node
 * @param {Context} context
 */
function callToJs(node, context) {
  const name = node.callee?.type === "Identifier" ? node.callee.name : null;
  if (!name) {
    warn(context, node, `Pemanggilan ${node.raw ?? "ekspresi"} belum didukung; dipanggil sebagai unsupported.`);
    return unsupportedCall(node.raw ?? "ekspresi", node);
  }

  const args = node.arguments;

  // Fungsi C yang mengubah buffer argumen pertama -> assignment ke variabel itu.
  if ((name === "strcpy" || name === "sprintf") && args.length >= 2) {
    if (args[0].type === "Identifier" && isDeclared(context, args[0].name)) {
      const target = jsName(args[0].name);
      const rest = args.slice(1).map((argument) => expressionToJs(argument, context));
      if (name === "strcpy") return `(${target} = String(${rest[0]}))`;
      return `(${target} = await __vu.sprintf(${rest.join(", ")}))`;
    }
    warn(context, node, `Fungsi "${name}" dengan tujuan selain variabel sederhana belum didukung; dipanggil sebagai unsupported.`);
    return unsupportedCall(name, node);
  }

  if (SUPPORTED_FUNCTION_SET.has(name)) {
    return `await __vu.${name}(${args.map((argument) => expressionToJs(argument, context)).join(", ")})`;
  }
  if (context.names.has(name)) {
    return `await ${functionIdentifier(name)}(${args.map((argument) => expressionToJs(argument, context)).join(", ")})`;
  }

  warn(context, node, `Fungsi "${name}" belum didukung; dipanggil sebagai unsupported.`);
  return unsupportedCall(name, node);
}

/**
 * Terjemahkan satu ekspresi. Semua pemanggilan fungsi menghasilkan `await`,
 * jadi fungsi pembungkusnya wajib `async`.
 *
 * @param {AstNode} node
 * @param {Context} context
 * @returns {string}
 */
function expressionToJs(node, context) {
  switch (node.type) {
    case "StringLiteral":
      return quote(node.value);

    case "NumberLiteral":
      return numberToJs(node.value);

    case "Identifier": {
      if (Object.hasOwn(MACRO_VALUES, node.name)) return MACRO_VALUES[node.name];
      if (isDeclared(context, node.name)) return jsName(node.name);
      warn(context, node, `Identifier "${node.name}" tidak dikenal; dianggap undefined.`);
      return "undefined";
    }

    case "CallExpression":
      return callToJs(node, context);

    case "CastExpression": {
      const inner = expressionToJs(node.argument, context);
      const target = node.targetType;
      if (target.includes("*") || target === "void") return inner; // cast pointer: nilai apa adanya
      if (/\b(float|double)\b/.test(target)) return `Number(${inner})`;
      return `Math.trunc(${inner})`; // int/long/short/char/unsigned...
    }

    case "UnaryExpression": {
      if (["-", "+", "!", "~"].includes(node.operator)) return `(${node.operator}${expressionToJs(node.argument, context)})`;
      // `&x` / `*p`: tidak ada pointer di JS; operand dipakai apa adanya.
      warn(context, node, `Operator unary "${node.operator}" (pointer) belum didukung; operand dipakai apa adanya.`);
      return expressionToJs(node.argument, context);
    }

    case "AssignmentExpression":
      return `(${lvalueToJs(node.left, context)} ${node.operator} ${expressionToJs(node.right, context)})`;

    case "UpdateExpression": {
      const arg = lvalueToJs(node.argument, context);
      return node.prefix ? `(${node.operator}${arg})` : `(${arg}${node.operator})`;
    }

    case "BinaryExpression":
      return `(${expressionToJs(node.left, context)} ${node.operator} ${expressionToJs(node.right, context)})`;

    case "ConditionalExpression":
      return `(${expressionToJs(node.test, context)} ? ${expressionToJs(node.consequent, context)} : ${expressionToJs(node.alternate, context)})`;

    case "SequenceExpression":
      return `(${node.expressions.map((expression) => expressionToJs(expression, context)).join(", ")})`;

    case "MemberExpression": {
      const object = expressionToJs(node.object, context);
      return node.computed ? `${object}[${expressionToJs(node.property, context)}]` : `${object}.${node.property.name}`;
    }

    default:
      break;
  }

  warn(context, node, `Ekspresi ${node.type} belum didukung; dilewati.`);
  return unsupportedCall(node.raw ?? node.type, node);
}

/** Nilai awal variabel C yang tidak diinisialisasi. */
function defaultValue(dataType, declarator) {
  const isChar = /\bchar\b/.test(dataType);
  if (declarator.array) {
    if (isChar && !declarator.pointer) return '""'; // char buf[N] dipakai sebagai string
    if (declarator.arraySize?.type === "NumberLiteral") return `new Array(${numberToJs(declarator.arraySize.value)}).fill(0)`;
    return "[]";
  }
  if (declarator.pointer) return isChar ? '""' : "null";
  return "0";
}

/**
 * `a = 0, b = 0` (tanpa `let` dan tanpa titik koma). Nama didaftarkan ke scope
 * SETELAH init diterjemahkan (init tidak boleh melihat variabel yang sedang dideklarasikan).
 *
 * @param {AstNode} node VariableDeclaration
 * @param {Context} context
 */
function declaratorsToJs(node, context) {
  return node.declarations
    .map((declarator) => {
      const init = declarator.init ? expressionToJs(declarator.init, context) : defaultValue(node.dataType, declarator);
      declare(context, declarator.name, typeLabel(node.dataType, declarator));
      return `${jsName(declarator.name)} = ${init}`;
    })
    .join(", ");
}

/**
 * Body statement kontrol alur -> baris di dalam `{ }` yang ditulis pemanggil.
 *
 * @param {AstNode} body
 * @param {Context} context
 */
function bodyLines(body, context) {
  context.scopes.push(new Map());
  const lines = body.type === "BlockStatement" ? body.body.flatMap((child) => statementToJs(child, context)) : statementToJs(body, context);
  context.scopes.pop();
  return indent(lines);
}

/**
 * Terjemahkan satu statement menjadi array baris JS (tanpa indentasi dasar).
 * SELALU mengembalikan array.
 *
 * Setiap statement yang menghasilkan kode diawali `__at(file, line)` (plan §7.2)
 * supaya step/log berikutnya bisa dipetakan balik ke baris C.
 *
 * @param {AstNode} node
 * @param {Context} context
 * @returns {string[]}
 */
function statementToJs(node, context) {
  const at = atStatement(node, context);

  switch (node.type) {
    case "Directive":
    case "EmptyStatement":
    case "FunctionPrototype":
      return [];

    case "BlockStatement": {
      context.scopes.push(new Map());
      const lines = node.body.flatMap((child) => statementToJs(child, context));
      context.scopes.pop();
      return ["{", ...indent(lines), "}"];
    }

    case "VariableDeclaration":
      return [at, `let ${declaratorsToJs(node, context)};`];

    case "ExpressionStatement":
      return [at, `${expressionToJs(node.expression, context)};`];

    case "ReturnStatement":
      return [at, node.argument ? `return ${expressionToJs(node.argument, context)};` : "return;"];

    case "IfStatement": {
      const lines = [at, `if (${expressionToJs(node.test, context)}) {`, ...bodyLines(node.consequent, context)];
      if (node.alternate) lines.push("} else {", ...bodyLines(node.alternate, context));
      lines.push("}");
      return lines;
    }

    case "ForStatement": {
      context.scopes.push(new Map()); // variabel di init for hanya hidup di dalam loop
      const init = !node.init ? "" : node.init.type === "VariableDeclaration" ? `let ${declaratorsToJs(node.init, context)}` : expressionToJs(node.init, context);
      const test = node.test ? expressionToJs(node.test, context) : "";
      const update = node.update ? expressionToJs(node.update, context) : "";
      const lines = [at, `for (${init}; ${test}; ${update}) {`, ...bodyLines(node.body, context), "}"];
      context.scopes.pop();
      return lines;
    }

    case "WhileStatement":
      return [at, `while (${expressionToJs(node.test, context)}) {`, ...bodyLines(node.body, context), "}"];

    case "DoWhileStatement":
      return [at, "do {", ...bodyLines(node.body, context), `} while (${expressionToJs(node.test, context)});`];

    case "SwitchStatement": {
      const lines = [at, `switch (${expressionToJs(node.discriminant, context)}) {`];
      context.scopes.push(new Map());
      for (const clause of node.cases) {
        lines.push(...indent([clause.test ? `case ${expressionToJs(clause.test, context)}:` : "default:"]));
        lines.push(...indent(indent(clause.consequent.flatMap((child) => statementToJs(child, context)))));
      }
      context.scopes.pop();
      lines.push("}");
      return lines;
    }

    case "BreakStatement":
      return [at, "break;"];

    case "ContinueStatement":
      return [at, "continue;"];

    default:
      break;
  }

  // Label (goto), struct/typedef, dan statement C lain yang di luar subset.
  const rawValue = node.raw ?? node.type;
  warn(context, node, `Statement ${node.type === "Unsupported" ? "" : `${node.type} `}belum didukung: ${String(rawValue).replace(/\s+/g, " ").slice(0, 80)}`);
  return [at, `await __unsupported(${quote(rawValue)}, ${quote(node.file)}, ${node.line});`];
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
  /** @type {AstNode[]} */
  const globalDeclarations = [];
  /** Scope paling luar: variabel global dari semua file. */
  const globalScope = new Map();

  const seenFunctions = new Map();

  for (const program of programs) {
    /** @type {AstNode[]} */
    const declared = [];

    for (const node of program.ast.body) {
      if (node.type === "FunctionDeclaration") {
        const first = seenFunctions.get(node.name);
        if (first) {
          // Dua definisi menghasilkan SyntaxError di JS; definisi pertama menang.
          warnings.push({
            file: node.file,
            line: node.line,
            message: `Fungsi "${node.name}" didefinisikan lebih dari sekali; definisi di ${first.file}:${first.line} dipakai, yang ini diabaikan.`,
          });
          continue;
        }
        seenFunctions.set(node.name, node);
        names.add(node.name);
        declared.push(node);
        continue;
      }
      if (node.type === "Directive" || node.type === "EmptyStatement" || node.type === "FunctionPrototype") continue;
      if (node.type === "VariableDeclaration") {
        globalDeclarations.push(node);
        continue;
      }

      warnings.push({
        file: node.file,
        line: node.line,
        message: `Statement di luar fungsi diabaikan saat transpile: ${node.type}.`,
      });
    }

    functionsByFile.set(program.file, declared);
  }

  // Variabel global -> `let` level modul. Duplikat nama (mis. header di-include dua kali) dilewati.
  const globalContext = { names, scopes: [globalScope], warnings };
  const globalLines = [];
  for (const node of globalDeclarations) {
    const fresh = node.declarations.filter((declarator) => {
      if (!globalScope.has(declarator.name)) return true;
      warnings.push({ file: node.file, line: node.line, message: `Variabel global "${declarator.name}" dideklarasikan lebih dari sekali; deklarasi pertama dipakai.` });
      return false;
    });
    if (fresh.length === 0) continue;
    globalLines.push(`let ${declaratorsToJs({ ...node, declarations: fresh }, globalContext)};`);
  }

  const lines = [
    "// Hasil transpile otomatis vugen-web dari script VuGen. JANGAN diedit manual.",
    "// Modul ini ditulis ke .cache/<hash>/build/ dan dijalankan runner lewat import().",
    "",
    "let __vu = null;",
    "",
    "export function __bind(vu) {",
    "  __vu = vu;",
    "}",
    "",
    "async function __at(file, line, vars) {",
    "  return __vu.__at(file, line, vars);",
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

  if (globalLines.length > 0) {
    lines.push("// Variabel global (globals.h / deklarasi di luar fungsi).", ...globalLines, "");
  }

  for (const program of programs) {
    for (const node of functionsByFile.get(program.file) ?? []) {
      const params = (node.params || []).map((param) => jsName(param.name));
      lines.push(`export async function ${functionIdentifier(node.name)}(${params.join(", ")}) {`);

      const context = { names, scopes: [globalScope, new Map((node.params || []).map((param) => [param.name, String(param.type || "").replace(/\s+\*/g, "*").trim()]))], warnings };
      const body = node.body.flatMap((statement) => statementToJs(statement, context));
      if (body.length === 0) lines.push(`${INDENT}// (kosong)`);
      else lines.push(...indent(body));
      lines.push("}", "");
    }
  }

  /** @type {Record<string, string>} */
  const entries = {};
  for (const program of programs) {
    const declared = functionsByFile.get(program.file) ?? [];
    if (declared.length === 0) continue;

    if (path.extname(program.file).toLowerCase() !== ".c") continue; // header (globals.h) bukan action

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
 * @returns {Promise<{ modulePath: string, files: string[], warnings: TranspileWarning[], referencedParams: string[], entries: string[], functions: string[] }>}
 */
export async function compileScript({ scriptDir, cacheDir, files }) {
  /** @type {TranspileWarning[]} */
  const warnings = [];
  /** @type {ParsedProgram[]} */
  const programs = [];
  const visited = new Set();
  /** Nama parameter yang dirujuk source script (`{nama}`) */
  const referenced = new Set();

  const queue = files.filter((file) => file.ext === ".c" && !isGeneratedFile(file.path)).map((file) => file.path);

  // globals.h selalu ikut (berisi variabel global & fungsi bersama script KOPRA)
  // (salinan di data/ adalah artefak rekaman, jangan dipakai menggantikan globals.h di root)
  const globalsH = files.find((file) => file.name.toLowerCase() === "globals.h" && !isGeneratedFile(file.path));
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

    findReferencedParams(source, referenced);
    const ast = parse(source, { file: display });
    programs.push({ file: display, ast });

    // Warning tokenizer/parser dikumpulkan di level file.
    for (const warning of ast.warnings) warnings.push(warning);

    for (const node of ast.body) {
      if (node.type !== "Directive") continue;
      const target = includeTarget(node.value);
      if (!target) continue;
      if (LOADRUNNER_HEADERS.has(path.posix.basename(target).toLowerCase())) continue; // header sistem LoadRunner

      const resolved = await resolveInclude(scriptDir, display, target);
      if (resolved && isGeneratedFile(resolved)) continue;
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
    referencedParams: [...referenced],
    entries: result.entries,
    functions: result.functions,
  };
}
export { includeTarget };
