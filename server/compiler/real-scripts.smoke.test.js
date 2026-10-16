/**
 * Smoke test opsional terhadap script VuGen nyata (S4).
 *
 * Aktif hanya bila env `VUGEN_REAL_SCRIPTS` menunjuk folder yang berisi subfolder script:
 *
 *   VUGEN_REAL_SCRIPTS="D:/Mandiri/KOPRA/R10.1/script" npx vitest run server/compiler/real-scripts.smoke.test.js
 *
 * Tiap subfolder di-compile (read-only; artefak ke folder temp) lalu hasilnya di-`import()`
 * untuk memastikan sintaks JS valid. Tidak ada isi script yang disimpan atau dicetak.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadProject } from "../project/loader.js";
import { compileScript } from "./transpile.js";

const ROOT = process.env.VUGEN_REAL_SCRIPTS;
const folders = ROOT && fs.existsSync(ROOT) ? fs.readdirSync(ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : [];

describe.skipIf(folders.length === 0)("smoke: script nyata (VUGEN_REAL_SCRIPTS)", () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vugen-smoke-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  for (const folder of folders) {
    it(`${folder}: compile + import() tanpa error sintaks`, async () => {
      const scriptDir = path.join(ROOT, folder);
      const project = await loadProject(scriptDir);
      const cacheDir = path.join(tmpDir, folder);
      const result = await compileScript({ scriptDir, cacheDir, files: project.files });

      // Salin ke .mjs: folder temp tidak punya package.json "type": "module".
      const target = path.join(tmpDir, `${folder}.mjs`);
      fs.copyFileSync(result.modulePath, target);
      const mod = await import(`${pathToFileURL(target).href}?t=${Date.now()}`);
      expect(typeof mod.__bind).toBe("function");
    }, 30000);
  }
});
