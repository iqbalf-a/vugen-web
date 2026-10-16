/**
 * Helper bersama untuk test tokenizer/parser dan generator golden file.
 * Golden file sengaja menyimpan bentuk yang sudah disederhanakan (tanpa `raw`,
 * `start`, `end`) supaya stabil lintas platform (LF vs CRLF).
 *
 * @typedef {object} GoldenToken
 * @property {string} type
 * @property {string} value
 * @property {number} line
 * @property {number} col
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const compilerDir = path.dirname(fileURLToPath(import.meta.url));
export const fixturesDir = path.join(compilerDir, "__fixtures__");

/**
 * Kumpulan file fixture yang ditranspile bersama (urutan = urutan program).
 * Golden JS: `<nama>.js.golden`.
 */
export const TRANSPILE_SETS = {
  "kopra-loadpage": ["kopra-globals.h", "kopra-loadpage.c"],
  "transpile-cases": ["transpile-cases.c"],
};

const OMITTED_KEYS = new Set(["raw", "start", "end", "source", "params", "endLine"]);

/** @returns {string[]} nama fixture tanpa ekstensi, terurut. */
export function fixtureNames() {
  return fs
    .readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".c"))
    .map((name) => name.slice(0, -".c".length))
    .sort();
}

/** @param {string} name */
export function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, `${name}.c`), "utf8");
}

/** @param {string} name nama set di TRANSPILE_SETS */
export function jsGoldenPath(name) {
  return path.join(fixturesDir, `${name}.js.golden`);
}

/**
 * Parse + transpile satu set file fixture.
 *
 * @param {string[]} files nama file di folder fixtures
 * @returns {Promise<ReturnType<import("./transpile.js").transpilePrograms>>}
 */
export async function transpileFixtureFiles(files) {
  const { parse } = await import("./parser.js");
  const { transpilePrograms } = await import("./transpile.js");
  const programs = files.map((file) => ({
    file,
    ast: parse(fs.readFileSync(path.join(fixturesDir, file), "utf8"), { file }),
  }));
  return transpilePrograms(programs);
}

/**
 * @param {import("./tokenizer.js").Token[]} tokens
 * @returns {GoldenToken[]}
 */
export function simplifyTokens(tokens) {
  return tokens.map((token) => ({ type: token.type, value: token.value, line: token.line, col: token.col }));
}

/**
 * Buang field yang tidak stabil/diturunkan, sisakan struktur AST.
 *
 * @param {unknown} node
 * @returns {unknown}
 */
export function simplifyNode(node) {
  if (Array.isArray(node)) return node.map(simplifyNode);
  if (node && typeof node === "object") {
    /** @type {Record<string, unknown>} */
    const result = {};
    for (const [key, value] of Object.entries(node)) {
      if (OMITTED_KEYS.has(key)) continue;
      result[key] = simplifyNode(value);
    }
    return result;
  }
  return node;
}

/**
 * @param {string} name
 * @param {"tokens" | "ast"} kind
 */
export function goldenPath(name, kind) {
  return path.join(fixturesDir, `${name}.${kind}.json`);
}

/**
 * Telusuri semua node AST (objek yang punya properti `type`).
 *
 * @param {unknown} node
 * @param {(node: Record<string, unknown>) => void} visit
 */
export function walkAst(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit);
    return;
  }
  if (!node || typeof node !== "object") return;

  const record = /** @type {Record<string, unknown>} */ (node);
  if (typeof record.type === "string") visit(record);

  for (const value of Object.values(record)) walkAst(value, visit);
}

/**
 * Kumpulkan semua pemanggilan fungsi beserta file/line-nya.
 *
 * @param {unknown} program
 * @returns {Array<{ name: string, file: string, line: number }>}
 */
export function collectCalls(program) {
  /** @type {Array<{ name: string, file: string, line: number }>} */
  const calls = [];

  walkAst(program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = /** @type {Record<string, unknown>} */ (node.callee);
    if (callee && callee.type === "Identifier") {
      calls.push({ name: /** @type {string} */ (callee.name), file: /** @type {string} */ (node.file), line: /** @type {number} */ (node.line) });
    }
  });

  return calls;
}
