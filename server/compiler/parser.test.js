import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parse } from "./parser.js";
import { collectCalls, compilerDir, fixtureNames, goldenPath, readFixture, simplifyNode, walkAst } from "./test-utils.js";

describe("parser: golden file", () => {
  for (const name of fixtureNames()) {
    it(`cocok dengan ${name}.ast.json`, () => {
      const golden = JSON.parse(fs.readFileSync(goldenPath(name, "ast"), "utf8"));
      const program = parse(readFixture(name), { file: `${name}.c` });
      expect(simplifyNode(program)).toEqual(golden.ast);
    });
  }
});

describe("parser: sample Action.c", () => {
  const program = parse(readFixture("sample-action"), { file: "sample-action.c" });

  it("mengenali definisi fungsi Action()", () => {
    const functions = program.body.filter((node) => node.type === "FunctionDeclaration");
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe("Action");
    expect(functions[0].line).toBe(1);
  });

  it("mendaftar pemanggilan dengan file dan line yang benar", () => {
    const calls = collectCalls(program);
    expect(calls.map((call) => call.name)).toEqual([
      "lr_start_transaction",
      "web_reg_save_param",
      "web_url",
      "lr_end_transaction",
      "lr_think_time",
      "web_submit_data",
    ]);
    expect(calls.map((call) => call.line)).toEqual([3, 5, 11, 20, 22, 24]);
    expect(calls.every((call) => call.file === "sample-action.c")).toBe(true);
  });

  it("setiap node punya file dan line", () => {
    walkAst(program, (node) => {
      if (node.type === "Program") return;
      expect(typeof node.file, `${node.type} tanpa file`).toBe("string");
      expect(typeof node.line, `${node.type} tanpa line`).toBe("number");
    });
  });

  it("memparse `return 0;` sebagai ReturnStatement dengan NumberLiteral", () => {
    const action = program.body.find((node) => node.type === "FunctionDeclaration");
    const last = action.body.at(-1);
    expect(last.type).toBe("ReturnStatement");
    expect(last.argument).toMatchObject({ type: "NumberLiteral", value: 0 });
  });

  it("tidak melaporkan warning untuk script valid", () => {
    expect(program.warnings).toEqual([]);
  });
});

describe("parser: samples/basic/Action.c (AC F2)", () => {
  it("memparse script sampel nyata tanpa error dan semua call punya file/line benar", () => {
    const target = path.join(compilerDir, "..", "..", "samples", "basic", "Action.c");
    const source = fs.readFileSync(target, "utf8");
    const program = parse(source, { file: "Action.c" });

    expect(program.warnings).toEqual([]);
    expect(program.body.map((node) => node.type)).toEqual(["FunctionDeclaration"]);

    const calls = collectCalls(program);
    expect(calls).toEqual([
      { name: "lr_start_transaction", file: "Action.c", line: 3 },
      { name: "web_reg_save_param", file: "Action.c", line: 5 },
      { name: "web_url", file: "Action.c", line: 11 },
      { name: "lr_end_transaction", file: "Action.c", line: 20 },
      { name: "lr_think_time", file: "Action.c", line: 22 },
      { name: "web_submit_data", file: "Action.c", line: 24 },
    ]);
  });
});

describe("parser: kontrol alur & unsupported", () => {
  it("golden tetap sama bila fixture dikonversi ke CRLF", () => {
    for (const name of fixtureNames()) {
      const golden = JSON.parse(fs.readFileSync(goldenPath(name, "ast"), "utf8"));
      const crlf = readFixture(name).replace(/\r?\n/g, "\r\n");
      expect(simplifyNode(parse(crlf, { file: `${name}.c` })), name).toEqual(golden.ast);
    }
  });

  it("menyimpan teks asli header (header.raw) dan tetap memparse body", () => {
    const program = parse(readFixture("control-flow"), { file: "control-flow.c" });
    const action = program.body.find((node) => node.type === "FunctionDeclaration");

    const loop = action.body.find((node) => node.type === "ForStatement");
    expect(loop.header.raw).toBe("(i = 0; i < 3; i++)");
    expect(collectCalls(loop.body).map((call) => call.name)).toEqual(["lr_output_message"]);

    const ifNode = action.body.find((node) => node.type === "IfStatement");
    expect(ifNode.header.raw).toBe('(strcmp(lr_eval_string("{status}"), "ok") == 0)');
    expect(ifNode.alternate.type).toBe("BlockStatement");
  });

  it("menandai statement yang tidak didukung sebagai Unsupported", () => {
    const program = parse(readFixture("unsupported"), { file: "unsupported.c" });
    const action = program.body.find((node) => node.type === "FunctionDeclaration");
    const types = action.body.map((node) => node.type);

    // S4: `int i = 0;` dan `char *msg = "halo";` kini VariableDeclaration; struct & goto tetap Unsupported.
    expect(types).toEqual(["VariableDeclaration", "VariableDeclaration", "Unsupported", "Unsupported", "LabeledStatement", "ReturnStatement"]);

    const raws = action.body.filter((node) => node.type === "Unsupported").map((node) => node.raw);
    expect(raws).toEqual(["struct Point { int x; int y; };", "goto selesai;"]);
  });

  it("memberi warning bila blok tidak ditutup tanpa crash", () => {
    const program = parse('Action() {\n lr_output_message("x");\n', { file: "broken.c" });
    expect(program.warnings.some((warning) => /closing|not found/i.test(warning.message))).toBe(true);
    expect(collectCalls(program).map((call) => call.name)).toEqual(["lr_output_message"]);
  });

  it("tidak crash pada input sampah", () => {
    const program = parse("@@@ ### ??? ;;;", { file: "garbage.c" });
    expect(Array.isArray(program.body)).toBe(true);
    expect(program.body.length).toBeGreaterThan(0);
  });
});

