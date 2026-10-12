/**
 * Regenerasi golden file untuk tokenizer & parser.
 *
 * Jalankan: npm run golden:update
 *
 * Golden file disimpan di server/compiler/__fixtures__/<nama>.<tokens|ast>.json.
 * Setelah regenerasi, WAJIB review diff-nya lewat git — test golden hanya
 * berguna sebagai penjaga regresi bila isinya memang disetujui.
 */

import fs from "node:fs";

import { parse } from "../parser.js";
import { fixtureNames, goldenPath, readFixture, simplifyNode, simplifyTokens } from "../test-utils.js";
import { tokenize } from "../tokenizer.js";

function writeJson(target, data) {
  fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const names = fixtureNames();

for (const name of names) {
  const source = readFixture(name);
  const file = `${name}.c`;

  const { tokens, warnings } = tokenize(source);
  writeJson(goldenPath(name, "tokens"), { file, tokens: simplifyTokens(tokens) });

  const program = parse(source, { file });
  writeJson(goldenPath(name, "ast"), { file, ast: simplifyNode(program) });

  process.stdout.write(`${file}: ${tokens.length} token, ${program.body.length} node, ${warnings.length + program.warnings.length} warning\n`);
}

process.stdout.write(`Selesai: ${names.length} fixture.\n`);
