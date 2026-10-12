/**
 * Parser subset C untuk script VuGen: token -> AST.
 *
 * Prinsip (plan §11): toleran. Apa pun yang tidak bisa diparse menjadi node
 * `Unsupported` (dengan teks asli) alih-alih melempar error, supaya satu
 * statement aneh tidak membatalkan seluruh script.
 *
 * Setiap node menyimpan `file` dan `line` aslinya sehingga pesan error/step
 * bisa dipetakan balik ke baris C (plan §7.2).
 *
 * Control-flow (`if`/`for`/`while`/`do`) untuk sementara menyimpan headernya
 * sebagai teks mentah (`header.raw`); body-nya tetap diparse rekursif sehingga
 * setiap pemanggilan fungsi di dalam body punya baris yang benar.
 *
 * @typedef {import("./tokenizer.js").Token} Token
 *
 * @typedef {object} AstNode
 * @property {string} type
 * @property {string} file
 * @property {number} line
 *
 * @typedef {object} ParseWarning
 * @property {string} file
 * @property {number} line
 * @property {string} message
 */

import { tokenize } from "./tokenizer.js";

/** Keyword C yang tidak boleh dianggap nama fungsi. */
const KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "default",
  "return",
  "break",
  "continue",
  "goto",
  "sizeof",
  "struct",
  "union",
  "enum",
  "typedef",
  "void",
  "int",
  "char",
  "short",
  "long",
  "float",
  "double",
  "signed",
  "unsigned",
  "const",
  "static",
  "register",
  "extern",
  "volatile",
  "auto",
]);

const TYPE_KEYWORDS = new Set([
  "int",
  "char",
  "short",
  "long",
  "float",
  "double",
  "signed",
  "unsigned",
  "void",
  "struct",
  "union",
  "enum",
  "typedef",
  "static",
  "const",
  "register",
  "extern",
  "volatile",
  "auto",
]);

/** Precedence operator biner (makin besar makin kuat). */
const BINARY_PRECEDENCE = {
  "||": 1,
  "&&": 2,
  "|": 3,
  "^": 4,
  "&": 5,
  "==": 6,
  "!=": 6,
  "<": 7,
  ">": 7,
  "<=": 7,
  ">=": 7,
  "<<": 8,
  ">>": 8,
  "+": 9,
  "-": 9,
  "*": 10,
  "/": 10,
  "%": 10,
};

const ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "^="]);
const UNARY_OPERATORS = new Set(["-", "+", "!", "~", "&", "*"]);
const UNSUPPORTED_STATEMENT_STARTERS = new Set(["switch", "goto", "case", "default", "try", "throw"]);

function toNumber(text) {
  if (/^0[xX]/.test(text)) return Number.parseInt(text, 16);
  if (/^0[bB]/.test(text)) return Number.parseInt(text.slice(2), 2);
  return Number.parseFloat(text);
}

/**
 * @param {string} source
 * @param {{ file?: string }} [options]
 * @returns {{ type: "Program", file: string, body: AstNode[], warnings: ParseWarning[], source: string }}
 */
export function parse(source, { file = "script.c" } = {}) {
  const { tokens, warnings } = tokenize(source);
  const parser = new Parser(tokens, source, file);
  const body = parser.parseProgram();

  return {
    type: "Program",
    file,
    body,
    warnings: [...warnings.map((warning) => ({ file, line: warning.line, message: warning.message })), ...parser.warnings],
    source,
  };
}

class Parser {
  constructor(tokens, source, file) {
    this.tokens = tokens;
    this.source = source;
    this.file = file;
    this.pos = 0;
    /** @type {ParseWarning[]} */
    this.warnings = [];
  }

  // --- helper token -----------------------------------------------------

  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  next() {
    const token = this.peek();
    if (token.type !== "eof") this.pos += 1;
    return token;
  }

  atEnd() {
    return this.peek().type === "eof";
  }

  checkValue(value) {
    return this.peek().value === value;
  }

  eatValue(value) {
    if (!this.checkValue(value)) return false;
    this.next();
    return true;
  }

  endOffset() {
    const previous = this.tokens[this.pos - 1];
    return previous ? previous.end : 0;
  }

  warn(token, message) {
    this.warnings.push({ file: this.file, line: token.line, message });
  }

  // --- program & deklarasi ---------------------------------------------

  parseProgram() {
    /** @type {AstNode[]} */
    const body = [];

    while (!this.atEnd()) {
      const before = this.pos;
      body.push(this.parseTopLevel());
      if (this.pos === before) {
        const token = this.next();
        this.warn(token, `Token tidak terduga: ${token.raw}`);
        body.push({ type: "Unsupported", raw: token.raw, file: this.file, line: token.line });
      }
    }

    return body;
  }

