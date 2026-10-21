import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadProject } from "../project/loader.js";
import { HttpError, resolveScriptDir, resolveScriptFile } from "../project/paths.js";
import { readScriptFile, saveScriptFile } from "../project/save.js";

const ACTION_C = 'Action()\r\n{\r\n    web_url("home", "URL=https://example.test/", LAST);\r\n    return 0;\r\n}\r\n';

let base;
let scriptDir;
let cacheDir;
let outsideFile;

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-web-"));
  cacheDir = path.join(base, "cache");
  process.env.VUGEN_CACHE_DIR = cacheDir;

  scriptDir = path.join(base, "basic");
  outsideFile = path.join(base, "outside.c");
  await fs.mkdir(path.join(scriptDir, "data"), { recursive: true });

  await fs.writeFile(path.join(scriptDir, "vuser_init.c"), "vuser_init()\r\n{\r\n    return 0;\r\n}\r\n", "utf8");
  await fs.writeFile(path.join(scriptDir, "Action.c"), ACTION_C, "utf8");
  await fs.writeFile(path.join(scriptDir, "vuser_end.c"), "vuser_end()\r\n{\r\n    return 0;\r\n}\r\n", "utf8");
  await fs.writeFile(path.join(scriptDir, "globals.h"), "// globals\r\n", "utf8");
  await fs.writeFile(path.join(scriptDir, "data", "users.dat"), "demo,secret\r\n", "utf8");
  await fs.writeFile(outsideFile, "rahasia\r\n", "utf8");

  // Pakai realpath supaya tidak tertipu 8.3 name / junction di Windows.
  scriptDir = await fs.realpath(scriptDir);
});

afterAll(async () => {
  delete process.env.VUGEN_CACHE_DIR;
  await fs.rm(base, { recursive: true, force: true });
});

describe("resolveScriptDir", () => {
  it("mengembalikan realpath folder", async () => {
    await expect(resolveScriptDir(scriptDir)).resolves.toBe(await fs.realpath(scriptDir));
  });

  it("menolak path kosong", async () => {
    await expect(resolveScriptDir("")).rejects.toBeInstanceOf(HttpError);
  });

  it("menolak path yang bukan folder", async () => {
    await expect(resolveScriptDir(path.join(scriptDir, "Action.c"))).rejects.toBeInstanceOf(HttpError);
  });
});

describe("resolveScriptFile", () => {
  it("menerima file di dalam folder script", async () => {
    const file = await resolveScriptFile(scriptDir, "data/users.dat");
    expect(file.relative).toBe("data/users.dat");
  });

  it("menolak keluar folder lewat ..", async () => {
    await expect(resolveScriptFile(scriptDir, "../outside.c")).rejects.toBeInstanceOf(HttpError);
  });

  it("menolak path absolut", async () => {
    await expect(resolveScriptFile(scriptDir, outsideFile)).rejects.toBeInstanceOf(HttpError);
  });

  it("menolak file yang tidak ada", async () => {
    await expect(resolveScriptFile(scriptDir, "tidak-ada.c")).rejects.toBeInstanceOf(HttpError);
  });
});

describe("loadProject", () => {
  it("mendaftar file script + config dan memakai fallback Run Logic", async () => {
    const project = await loadProject(scriptDir);
    const paths = project.files.map((file) => file.path);

    expect(paths).toEqual(
      expect.arrayContaining(["Action.c", "globals.h", "vuser_init.c", "vuser_end.c", "data/users.dat"]),
    );
    expect(project.runLogic.source).toBe("fallback");
    expect(project.runLogic.init).toBe("vuser_init.c");
    expect(project.runLogic.end).toBe("vuser_end.c");
    expect(project.runLogic.actions.map((action) => action.file)).toEqual(["Action.c"]);
    expect(project.actions.map((action) => action.file)).toEqual(["Action.c"]);
    expect(project.cacheKey).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("readScriptFile", () => {
  it("mengembalikan teks LF + metadata EOL/encoding asli", async () => {
    const file = await readScriptFile(scriptDir, "Action.c");
    expect(file.eol).toBe("crlf");
    expect(file.encoding).toBe("utf8");
    expect(file.text).not.toContain("\r");
    expect(file.text).toContain('web_url("home"');
  });
});

describe("saveScriptFile", () => {
  it("round-trip tanpa perubahan byte", async () => {
    const before = await fs.readFile(path.join(scriptDir, "Action.c"));
    const file = await readScriptFile(scriptDir, "Action.c");
    await saveScriptFile(scriptDir, "Action.c", file.text);
    const after = await fs.readFile(path.join(scriptDir, "Action.c"));
    expect(after.equals(before)).toBe(true);
  });

  it("mempertahankan CRLF saat isi diubah", async () => {
    await saveScriptFile(scriptDir, "Action.c", "Action()\n{\n    return 0;\n}\n");
    const raw = await fs.readFile(path.join(scriptDir, "Action.c"), "utf8");
    expect(raw).toContain("\r\n");
    expect(raw).not.toMatch(/[^\r]\n/);
  });

  it("menulis backup ke cache di luar folder script", async () => {
    const result = await saveScriptFile(scriptDir, "Action.c", "Action()\n{\n    return 1;\n}\n");
    expect(result.backup.startsWith(cacheDir)).toBe(true);
    const backups = await fs.readdir(path.dirname(result.backup));
    expect(backups.length).toBeGreaterThan(0);
  });

  it("menolak ekstensi selain .c/.h/.dat", async () => {
    await expect(saveScriptFile(scriptDir, "data/users.prm", "x")).rejects.toBeInstanceOf(HttpError);
  });

  it("tidak mengubah file lain di folder script", async () => {
    const others = ["vuser_init.c", "vuser_end.c", "globals.h", "data/users.dat"];
    const before = await Promise.all(others.map((name) => fs.readFile(path.join(scriptDir, name))));
    await saveScriptFile(scriptDir, "Action.c", "Action()\n{\n    return 2;\n}\n");
    const after = await Promise.all(others.map((name) => fs.readFile(path.join(scriptDir, name))));
    before.forEach((buffer, index) => expect(after[index].equals(buffer)).toBe(true));
  });

  it("tidak meninggalkan file temp di folder script", async () => {
    const entries = await fs.readdir(scriptDir);
    expect(entries.filter((name) => name.includes("vugenweb"))).toEqual([]);
  });
});