describe("parser: header kontrol alur jadi ekspresi (S4)", () => {
  const parseAction = (body) => {
    const program = parse(`Action()\n{\n${body}\n}`, { file: "t.c" });
    return { program, stmts: program.body.find((n) => n.type === "FunctionDeclaration").body };
  };

  it("if/while/do-while punya test; header.raw tetap ada", () => {
    const { stmts } = parseAction("if (a == 1) b = 2; while (x < 3) x++; do { x--; } while (x > 0);");
    expect(stmts.map((n) => n.type)).toEqual(["IfStatement", "WhileStatement", "DoWhileStatement"]);
    expect(stmts[0].test).toMatchObject({ type: "BinaryExpression", operator: "==" });
    expect(stmts[0].header.raw).toBe("(a == 1)");
    expect(stmts[1].test).toMatchObject({ type: "BinaryExpression", operator: "<" });
    expect(stmts[2].test).toMatchObject({ type: "BinaryExpression", operator: ">" });
  });

  it("for: init (ekspresi atau deklarasi), test, update; boleh kosong", () => {
    const { stmts } = parseAction("for (i = 0; i < 3; i++) x++; for (int j = 0; j < 2; j++) x++; for (;;) break;");
    expect(stmts[0].init).toMatchObject({ type: "AssignmentExpression" });
    expect(stmts[0].test).toMatchObject({ type: "BinaryExpression" });
    expect(stmts[0].update).toMatchObject({ type: "UpdateExpression" });
    expect(stmts[1].init.type).toBe("VariableDeclaration");
    expect(stmts[2]).toMatchObject({ init: null, test: null, update: null });
  });

  it("panggilan fungsi di kondisi jadi CallExpression", () => {
    const { stmts } = parseAction('if (lr_get_transaction_status(lr_eval_string("{t}")) == LR_FAIL) { x = 1; }');
    expect(collectCalls(stmts[0].test).map((c) => c.name)).toEqual(["lr_get_transaction_status", "lr_eval_string"]);
  });

  it("header yang gagal diparse menjadi Unsupported + warning, tanpa crash", () => {
    const { program, stmts } = parseAction("if (@@@) { x = 1; } y = 2;");
    expect(stmts[0].type).toBe("Unsupported");
    expect(stmts[1].type).toBe("ExpressionStatement");
    expect(program.warnings.length).toBeGreaterThan(0);
  });

  it("switch/case/default diparse", () => {
    const { stmts } = parseAction("switch (n) { case 1: a = 1; break; case 2: default: a = 3; }");
    expect(stmts[0].type).toBe("SwitchStatement");
    expect(stmts[0].discriminant).toMatchObject({ type: "Identifier", name: "n" });
    expect(stmts[0].cases.map((c) => (c.test ? c.test.value : "default"))).toEqual([1, 2, "default"]);
  });
});

describe("parser: VariableDeclaration (S4)", () => {
  const first = (code) => {
    const program = parse(code, { file: "t.c" });
    return { program, node: program.body[0] };
  };

  it("multi-deklarator dengan init, array, dan pointer", () => {
    const { node } = first("double a=0, b, c[256], *d;");
    expect(node.type).toBe("VariableDeclaration");
    expect(node.dataType).toBe("double");
    expect(node.declarations.map((d) => [d.name, d.array, d.pointer, d.init?.value ?? null])).toEqual([
      ["a", false, false, 0],
      ["b", false, false, null],
      ["c", true, false, null],
      ["d", false, true, null],
    ]);
    expect(node.declarations[2].arraySize).toMatchObject({ type: "NumberLiteral", value: 256 });
  });

  it("tipe turunan: merc_timer_handle_t, size_t, unsigned long, const char *", () => {
    for (const code of ["merc_timer_handle_t startTime;", "size_t n = 0;", "unsigned long x = 1;", 'static const char *name = "x";']) {
      const { program, node } = first(code);
      expect(node.type, code).toBe("VariableDeclaration");
      expect(program.warnings, code).toEqual([]);
    }
  });

  it("deklarasi di dalam fungsi dan prototipe fungsi (diabaikan)", () => {
    const program = parse("int helper(int a, char *b);\nAction()\n{\n int x = 1, y;\n return x;\n}", { file: "t.c" });
    expect(program.body.map((n) => n.type)).toEqual(["FunctionPrototype", "FunctionDeclaration"]);
    expect(program.body[1].body[0].type).toBe("VariableDeclaration");
  });

  it("struct/goto tetap Unsupported", () => {
    const program = parse("Action()\n{\n struct P { int x; };\n goto x;\n}", { file: "t.c" });
    expect(program.body[0].body.map((n) => n.type)).toEqual(["Unsupported", "Unsupported"]);
  });

  it("cast diparse sebagai CastExpression", () => {
    const { node } = first("int n = (int)3.7;");
    expect(node.declarations[0].init).toMatchObject({ type: "CastExpression", targetType: "int" });
  });
});
