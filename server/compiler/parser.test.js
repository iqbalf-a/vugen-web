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

  it("menyimpan header kontrol alur sebagai teks mentah dan tetap memparse body", () => {
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

    expect(types).toEqual(["Unsupported", "Unsupported", "Unsupported", "Unsupported", "LabeledStatement", "ReturnStatement"]);

    const raws = action.body.filter((node) => node.type === "Unsupported").map((node) => node.raw);
    expect(raws).toEqual(["int i = 0;", 'char *msg = "halo";', "struct Point { int x; int y; };", "goto selesai;"]);
  });

  it("memberi warning bila blok tidak ditutup tanpa crash", () => {
    const program = parse('Action() {\n lr_output_message("x");\n', { file: "broken.c" });
    expect(program.warnings.some((warning) => /tidak ditemukan/.test(warning.message))).toBe(true);
    expect(collectCalls(program).map((call) => call.name)).toEqual(["lr_output_message"]);
  });

  it("tidak crash pada input sampah", () => {
    const program = parse("@@@ ### ??? ;;;", { file: "garbage.c" });
    expect(Array.isArray(program.body)).toBe(true);
    expect(program.body.length).toBeGreaterThan(0);
  });
});
