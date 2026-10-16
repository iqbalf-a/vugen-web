import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadProject } from "./loader.js";
import { loadParameters, parseDat } from "./parameters.js";

let dir;

/** Tulis file dengan byte persis (CRLF dst.) */
async function write(relative, content) {
  const target = path.join(dir, ...relative.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-params-"));
  // header beda kapitalisasi dari nama file; CRLF; baris kosong di akhir
  await write("companyid.dat", "companyId\r\nCO-001\r\nCO-002\r\n\r\n");
  // single kolom, header = nama param
  await write("ip.dat", "ip\r\n10.0.0.1\r\n");
  // multi-kolom + sel kosong + spasi di header
  await write("userMaker.dat", " userId , password ,role\r\nu1,p1,maker\r\nu2,p2\r\n\r\n   \r\nu3,p3,maker\r\n");
  // data/ juga dibaca; nama param duplikat -> file pertama menang
  await write("data/subTrans.dat", "subTrans\nT01\nT02\n");
  await write("data/ipcopy.dat", "ip\n9.9.9.9\n");
  // .prm (INI) tidak boleh dibaca sebagai CSV
  await write("demo.prm", '[parameter:ip]\r\nType="Table"\r\nTable="ip.dat"\r\n');
  // header saja, tanpa nilai
  await write("kosong.dat", "kolom\r\n");
  await write("Action.c", "Action()\r\n{\r\n    return 0;\r\n}\r\n");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("parseDat", () => {
  it("baris pertama selalu header; baris kosong dilewati; CRLF dan LF", () => {
    expect(parseDat("a,b\r\n1,2\r\n\r\n3,4\r\n\r\n")).toEqual([
      { name: "a", values: ["1", "3"] },
      { name: "b", values: ["2", "4"] },
    ]);
    expect(parseDat("a\n1\n2\n")).toEqual([{ name: "a", values: ["1", "2"] }]);
  });

  it("nama header di-trim dan case-sensitive; BOM dibuang", () => {
    expect(parseDat("﻿ companyId ,CompanyID\nx,y\n").map((c) => c.name)).toEqual(["companyId", "CompanyID"]);
  });

  it("sel yang hilang jadi string kosong; file kosong -> tanpa parameter", () => {
    expect(parseDat("a,b\n1\n")).toEqual([
      { name: "a", values: ["1"] },
      { name: "b", values: [""] },
    ]);
    expect(parseDat("")).toEqual([]);
    expect(parseDat("\r\n\r\n")).toEqual([]);
  });

  it("baris nilai pertama BUKAN dianggap header meski mirip nama file", () => {
    expect(parseDat("ip\nip\n10.0.0.1\n")).toEqual([{ name: "ip", values: ["ip", "10.0.0.1"] }]);
  });
});

describe("loadParameters / loadProject", () => {
  it("nama param dari header (bukan nama file); multi-kolom; jumlah baris", async () => {
    const project = await loadProject(dir);
    const byName = Object.fromEntries(project.parameters.map((p) => [p.name, p]));

    expect(byName.companyId).toMatchObject({ file: "companyid.dat", rows: 2, values: ["CO-001", "CO-002"] });
    expect(byName.companyid).toBeUndefined(); // bukan nama file
    expect(byName.userId.values).toEqual(["u1", "u2", "u3"]);
    expect(byName.password.values).toEqual(["p1", "p2", "p3"]);
    expect(byName.role.values).toEqual(["maker", "", "maker"]);
    expect(byName.subTrans).toMatchObject({ file: "data/subTrans.dat", rows: 2 });
  });

  it(".prm tidak dibaca sebagai CSV (tidak ada parameter sampah)", async () => {
    const project = await loadProject(dir);
    const names = project.parameters.map((p) => p.name);
    expect(names.some((name) => name.includes("[parameter") || name.includes("Type="))).toBe(false);
    expect(project.parameters.every((p) => !p.file.endsWith(".prm"))).toBe(true);
  });

  it("nama duplikat: file pertama menang dan ada warning", async () => {
    const { parameters, warnings } = await loadParameters(dir, (await loadProject(dir)).files);
    expect(parameters.find((p) => p.name === "ip")).toMatchObject({ file: "ip.dat", values: ["10.0.0.1"] });
    expect(warnings.some((w) => /"ip".*ipcopy\.dat.*ip\.dat/.test(w))).toBe(true);
  });

  it("header tanpa baris nilai -> parameter dengan 0 baris", async () => {
    const project = await loadProject(dir);
    expect(project.parameters.find((p) => p.name === "kolom")).toMatchObject({ rows: 0, values: [] });
  });

  it("project.parameters berupa array biasa dan bisa di-JSON-kan", async () => {
    const project = await loadProject(dir);
    expect(Array.isArray(project.parameters)).toBe(true);
    expect(project.parameterFiles).toBeUndefined();
    expect(JSON.parse(JSON.stringify(project.parameters))).toHaveLength(project.parameters.length);
  });
});