  parseTopLevel() {
    const token = this.peek();

    if (token.type === "directive") {
      this.next();
      return { type: "Directive", value: token.value, raw: token.raw, file: this.file, line: token.line };
    }

    const nameIndex = this.findFunctionNameIndex();
    if (nameIndex !== -1) {
      const nameToken = this.tokens[nameIndex];
      const startToken = this.peek();

      this.pos = nameIndex + 1;
      this.skipBalanced("(", ")");
      const block = this.parseBlock();

      return {
        type: "FunctionDeclaration",
        name: nameToken.value,
        params: [],
        body: block.body,
        raw: this.source.slice(startToken.start, this.endOffset()),
        file: this.file,
        line: nameToken.line,
        endLine: block.endLine,
      };
    }

    return this.parseStatement();
  }

  /**
   * Cari indeks token nama fungsi bila statement saat ini berupa definisi fungsi
   * (`nama(...) {`). Kembalikan -1 bila bukan.
   */
  findFunctionNameIndex() {
    let depth = 0;
    let candidate = -1;

    for (let i = this.pos; i < this.tokens.length; i += 1) {
      const token = this.tokens[i];
      if (token.type === "eof" || token.type === "directive") return -1;

      if (token.value === "(") {
        if (depth === 0) {
          const previous = this.tokens[i - 1];
          if (previous && previous.type === "identifier" && !KEYWORDS.has(previous.value)) {
            candidate = i - 1;
          } else {
            return -1;
          }
        }
        depth += 1;
        continue;
      }
      if (token.value === ")") {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth > 0) continue;

      if (token.value === "{") return candidate;
      if ([";", "}", "=", ",", ":"].includes(token.value)) return -1;
    }

    return -1;
  }

  skipBalanced(open, close) {
    if (!this.checkValue(open)) {
      this.warn(this.peek(), `Tanda ${open} tidak ditemukan.`);
      return;
    }
    let depth = 0;
    while (!this.atEnd()) {
      const token = this.next();
      if (token.value === open) depth += 1;
      else if (token.value === close) {
        depth -= 1;
        if (depth === 0) return;
      }
    }
    this.warn(this.peek(), `Tanda ${close} tidak ditemukan.`);
  }

  // --- statement --------------------------------------------------------

  parseStatement() {
    const token = this.peek();

    if (token.type === "directive") {
      this.next();
      return { type: "Directive", value: token.value, raw: token.raw, file: this.file, line: token.line };
    }
    if (token.type === "eof") {
      return { type: "EmptyStatement", raw: "", file: this.file, line: token.line };
    }

    if (token.value === ";") {
      this.next();
      return { type: "EmptyStatement", raw: ";", file: this.file, line: token.line };
    }
    if (token.value === "{") return this.parseBlock();
    if (token.value === "if") return this.parseIf();
    if (token.value === "for") return this.parseFor();
    if (token.value === "while") return this.parseWhile();
    if (token.value === "do") return this.parseDoWhile();
    if (token.value === "return") return this.parseReturn();
    if (token.value === "break" || token.value === "continue") {
      this.next();
      this.eatValue(";");
      return { type: token.value === "break" ? "BreakStatement" : "ContinueStatement", raw: `${token.value};`, file: this.file, line: token.line };
    }
    if (UNSUPPORTED_STATEMENT_STARTERS.has(token.value)) return this.parseUnsupportedStatement();
    if (token.type === "identifier" && TYPE_KEYWORDS.has(token.value)) return this.parseUnsupportedStatement();
    if (token.type === "identifier" && this.peek(1).value === ":") {
      this.next();
      this.next();
      return { type: "LabeledStatement", label: token.value, raw: `${token.value}:`, file: this.file, line: token.line };
    }

    return this.parseExpressionStatement();
  }

  parseBlock() {
    const open = this.next();
    /** @type {AstNode[]} */
    const body = [];

    while (!this.atEnd() && this.peek().value !== "}") {
      const before = this.pos;
      body.push(this.parseStatement());
      if (this.pos === before) this.next();
    }

    let endLine = open.line;
    if (this.peek().value === "}") {
      endLine = this.peek().line;
      this.next();
    } else {
      this.warn(this.peek(), "Tanda } tidak ditemukan.");
    }

    return { type: "BlockStatement", body, file: this.file, line: open.line, endLine };
  }

