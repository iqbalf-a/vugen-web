import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadProject } from "./loader.js";
import { setParameterKeys, updateParameterSetting } from "./prmWrite.js";

describe("setParameterKeys", () => {
  const prm = [
    "[parameter:a]", 'Type="Table"', 'GenerateNewVal="EachIteration"', 'Table="a.dat"', "",
    "[parameter:b]", 'Type="Table"', 'Table="b.dat"', "",
    "[parameter:c]", 'GenerateNewVal="Once"', "",
  ].join("\r\n");

  it("mengganti nilai di baris yang ada dan hanya di seksi itu", () => {
    const out = setParameterKeys(prm, "a", { GenerateNewVal: "EachOccurrence" });
    expect(out).toContain('[parameter:a]\r\nType="Table"\r\nGenerateNewVal="EachOccurrence"\r\nTable="a.dat"');
    expect(out).toContain('[parameter:c]\r\nGenerateNewVal="Once"');
  });

  it("menyisipkan key yang belum ada sebelum baris kosong penutup seksi, sesuai urutan", () => {
    const out = setParameterKeys(prm, "b", { GenerateNewVal: "Once", OutOfRangePolicy: "AbortVuser" });
    expect(out).toContain('Table="b.dat"\r\nGenerateNewVal="Once"\r\nOutOfRangePolicy="AbortVuser"\r\n\r\n[parameter:c]');
  });

  it("alias key yang sudah ada (UpdateValueOn, WhenOutOfValues) diganti di tempat, dengan ejaan aslinya", () => {
    const text = '[parameter:x]\nUpdateValueOn="Once"\nWhenOutOfValues="Abort"\n';
    expect(setParameterKeys(text, "x", { GenerateNewVal: "EachIteration", OutOfRangePolicy: "CycleInSequence" })).toBe(
      '[parameter:x]\nUpdateValueOn="EachIteration"\nWhenOutOfValues="CycleInSequence"\n',
    );
  });

  it("nama tidak peka kapitalisasi, EOL LF dipertahankan, seksi tak ada -> null", () => {
    const lf = '[parameter:Name]\nTable="x.dat"\n';
    expect(setParameterKeys(lf, "name", { GenerateNewVal: "Once" })).toBe('[parameter:Name]\nTable="x.dat"\nGenerateNewVal="Once"\n');
    expect(setParameterKeys(lf, "other", { GenerateNewVal: "Once" })).toBeNull();
  });
});

describe("updateParameterSetting", () => {
  let dir;
  const prmPath = () => path.join(dir, "s.prm");
  const section = (name, table, extra = []) =>
    [`[parameter:${name}]`, 'Type="Table"', `Table="${table}"`, 'SelectNextRow="Sequential"', 'GenerateNewVal="EachIteration"', 'OutOfRangePolicy="ContinueWithLast"', ...extra].join("\r\n");

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-prmw-"));
    await fs.writeFile(path.join(dir, "Action.c"), "Action(){ return 0; }");
    await fs.writeFile(path.join(dir, "maker.dat"), "m\nu1\nu2\n");
    await fs.writeFile(path.join(dir, "approver.dat"), "a\nx1\nx2\n");
    await fs.writeFile(path.join(dir, "short.dat"), "s\nonly\n");
    await fs.writeFile(path.join(dir, "bare.dat"), "plain\nx\n");
    await fs.writeFile(
      prmPath(),
      Buffer.from(
        [section("maker", "maker.dat", ["; catatan é"]), section("approver", "approver.dat"), section("short", "short.dat"), ""].join("\r\n"),
        "latin1",
      ),
    );
    dir = await fs.realpath(dir);
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  const paramOf = async (name) => (await loadProject(dir)).parameters.find((p) => p.name === name);

  it("mengubah Update value on dan When out of values; byte lain tetap", async () => {
    const before = (await fs.readFile(prmPath())).toString("latin1");
    const result = await updateParameterSetting(dir, "maker", { updateValueOn: "EachOccurrence", outOfRangePolicy: "Abort" });
    expect(result).toEqual({ name: "maker", file: "s.prm", GenerateNewVal: "EachOccurrence", OutOfRangePolicy: "AbortVuser" });

    const after = (await fs.readFile(prmPath())).toString("latin1");
    expect(after).toBe(before.replace('GenerateNewVal="EachIteration"', 'GenerateNewVal="EachOccurrence"').replace('OutOfRangePolicy="ContinueWithLast"', 'OutOfRangePolicy="AbortVuser"'));
    expect(await paramOf("maker")).toMatchObject({ updateValueOn: "EachOccurrence", outOfRangePolicy: "Abort" });
  });

  it("Same line as: menulis nama induk, project membacanya, dan pengaturan lain tidak disentuh", async () => {
    await updateParameterSetting(dir, "approver", { selectNextRow: "SameLine", sameLineAs: "maker" });
    expect((await fs.readFile(prmPath())).toString("latin1")).toContain('[parameter:approver]\r\nType="Table"\r\nTable="approver.dat"\r\nSelectNextRow="Same line as maker"\r\nGenerateNewVal="EachIteration"');
    expect(await paramOf("approver")).toMatchObject({ selectNextRow: "SameLine", sameLineAs: "maker", updateValueOn: "EachIteration" });
  });

  it("induk tidak boleh ikut mengikuti parameter lain, dan rantai ditolak", async () => {
    await expect(updateParameterSetting(dir, "maker", { selectNextRow: "SameLine", sameLineAs: "short" })).rejects.toMatchObject({ status: 409 });
    await expect(updateParameterSetting(dir, "short", { selectNextRow: "SameLine", sameLineAs: "approver" })).rejects.toMatchObject({ status: 409 });
  });

  it("jumlah baris harus sama, tidak boleh mengikuti diri sendiri", async () => {
    await expect(updateParameterSetting(dir, "short", { selectNextRow: "SameLine", sameLineAs: "maker" })).rejects.toThrow(/Row counts must match/);
    await expect(updateParameterSetting(dir, "maker", { selectNextRow: "SameLine", sameLineAs: "maker" })).rejects.toMatchObject({ status: 400 });
  });

  it("kembali ke Sequential/Random/Unique", async () => {
    await updateParameterSetting(dir, "approver", { selectNextRow: "Unique" });
    expect(await paramOf("approver")).toMatchObject({ selectNextRow: "Unique", sameLineAs: null });
  });

  it("menolak nilai tak dikenal, parameter tak ada, perubahan kosong, dan parameter tanpa .prm", async () => {
    await expect(updateParameterSetting(dir, "maker", { updateValueOn: "Sometimes" })).rejects.toMatchObject({ status: 400 });
    await expect(updateParameterSetting(dir, "maker", { outOfRangePolicy: "Explode" })).rejects.toMatchObject({ status: 400 });
    await expect(updateParameterSetting(dir, "maker", { selectNextRow: "Whenever" })).rejects.toMatchObject({ status: 400 });
    await expect(updateParameterSetting(dir, "maker", {})).rejects.toMatchObject({ status: 400 });
    await expect(updateParameterSetting(dir, "ghost", { updateValueOn: "Once" })).rejects.toMatchObject({ status: 404 });
    await expect(updateParameterSetting(dir, "plain", { updateValueOn: "Once" })).rejects.toMatchObject({ status: 409 });
  });
});
