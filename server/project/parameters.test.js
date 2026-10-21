import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadProject } from "./loader.js";
import { loadParameters, parseDat, parsePrm } from "./parameters.js";

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

describe("parsePrm", () => {
  it("seksi tunggal dengan semua key", () => {
    const text = '[parameter:Host]\r\nType="Table"\r\nTable="hosts.dat"\r\nSelectNextRow="Sequential"\r\nUpdateValueOn="EachIteration"\r\nWhenOutOfValues="Cycle"\r\n';
    expect(parsePrm(text)).toEqual([{
      name: "Host",
      type: "Table",
      table: "hosts.dat",
      columnName: null,
      format: null,
      offset: 0,
      selectNextRow: "Sequential",
      sameLineAs: null,
      updateValueOn: "EachIteration",
      outOfRangePolicy: "Cycle",
    }]);
  });

  it("beberapa seksi; default berlaku bila key tidak ada", () => {
    const text = '[parameter:ip]\nType="Table"\n\n[parameter:subTrans]\nSelectNextRow="Random"\n';
    const result = parsePrm(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: "ip", type: "Table", selectNextRow: "Sequential", outOfRangePolicy: "Cycle" });
    expect(result[1]).toMatchObject({ name: "subTrans", selectNextRow: "Random" });
  });

  it("WhenOutOfValues dan OutOfRangePolicy keduanya dipetakan ke outOfRangePolicy", () => {
    expect(parsePrm('[parameter:x]\nWhenOutOfValues="Abort"\n')[0].outOfRangePolicy).toBe("Abort");
    expect(parsePrm('[parameter:y]\nOutOfRangePolicy="Continue"\n')[0].outOfRangePolicy).toBe("Continue");
  });

  it("token VuGen untuk When out of values dipetakan ke nama internal", () => {
    const policy = (token) => parsePrm(`[parameter:x]
OutOfRangePolicy="${token}"
`)[0].outOfRangePolicy;
    expect([policy("ContinueWithLast"), policy("AbortVuser"), policy("CycleInSequence")]).toEqual(["Continue", "Abort", "Cycle"]);
  });

  it('"Same line as X" menyimpan nama induk', () => {
    expect(parsePrm('[parameter:a]\nSelectNextRow="Same line as userMaker"\n')[0]).toMatchObject({
      selectNextRow: "SameLine", sameLineAs: "userMaker",
    });
    expect(parsePrm('[parameter:a]\nSelectNextRow="Unique"\n')[0]).toMatchObject({ selectNextRow: "Unique", sameLineAs: null });
  });

  it("BOM dibuang; komentar (;) dilewati; baris kosong dilewati", () => {
    const text = '\uFEFF; komentar\n[parameter:A]\nType="Table"\n\n; lagi\n';
    expect(parsePrm(text)).toHaveLength(1);
    expect(parsePrm(text)[0].name).toBe("A");
  });

  it("teks kosong -> array kosong", () => {
    expect(parsePrm("")).toEqual([]);
    expect(parsePrm("; hanya komentar\n")).toEqual([]);
  });
});

describe("loadParameters dengan .prm", () => {
  it(".prm menerapkan selectNextRow dan outOfRangePolicy ke parameter yang sudah dimuat dari .dat", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-prm-"));
    try {
      await fs.writeFile(path.join(tmpDir, "ip.dat"), "ip\n10.0.0.1\n10.0.0.2\n", "utf8");
      await fs.writeFile(path.join(tmpDir, "ip.prm"), '[parameter:ip]\nType="Table"\nSelectNextRow="Random"\nWhenOutOfValues="Continue"\n', "utf8");
      await fs.writeFile(path.join(tmpDir, "Action.c"), "Action(){return 0;}", "utf8");
      const { loadProject } = await import("./loader.js");
      const project = await loadProject(tmpDir);
      const ipParam = project.parameters.find((p) => p.name === "ip");
      expect(ipParam).toBeDefined();
      expect(ipParam.selectNextRow).toBe("Random");
      expect(ipParam.outOfRangePolicy).toBe("Continue");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("Type=Time di .prm menghasilkan parameter dengan nilai waktu terhitung", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-time-"));
    try {
      await fs.writeFile(path.join(tmpDir, "s.prm"), '[parameter:year]\nType="Time"\nFormat="%Y"\nOffset=""\n[parameter:monthBefore]\nType="Time"\nFormat="%Y/%m/%d"\nOffset="-2592000"\n', "utf8");
      await fs.writeFile(path.join(tmpDir, "Action.c"), "Action(){return 0;}", "utf8");
      const { loadProject } = await import("./loader.js?t=time");
      const project = await loadProject(tmpDir);
      const year = project.parameters.find((p) => p.name === "year");
      const mb = project.parameters.find((p) => p.name === "monthBefore");
      expect(year).toBeDefined();
      expect(year.type).toBe("Time");
      expect(year.values[0]).toMatch(/^\d{4}$/);
      expect(mb).toBeDefined();
      expect(mb.values[0]).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it(".prm yang seksinya tidak ada di .dat tidak menghasilkan parameter baru", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-prm2-"));
    try {
      await fs.writeFile(path.join(tmpDir, "ip.dat"), "ip\n1.2.3.4\n", "utf8");
      await fs.writeFile(path.join(tmpDir, "notexist.prm"), '[parameter:ghost]\nType="Table"\n', "utf8");
      await fs.writeFile(path.join(tmpDir, "Action.c"), "Action(){return 0;}", "utf8");
      const { loadProject } = await import("./loader.js");
      const project = await loadProject(tmpDir);
      expect(project.parameters.find((p) => p.name === "ghost")).toBeUndefined();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