  /** Baca `( ... )` mentah; dipakai header control-flow. */
  readParenRaw() {
    const open = this.peek();
    if (open.value !== "(") {
      this.warn(open, "Tanda ( tidak ditemukan.");
      return { raw: "", line: open.line };
    }

    let depth = 0;
    let end = open.end;
    while (!this.atEnd()) {
      const token = this.next();
      end = token.end;
      if (token.value === "(") depth += 1;
      else if (token.value === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    return { raw: this.source.slice(open.start, end), line: open.line };
  }

  parseIf() {
    const token = this.next();
    const header = this.readParenRaw();
    const consequent = this.parseStatement();
    let alternate = null;
    if (this.eatValue("else")) alternate = this.parseStatement();
    return { type: "IfStatement", header, consequent, alternate, file: this.file, line: token.line };
  }

  parseFor() {
    const token = this.next();
    const header = this.readParenRaw();
    const body = this.parseStatement();
    return { type: "ForStatement", header, body, file: this.file, line: token.line };
  }

  parseWhile() {
    const token = this.next();
    const header = this.readParenRaw();
    const body = this.parseStatement();
    return { type: "WhileStatement", header, body, file: this.file, line: token.line };
  }

  parseDoWhile() {
    const token = this.next();
    const body = this.parseStatement();
    let header = { raw: "", line: token.line };
    if (this.peek().value === "while") {
      this.next();
      header = this.readParenRaw();
    } else {
      this.warn(this.peek(), "`while` tidak ditemukan pada do-while.");
    }
    this.eatValue(";");
    return { type: "DoWhileStatement", body, header, file: this.file, line: token.line };
  }

  parseReturn() {
    const token = this.next();
    let argument = null;
    if (this.peek().value !== ";") argument = this.parseExpression();
    const rawEnd = this.endOffset();
    this.eatValue(";");
    return { type: "ReturnStatement", argument, raw: this.source.slice(token.start, rawEnd), file: this.file, line: token.line };
  }

  /** Statement yang tidak didukung -> simpan teks aslinya agar bisa dilewati. */
  parseUnsupportedStatement() {
    const token = this.peek();
    const raw = collectRawStatementText(this);
    return { type: "Unsupported", raw, file: this.file, line: token.line };
  }

  parseExpressionStatement() {
    const startToken = this.peek();
    const startPos = this.pos;
    const expression = this.parseExpression();

    if (!expression || this.pos === startPos) {
      this.pos = startPos;
      const raw = collectRawStatementText(this);
      return { type: "Unsupported", raw, file: this.file, line: startToken.line };
    }

    const raw = this.source.slice(startToken.start, this.endOffset());
    this.eatSemicolon();
    return { type: "ExpressionStatement", expression, raw, file: this.file, line: startToken.line };
  }

  eatSemicolon() {
    if (this.eatValue(";")) return;
    if (!this.atEnd() && this.peek().value !== "}") {
      this.warn(this.peek(), "Tanda ; tidak ditemukan (statement tetap diproses).");
    }
  }

  // --- ekspresi ---------------------------------------------------------

  parseExpression() {
    const first = this.parseAssignment();
    if (!first) return null;

    if (this.peek().value !== ",") return first;

    const expressions = [first];
    while (this.eatValue(",")) {
      const next = this.parseAssignment();
      if (!next) break;
      expressions.push(next);
    }
    return { type: "SequenceExpression", expressions, file: first.file, line: first.line };
  }

  parseAssignment() {
    const left = this.parseConditional();
    if (!left) return null;

    const operator = this.peek().value;
    if (!ASSIGNMENT_OPERATORS.has(operator)) return left;

    this.next();
    const right = this.parseAssignment();
    return { type: "AssignmentExpression", operator, left, right, file: left.file, line: left.line };
  }

  parseConditional() {
    const test = this.parseBinary(1);
    if (!test) return null;
    if (!this.eatValue("?")) return test;

    const consequent = this.parseAssignment();
    this.eatValue(":");
    const alternate = this.parseAssignment();
    return { type: "ConditionalExpression", test, consequent, alternate, file: test.file, line: test.line };
  }

  parseBinary(minPrecedence) {
    let left = this.parseUnary();
    if (!left) return null;

    for (;;) {
      const operator = this.peek().value;
      const precedence = BINARY_PRECEDENCE[operator];
      if (precedence === undefined || precedence < minPrecedence) break;

      this.next();
      const right = this.parseBinary(precedence + 1);
      if (!right) break;
      left = { type: "BinaryExpression", operator, left, right, file: left.file, line: left.line };
    }

    return left;
  }

  parseUnary() {
    const token = this.peek();

    if (token.value === "++" || token.value === "--") {
      this.next();
      const argument = this.parseUnary();
      if (!argument) return null;
      return { type: "UpdateExpression", operator: token.value, argument, prefix: true, file: this.file, line: token.line };
    }

    if (UNARY_OPERATORS.has(token.value)) {
      this.next();
      const argument = this.parseUnary();
      if (!argument) return null;
      return { type: "UnaryExpression", operator: token.value, argument, prefix: true, file: this.file, line: token.line };
    }

    return this.parsePostfix();
  }

  parsePostfix() {
    let node = this.parsePrimary();
    if (!node) return null;

    for (;;) {
      const token = this.peek();

      if (token.value === "(") {
        this.next();
        /** @type {AstNode[]} */
        const args = [];
        if (this.peek().value !== ")") {
          do {
            const argument = this.parseAssignment();
            if (!argument) break;
            args.push(argument);
          } while (this.eatValue(","));
        }
        if (this.peek().value !== ")") this.warn(this.peek(), "Tanda ) tidak ditemukan pada pemanggilan fungsi.");
        else this.next();

        node = {
          type: "CallExpression",
          callee: node,
          arguments: args,
          raw: this.source.slice(node.start ?? 0, this.endOffset()),
          file: node.file,
          line: node.line,
          start: node.start,
          end: this.endOffset(),
        };
        continue;
      }

      if (token.value === "[") {
        this.next();
        const property = this.parseExpression();
        if (this.peek().value !== "]") this.warn(this.peek(), "Tanda ] tidak ditemukan.");
        else this.next();
        node = { type: "MemberExpression", object: node, property, computed: true, file: node.file, line: node.line };
        continue;
      }

      if (token.value === "." || token.value === "->") {
        this.next();
        const property = this.next();
        node = {
          type: "MemberExpression",
          object: node,
          property: { type: "Identifier", name: property.value, file: this.file, line: property.line },
          computed: false,
          file: node.file,
          line: node.line,
        };
        continue;
      }

      if (token.value === "++" || token.value === "--") {
        this.next();
        node = { type: "UpdateExpression", operator: token.value, argument: node, prefix: false, file: node.file, line: node.line };
        continue;
      }

      break;
    }

    return node;
  }

  parsePrimary() {
    const token = this.peek();

    if (token.type === "number") {
      this.next();
      return { type: "NumberLiteral", value: toNumber(token.value), raw: token.raw, file: this.file, line: token.line, start: token.start, end: token.end };
    }

    if (token.type === "string" || token.type === "char") {
      this.next();
      return { type: "StringLiteral", value: token.value, raw: token.raw, kind: token.type, file: this.file, line: token.line, start: token.start, end: token.end };
    }

    if (token.type === "identifier") {
      this.next();
      return { type: "Identifier", name: token.value, file: this.file, line: token.line, start: token.start, end: token.end };
    }

    if (token.value === "(") {
      const open = this.next();
      const inner = this.parseExpression();
      if (this.peek().value !== ")") this.warn(this.peek(), "Tanda ) tidak ditemukan.");
      else this.next();
      if (!inner) return null;
      return { ...inner, start: open.start, end: this.endOffset(), paren: true };
    }

    return null;
  }
}

/**
 * Ambil teks mentah satu statement:
 * - berhenti setelah `;` di kedalaman 0, atau
 * - bila mengandung blok `{ ... }`, berhenti setelah `}` penutupnya.
 * `}` penutup blok induk tidak pernah dimakan.
 *
 * @param {Parser} parser
 */
function collectRawStatementText(parser) {
  const start = parser.peek().start ?? 0;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let openedBlock = false;

  while (!parser.atEnd()) {
    const token = parser.peek();

    if (token.value === "}" && paren === 0 && bracket === 0 && brace === 0) break;
    if (token.value === ";" && paren === 0 && bracket === 0 && brace === 0) {
      parser.next();
      break;
    }

    if (token.value === "(") paren += 1;
    else if (token.value === ")") paren = Math.max(0, paren - 1);
    else if (token.value === "[") bracket += 1;
    else if (token.value === "]") bracket = Math.max(0, bracket - 1);
    else if (token.value === "{") {
      brace += 1;
      openedBlock = true;
    } else if (token.value === "}") {
      brace = Math.max(0, brace - 1);
      parser.next();
      if (openedBlock && brace === 0) {
        if (parser.peek().value === ";") parser.next();
        return parser.source.slice(start, parser.endOffset()).trim();
      }
      continue;
    }

    parser.next();
  }

  return parser.source.slice(start, parser.endOffset()).trim();
}

export { KEYWORDS, TYPE_KEYWORDS };
