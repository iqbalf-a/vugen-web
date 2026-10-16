# Plan Stabilisasi VuGen Web (S0–S7)

> Instruksi kerja untuk AI agent (dieksekusi sesi lain, model Sonnet).
> Dibuat 2026-10-16 dari analisis kode + script VuGen nyata di `D:\Mandiri\KOPRA\R10.1\script\`.
> `plan.md` tetap jadi spesifikasi produk; dokumen ini adalah **daftar perbaikan** agar spesifikasi itu benar-benar terpenuhi dan script KOPRA nyata bisa di-run.

---

## 0. Cara mengeksekusi plan ini (WAJIB dibaca dulu)

1. Kerjakan tahap **berurutan** (S0 → S7). Satu tahap = satu commit. **Berhenti di akhir setiap tahap** dan laporkan hasil AC ke user sebelum lanjut.
2. Sebelum commit tiap tahap, ketiganya wajib hijau:
   ```
   npx vitest run
   npx eslint .
   node server/test/run-cli.js samples/f5 1     # setelah S1: harus exit 0 dan menulis run.json
   ```
3. Semua aturan keras di `plan.md` §4 tetap berlaku (folder script read-only, artefak ke `.cache/`, save atomic, unsupported → warning, kill child process).
4. **Folder `D:\Mandiri\...` read-only total.** Jangan pernah menyalin isi `.dat`, IP, username, URL bank, atau token dari sana ke repo. Fixture uji dibuat **sintetis** (nama/nilai palsu) dengan *struktur* yang meniru script nyata.
5. Kode baru mengikuti gaya yang ada: vanilla JS ESM, JSDoc `@typedef`, komentar bahasa Indonesia, tanpa dependency baru kecuali disebut di plan ini.
6. Hapus `console.log` debug yang ditambahkan selama perbaikan sebelum commit. Log diagnostik lewat event `log` level `debug`, bukan stdout.
7. Pesan commit format `S<n>: <ringkas>`; akhiri dengan baris atribusi yang diminta sistem.

---

## 1. Ringkasan kondisi saat ini (hasil analisis)

**Git:** commit terakhir `F2`. Semua pekerjaan F3–F6 **belum di-commit** (11 file modified, ±20 file untracked), padahal `todo.md` menulis F3–F6 sudah commit & AC lulus.

**Test/lint:** `vitest` 51/51 hijau — tapi hanya menguji F0–F2. **Tidak ada satu pun test untuk transpiler, runtime, run route, atau UI.** `eslint .` → **48 error**.

**Bug yang terverifikasi (bukan dugaan):**

| # | Lokasi | Masalah | Bukti |
|---|---|---|---|
| B1 | `server/runtime/vuser-api.js` `handleResponse` | Tidak pernah mengirim event `step` (hanya `log` info yang **dobel**). `stepData` dibangun lalu dibuang. | `run-cli samples/f5` → 0 step tercatat |
| B2 | `server/test/run-cli.js:139` | `saveRun(...)` tidak di-`await` lalu `process.exit()` → `run.json` tidak pernah tertulis. | `.cache/<hash>/` hanya berisi `build/` |
| B3 | `server/runtime/vuser-api.js` `web_js_run` | Hanya `Code=` **terakhir** yang disimpan; `SOURCES` diabaikan. Pola KOPRA (`Code= myFunc(...)` + `SOURCES` berisi definisi `myFunc`) tidak pernah memanggil `myFunc` → `{subTrans}` tak pernah di-set. | Screenshot: nama step `RPS_{s…` |
| B4 | `server/compiler/transpile.js` If/For/While/DoWhile | Kondisi disalin sebagai **teks C mentah** (`header.raw`) + regex makro. Panggilan fungsi di kondisi (`lr_get_transaction_status`, `strcmp`, `lr_eval_string`) tidak diberi `__vu.`/`await` → `ReferenceError` saat runtime. `fix_manual.cjs` justru mengomentari perbaikan regex-nya. | `transpile.js` ±L205–275 |
| B5 | `transpile.js` deklarasi | Hanya regex satu variabel; `double a=0, b=0;` → unsupported. Init (`int x = atoi(...)`) disalin mentah tanpa transpile. `globals.h` global (`merc_timer_handle_t startTime;`) diabaikan lalu **di-hardcode** `let startTime = 0;` di header modul. | `transpile.js` ±L290–320, L380 |
| B6 | `transpile.js` `statementToJs` | Kurung kurawal salah tempat: untuk node non-`Unsupported` yang jatuh ke default, fungsi mengembalikan `undefined` → `flatMap` → `undefined.replace` crash. | akhir `statementToJs` |
| B7 | `transpile.js` `MACRO_VALUES` | `LR_PASS/LR_FAIL/LR_AUTO/LR_EXIT_*` jadi **string**, padahal `lr_get_transaction_status` mengembalikan **angka** → `== LR_FAIL` selalu false. | |
| B8 | `server/routes/run.js` | Punya `runningChildren` sendiri, tidak memakai `registerRun/killAllRuns` di `server/vite-plugin.js` → **child yatim** saat Vite restart/close (melanggar aturan 8). Fork path `path.resolve("server/runtime/runner.js")` bergantung cwd. | grep `registerRun` → 0 pemakai |
| B9 | `server/runtime/runner.js` | `import(\`file://${modulePath}\`)` (salah di Windows; wajib `pathToFileURL`). Banyak `console.log` debug + blok "lr_get_transaction_status" duplikat. | |
| B10 | `vuser-api.js` header | `web_add_header` = `web_add_auto_header` (keduanya permanen). VuGen: `web_add_header` hanya untuk **request berikutnya**. Lalu `__resetHeaders()` tiap iterasi menghapus auto header yang di-set di `vuser_init`. | |
| B11 | `vuser-api.js` `handleResponse` | `request` diisi tebakan (`method: "GET"/"UNKNOWN"` dari `redirectChain`), bukan request asli; body Buffer dikirim lewat IPC. | |
| B12 | `server/routes/run.js` SSE | Polling `setInterval` 1 dtk + heartbeat tiap 1 dtk (spec: push + heartbeat 15 dtk lewat `startSse`). `pendingEvents` tidak pernah dibersihkan (memory leak). | |
| B13 | `src/components/snapshotPanel.js:121-123` | Variabel `contentType`, `body`, `truncated` tidak terdefinisi (`no-undef`) → crash saat render biner. | eslint |
| B14 | `server/project/loader.js` | `.prm` tidak dibaca: parameter hanya ditebak dari header `.dat`. Tipe `Time` (38 kemunculan di script nyata) tidak didukung. | |

**File sampah di working tree:** `fix_manual.cjs`, `test-final.mjs`, `test-final2.mjs` (berisi path internal bank), `MEMORY.md` (salah tempat — memori milik Claude, bukan repo), `Screenshot.png`.

**Fungsi yang dipakai script KOPRA nyata** (hitungan dari semua `*.c` di `D:\Mandiri\KOPRA\R10.1\script`, untuk prioritas):
`web_url` 5710 · `web_custom_request` 2832 · `lr_eval_string` 2524 · `compareDuration` (user fn di globals.h) 2088 · `lr_start_timer/lr_end_timer` 2082 · `web_add_cookie` 714 · `lr_think_time` 391 · `lr_start/end_transaction` 347 · `web_concurrent_start/end` 337 · `lr_save_string` 270 · `web_add_auto_header` 249 · `lr_get_transaction_status` 99 · `web_set_sockets_option` 95 · `web_js_run` 69 · `web_add_header` 66 · `lr_set_transaction` 66 · `web_reg_save_param_json` 50 · `strstr` 36 · `lr_exit` 36 · `lr_error_message` 36 · `web_submit_data` 33 · `web_reg_save_param_ex` 27 · `web_remove_auto_header` 26 · `web_rest` 24 · `web_set_user` 21 · `web_set_max_html_param_len` 21 · `lr_unmask` 21 · `web_reg_async_attributes`/`web_stop_async` 15 · `web_convert_from_formatted` 12 · `lr_param_sprintf` · `lr_output_message`.

**Pola struktur script KOPRA** (lihat juga skill `mandiri-loadrunner`):
- `.usr` `[Actions]` berisi banyak action; `default.usp` `[RunLogicRunRoot]` hanya menjalankan **Action Utama** (mis. `BP601_Maker`), yang memanggil **Action General** (`Loadpage("...")`, `Login(...)`) sebagai fungsi C biasa dengan parameter `char*`.
- `globals.h`: `#include "lrun.h"` dll (harus diabaikan), global `merc_timer_handle_t startTime;`, fungsi `double compareDuration(double, double)`.
- Action General memakai `double seq1=0, seq2=0, ...;`, `char buf[256];`, `startTime = lr_start_timer(); ... tempSeq = lr_end_timer(startTime); seq1 = compareDuration(seq1, tempSeq);`.
- `.prm`: section `[parameter:<nama>]` dengan `Type="Table"` (`Table=`, `ColumnName="Col 1"`, `Delimiter`, `SelectNextRow=Sequential|Unique|Random`, `GenerateNewVal=EachIteration|Once|EachOccurrence`, `OutOfRangePolicy=ContinueWithLast`) dan `Type="Time"` (`Format="%Y/%m/%d"` dst., `Offset`), juga `Type="Userid"`. Baris pertama `.dat` = header nama kolom.
- Error handling: `if (lr_get_transaction_status(lr_eval_string("{transName}")) == LR_FAIL) { lr_error_message(...); lr_exit(LR_EXIT_ITERATION_AND_CONTINUE, LR_FAIL); }` dan juga `lr_exit(2, 1)`.

---

## S0 — Amankan working tree + lint bersih

Tujuan: titik awal yang jujur dan bisa di-review.

- [ ] Hapus `fix_manual.cjs`, `test-final.mjs`, `test-final2.mjs`, `MEMORY.md` (root repo).
- [x] `Screenshot.png` sudah dihapus (keputusan user, 2026-10-16).
- [ ] Hapus debug `console.log`/`console.error` di `server/runtime/runner.js`, `server/routes/run.js`, `server/project/loader.js` (`[parseConfigEntries] ...`). Pertahankan yang berupa error nyata via `sendEvent("log", {level:"debug"|"error"})`.
- [ ] Di `runner.js`: hapus dua blok "Explicitly add lr_get_transaction_status" (duplikat & tidak perlu; `Object.assign(vu, vuserApi)` sudah cukup).
- [ ] Perbaiki seluruh error `npx eslint .` (48). Untuk `snapshotPanel.js:121-123` (B13) jangan sekadar membungkam — definisikan dari data step yang dirender (lihat fungsi pemanggilnya). Hapus fungsi mati (`escapeJsonDump`, `prettyPrintByCategory` bila memang tak dipakai, `updateParams` import, `createStore` import di `main.js`).
- [ ] Ubah `todo.md`: F3–F6 status `[~]` dengan catatan "kode ada, AC belum terverifikasi — lihat plan-stabilisasi.md". Tambah tabel S0–S7.
- [ ] Commit: `S0: bersihkan working tree, lint bersih, checkpoint kode F3–F6 (AC belum terpenuhi)`.

**AC:** `npx eslint .` 0 error; `npx vitest run` hijau; `git status` bersih kecuali `.cache/`.

---

## S1 — Jalur step end-to-end (B1, B2, B11) + test integrasi pertama

Tujuan: setiap request HTTP menghasilkan **satu** step lengkap di `run.json` sesuai `plan.md` §7.3.

Desain (ikuti ini, jangan improvisasi):
- **Runner** yang memberi nomor `seq` (counter di `vu`, mulai 1, satu run = satu VU = berurutan) dan **runner** yang menulis body ke `<cacheDir>/runs/<runId>/steps/<seq>.body` (payload start sudah membawa `cacheDir` dan `runId`). Batas 5 MB → potong + `truncated: true`. Lewat IPC hanya metadata (tanpa Buffer).
- Event baru dari runner: `sendEvent("step", stepData)` di mana `stepData` adalah objek (bukan string JSON) berbentuk `RunStep` di `server/runs/store.js`. Hapus jalur `log("step", ...)` dan `log("transaction", ...)` berbasis string; ganti `sendEvent("transaction", {...})` langsung.
- `request` diisi dari request **asli** yang dikirim (method, URL final setelah substitusi, header gabungan, `bodyPreview` ≤ 2 KB). `response.redirects`: array hop dari `http-client` (`redirectChain`).
- `timing.startMs` = ms sejak awal run; `timing.durationMs` dari http-client (pastikan bukan 0 — ukur di `doRequest`).
- `transaction` = nama transaksi terdalam yang sedang terbuka.

Langkah:
- [ ] Refactor `handleResponse(stepName, resp, type, snapshotName, requestInfo)`: semua `web_*` yang melakukan request meneruskan `requestInfo`. Hapus log dobel. Emit `step`. Jika status ≥ 400 atau ada `web_reg_find` gagal → isi `step.error` (lihat S4 untuk perilaku fail).
- [ ] Ekstrak logika "compile + fork + akumulasi event + saveRun" dari `server/routes/run.js` dan `server/test/run-cli.js` ke modul baru `server/runs/execute.js`:
  ```js
  /** @returns {{ runId, child, done: Promise<RunResult>, events: EventEmitter }} */
  export async function startRun({ scriptDir, options })
  ```
  `done` resolve **setelah** `saveRun` selesai. `run.js` dan `run-cli.js` keduanya memakai fungsi ini (hilangkan duplikasi switch event).
- [ ] `run-cli.js`: `await done` lalu baru exit (B2).
- [ ] `store.js` `addStep`: terima `seq` dari stepData; `response.bodyFile = "steps/<seq>.body"`.
- [ ] Test baru `server/test/run.f5.test.js` (Vitest, `testTimeout` 20 s): start mock (`server/test/mock.js`, port acak/0), `startRun({ scriptDir: "samples/f5", options:{iterations:1} })`, `await done`, lalu assert:
  - `status === "passed"`, jumlah step = jumlah `web_*` request di `samples/f5/Action.c`,
  - tiap step punya `file`, `line` sesuai baris C, `request.method` benar (`POST` untuk login), `timing.durationMs >= 0`,
  - file `steps/1.body` ada dan berisi HTML mock,
  - `params.csrf` terisi, step `login` mengirim body berisi `csrf=<nilai itu>`,
  - check `web_reg_find` `passed: true`,
  - `transactions` berisi `T01_home` dan `T02_dashboard`.
  Mock perlu menerima port dinamis; samples memakai URL tetap `127.0.0.1:18081` — gunakan parameter `{host}` di sample **atau** jalankan mock di 18081 dengan `--pool=forks` single. Pilih yang paling sederhana dan dokumentasikan.
- [ ] Test `iterations=3` pada `samples/core`: `vuser_init`/`vuser_end` 1×, step Action ber-`iteration` 1..3 (AC F3 asli).

**AC:** test baru hijau; `node server/test/run-cli.js samples/f5 1` menulis `run.json` yang lolos assert di atas; UI menampilkan step dengan baris dan durasi benar (cek manual `npm run dev`).

---

## S2 — Lifecycle child process & SSE (B8, B9, B12)

- [ ] Pindahkan registri child dari `server/vite-plugin.js` ke `server/runs/registry.js` (`registerRun`, `stopRun`, `killAllRuns`, `getRun`). `vite-plugin.js` dan `execute.js` mengimpor dari sana (hindari import sirkular plugin ↔ route).
- [ ] Fork path: `fileURLToPath(new URL("../runtime/runner.js", import.meta.url))`.
- [ ] `runner.js`: `await import(pathToFileURL(modulePath).href + "?t=" + Date.now())`.
- [ ] Stop: kirim `{type:"stop"}`, fallback `child.kill()` setelah 1500 ms; status run = `"stopped"` (bukan failed); `run.json` tetap disimpan dengan step yang sudah ada.
- [ ] SSE: `execute.js` mengekspos `EventEmitter`; `handleRunEvents` pakai `startSse()` dari `http-utils.js` (heartbeat 15 s), replay event yang sudah ada lalu subscribe push; unsubscribe saat `req` close; tutup stream setelah `done`. Hapus polling `setInterval`.
- [ ] Simpan event per run maksimal sampai 5 menit setelah `done`, lalu hapus dari memori.
- [ ] Hapus endpoint `/run/:id/debug` atau batasi ke `NODE_ENV=development` — pilih hapus.
- [ ] Test: start run pada mock yang endpoint-nya delay 10 s → `stopRun` → child exit < 2 s, status `stopped`. Test `killAllRuns()` membunuh semua child.

**AC:** test hijau; manual: restart Vite (ubah `vite.config.js`) di tengah run → `tasklist | findstr node` tidak menyisakan runner.

---

## S3 — Transpiler yang benar untuk subset C KOPRA (B4–B7)

Tujuan: semua file `.c`/`globals.h` di script KOPRA ter-transpile **tanpa** `ReferenceError` dan tanpa hack nama variabel.

Parser (`server/compiler/parser.js`):
- [ ] Header control-flow diparse menjadi ekspresi AST, bukan hanya `raw`: `IfStatement.test`, `WhileStatement.test`, `DoWhileStatement.test`, `ForStatement.init/test/update` (init boleh deklarasi). Pertahankan `header.raw` untuk pesan warning. Gagal parse header → node `Unsupported` + warning (jangan crash).
- [ ] `VariableDeclaration`: `{ type, declarations: [{ name, arraySize|null, pointer:boolean, init: Expr|null }] }`. Tipe yang dikenali: `int, char, short, long, float, double, unsigned, signed, const, static, merc_timer_handle_t, size_t` dan kombinasi + `*`. Berlaku di dalam fungsi **dan** top-level (global).
- [ ] `switch/case/default` (opsional, rendah — tidak ditemukan di script nyata; boleh `Unsupported`).
- [ ] `#include "lrun.h"`, `"web_api.h"`, `"lrw_custom_body.h"`, `"as_web.h"` → diabaikan **tanpa** warning "tidak ditemukan" (header sistem LoadRunner). `#ifndef/#define/#endif` → diabaikan.
- [ ] Tambah fixture + golden: `__fixtures__/kopra-loadpage.c` (sintetis, meniru `Loadpage.c` di §1: deklarasi multi, timer, `compareDuration`, `web_js_run` dengan `SOURCES`, `if (lr_get_transaction_status(...) == LR_FAIL) { ... lr_exit(...); }`), `__fixtures__/kopra-globals.h`.

Transpiler (`server/compiler/transpile.js`):
- [ ] Hapus `replaceCoreFunctions` & semua jalur regex teks mentah; kondisi/inisialisasi ditranspile via `expressionToJs`.
- [ ] Global dari semua file (terutama `globals.h`) → `let <nama> = <default>;` di level modul. Hapus hardcode `let startTime = 0;`.
- [ ] Default nilai: numerik `0`, `char x[N]`/`char*` → `""`.
- [ ] Fungsi bawaan C/LR yang **mengubah argumen buffer** (`sprintf`, `strcpy`, `strcat`, `lr_param_sprintf` tidak termasuk karena ke param): bila argumen pertama `Identifier`, transpile `sprintf(buf, f, a)` → `buf = await __vu.sprintf(f, a)`; `strcpy(d, s)` → `d = s`; `strcat(d, s)` → `d = d + s`. Selain Identifier → warning unsupported.
- [ ] `MACRO_VALUES`: `LR_PASS=0, LR_FAIL=1, LR_AUTO=2, LR_STOP=3`, `LR_EXIT_VUSER=0, LR_EXIT_ACTION_AND_CONTINUE=1, LR_EXIT_ITERATION_AND_CONTINUE=2, LR_EXIT_VUSER_AFTER_ITERATION=3, LR_EXIT_VUSER_AFTER_ACTION=4` (angka). Makro argumen web (`LAST`, `ITEMDATA`, `ENDITEM`, `EXTRARES`, `SOURCES`, `SEARCH_FILTERS`, `BEGIN_ARGUMENTS`, `END_ARGUMENTS`, `ARGP_*`) tetap sentinel string.
- [ ] `vuser-api.js`: `lr_end_transaction/lr_set_transaction/lr_exit` menerima status angka (dan string lama untuk kompatibilitas).
- [ ] Perbaiki B6: setiap cabang `statementToJs` **selalu** mengembalikan array.
- [ ] Panggilan fungsi user (`Loadpage(lr_eval_string("..."))`) tetap `await __fn_Loadpage(...)`; parameter fungsi user diteruskan apa adanya (string JS).
- [ ] Unary yang belum didukung (`&x`, `*p`, cast `(char*)x`) → warning + nilai apa adanya (cast boleh diabaikan: transpile ekspresi di dalamnya).
- [ ] Golden test transpiler: `__fixtures__/*.js.golden` + test yang juga `import()` modul hasil transpile (tulis ke temp dir) untuk memastikan **sintaks JS valid** untuk semua fixture.
- [ ] Test "smoke compile" opsional (di-skip bila folder tidak ada): jika env `VUGEN_REAL_SCRIPTS` di-set, compile setiap subfolder di path itu dan assert `import()` sukses. **Jangan** commit output/isinya.

**AC:** semua golden hijau; `VUGEN_REAL_SCRIPTS="D:/Mandiri/KOPRA/R10.1/script" npx vitest run` → semua script ter-transpile & ter-`import()` tanpa error sintaks; tidak ada string `startTime` hardcode di `transpile.js`.

---

## S4 — Semantik runtime VuGen (B3, B10 + fungsi prioritas)

Urutan sesuai frekuensi pemakaian di script nyata. Setiap fungsi baru: tambah ke daftar didukung + unit test dengan mock.

Kontrol & transaksi:
- [ ] `lr_exit(option, status)`: lempar `LrExitSignal {option, status}`. Runner menangani: `ITERATION_AND_CONTINUE` → iterasi berakhir (status sesuai `status`), lanjut iterasi berikutnya; `ACTION_AND_CONTINUE` → action berakhir, lanjut action berikutnya; `VUSER` → langsung ke `vuser_end`; `VUSER_AFTER_ITERATION/ACTION` sesuai nama. Transaksi terbuka saat exit ditutup dengan `status` tersebut.
- [ ] Transaksi bersarang: `Map<name, {startMs, failed}>`. `lr_end_transaction(name, LR_AUTO)` → `Fail` bila ada step error/check gagal sejak start, selain itu `Pass`. `lr_get_transaction_status(name)` → `LR_FAIL` (1) bila transaksi itu sudah tercatat gagal, else `LR_PASS` (0). `lr_set_transaction(name, durSec, status)` → catat transaksi langsung. Event transaksi membawa `iteration`.
- [ ] Error HTTP: status ≥ 400 (kecuali didaftarkan `web_reg_find`/`HttpStatus` lain), timeout, koneksi gagal, atau `web_reg_find` gagal → step error; transaksi aktif ditandai gagal; lalu **lempar** error ke runner (perilaku VuGen default: action gagal). Bila `continueOnError` → log error, lanjut statement berikutnya.

Request:
- [ ] B10: dua store — `autoHeaders` (permanen, `web_add_auto_header`, `web_remove_auto_header(name, LAST)`, `web_cleanup_auto_headers`) dan `nextHeaders` (`web_add_header`, dipakai & dikosongkan setelah **satu** request). `newUserEachIteration` hanya bersihkan cookie (dan `nextHeaders`), **bukan** auto header.
- [ ] `web_add_cookie("name=value; DOMAIN=host; PATH=/; ...")` → masukkan ke cookie jar tough-cookie (domain wajib; parameter disubstitusi dulu).
- [ ] `web_custom_request`: dukung `Body=`, `BodyBinary=` (decode escape `\\xNN`), `EncType=`, `RecContentType=`, `Mode=`; `EXTRARES` → abaikan resource sesudahnya (catat jumlah di log info).
- [ ] `web_rest`: `Header=` berulang di antara `HEADERS`/`BEGIN_HEADERS ... END_HEADERS` (cek format di script nyata `grep -n -A20 web_rest` sebelum implementasi — **jangan menebak**).
- [ ] `web_concurrent_start(NULL)` / `web_concurrent_end(NULL)` → no-op, request di antaranya dijalankan berurutan (log info sekali per blok).
- [ ] `web_set_sockets_option`, `web_set_max_html_param_len`, `web_reg_async_attributes`, `web_stop_async`, `web_convert_from_formatted` → no-op dengan log `info`/`warn` sekali per nama (bukan per panggilan).
- [ ] `web_set_user(user, pass, host)` → Basic auth untuk host itu.

Parameter & correlation:
- [ ] `web_js_run` (B3): kumpulkan semua `Code=` di blok `SOURCES ... ENDITEM` sebagai skrip pendefinisi, eksekusi dulu di satu `vm.createContext({ LR })`, lalu eksekusi `Code=` utama di context yang sama. `ResultParam=` → simpan nilai hasil ekspresi. Dukung `File=` (baca relatif folder script, read-only). Timeout `vm` 1 s.
- [ ] `web_reg_save_param_json("ParamName=x", "QueryString=$.a.b[0]", "SelectAll=Yes", "NotFound=Warning", SEARCH_FILTERS, ..., LAST)`: JSONPath subset (`$`, `.key`, `['key']`, `[n]`, `[*]`, `..key`). `SelectAll=Yes` → param array `x_1..x_n` + `x_count`. Implementasi sendiri (tanpa dependency) di `server/runtime/jsonpath.js` + unit test.
- [ ] `web_reg_save_param_ex`: `Ordinal=ALL` → param array; `NotFound=ERROR|Warning` (default ERROR → step error).
- [ ] Correlation registry hanya berlaku untuk **request berikutnya** (sudah) — pastikan juga dicari di header bila `Search=Headers|All`.
- [ ] `lr_param_sprintf(name, fmt, ...)`, `lr_save_int(n, name)`, `lr_paramarr_idx/len/random`, `lr_unmask(s)` (identitas + warn sekali).
- [ ] `lr_output_message/lr_error_message/sprintf`: format printf subset (`%s %d %i %f %.Nf %ld %c %%`, lebar/padding) di `server/runtime/printf.js` + unit test.
- [ ] Hapus pemanggilan `substituteParams` ganda (nama step disubstitusi sekali; `lr_eval_string` sudah dipakai di script).

**AC:** fixture `kopra-loadpage.c` dijalankan terhadap mock: `{subTrans}` terisi dari `web_js_run`, nama step tanpa `{...}`, `seq1` berubah (timer + `compareDuration` jalan), `lr_exit` di jalur gagal menghentikan iterasi saja (iterasi berikutnya tetap jalan), transaksi gagal berstatus `Fail`.

---

## S5 — Mesin parameter sesuai `.prm` (B14)

Buat `server/project/params.js` (parse) dan `server/runtime/param-engine.js` (nilai saat runtime).

- [ ] Parse `.prm` (nama dari `.usr` `[General] ParameterFile=`): section `[parameter:<Name>]`, nilai bisa ber-kutip.
- [ ] `Type="Table"`: baca `Table=` relatif folder script (encoding ANSI/UTF-8, CRLF), baris 1 = header, `Delimiter`, `ColumnName` = `"Col N"` (index 1-based) atau nama kolom. `StartRow`. `SelectNextRow`: `Sequential`; `Unique` (1 VU ≈ Sequential); `Random` (seeded per run, catat seed di `run.json`); `Same line as <param>` → ikut index param lain. `GenerateNewVal`: `EachIteration` (maju di awal iterasi ≥2), `Once`, `EachOccurrence` (maju tiap kali dievaluasi). `OutOfRangePolicy`: `ContinueWithLast`, `ContinueCyclic`, `AbortVuser`.
- [ ] `Type="Time"`: format strftime subset (`%Y %y %m %d %H %M %S %b %B %a %j` + literal), `Offset`/`OffsetUI` (hari), `WorkingDaysOn` boleh diabaikan dengan warning. `EachOccurrence` → dihitung ulang tiap substitusi.
- [ ] `Type="Userid"` → nama mesin/user (`os.userInfo().username`). Tipe lain (`Random`, `Unique`, `Iteration`, `VuserID`, `Group`, `Load Generator`): `Iteration` = nomor iterasi, `VuserID` = `1`, `Random` (`MinValue`,`MaxValue`,`Format`); sisanya warning + biarkan `{name}`.
- [ ] Urutan resolusi `{name}`: param runtime (`lr_save_string`/correlation) → param `.prm` → tidak ketemu (biarkan + warn sekali per nama per iterasi).
- [ ] Fallback bila tidak ada `.prm`: perilaku lama (header `.dat`), tetap jalan. Hormati memori user: `.dat` seperti `ip.dat`/`subTrans.dat` sudah berisi nilai — jangan minta user menambah `lr_save_string`.
- [ ] `GET /api/project` mengembalikan daftar parameter + tipe + nilai baris pertama (untuk tab Parameter).
- [ ] Unit test dengan fixture sintetis `server/project/__fixtures__/prm-basic/` (Table sequential + Time + Same line as).

**AC:** fixture: iterasi 1..3 mengambil baris 1..3, `ContinueWithLast` mengulang baris terakhir di iterasi 4; `{today}` = tanggal hari ini sesuai format.

---

## S6 — UI menyesuaikan kontrak baru

- [ ] `src/main.js`: konsumsi event SSE `step`/`transaction`/`log`/`done` bentuk baru (objek, bukan string JSON ber-level "step"). Satu sumber kebenaran: `store.currentRun`.
- [ ] Snapshot/Response: ambil body via `GET /api/run/:id/step/:seq/body?path=` (bukan via nama `Snapshot=t1.inf`). Endpoint snapshot-by-name boleh dihapus bila tak terpakai.
- [ ] Step list: tampilkan `file:line`, durasi, status, badge transaksi; step error berwarna merah dengan pesan error. Iterasi selector tetap.
- [ ] Tab baru ringan **Transactions** (nama, iterasi, status, durasi) — data sudah ada di `run.json`.
- [ ] Tab Parameter: nilai param **saat step itu** → runner menyertakan `paramsSnapshot` (hanya param yang berubah sejak step sebelumnya, untuk hemat) di setiap step.
- [ ] Toolbar: tampilkan jumlah warning transpile (klik → tab Log terfilter warn).
- [ ] Verifikasi manual dengan `npm run dev` + `samples/f5` & mock (`node server/test/mock.js` bila belum ada mode standalone, tambahkan).

**AC:** run `samples/f5` dari UI → step live dengan baris benar; klik step → snapshot HTML tampil; Stop < 2 s; tidak ada error di console browser.

---

## S7 — Validasi script nyata + dokumentasi

Tahap ini **butuh user** (jaringan bank hanya bisa diakses dari mesin user).

- [ ] Tambahkan `npm run check:script -- <folder>`: compile saja (tanpa request), cetak ringkasan: jumlah file, fungsi, warning per jenis, daftar fungsi unsupported + jumlah. Tidak menulis apa pun ke folder script.
- [ ] Jalankan `check:script` pada setiap folder di `D:\Mandiri\KOPRA\R10.1\script\` dan tempel ringkasannya (tanpa data sensitif) ke `docs/real-script-coverage.md`. Target: **0** unsupported untuk fungsi di daftar prioritas §1.
- [ ] Minta user menjalankan run nyata `BP211_Adjustment_UDC_ST` (1 iterasi, insecure TLS) dari UI dan membandingkan dengan replay VuGen: jumlah step, nama step, status transaksi. Catat selisih sebagai issue di `todo.md`.
- [ ] `README.md`: cara pakai, fungsi yang didukung, known limitations (urutan header, HTTP/2, kompresi, TLS, `web_concurrent` berurutan, multipart belum).
- [ ] Update `todo.md` final.

**AC:** dokumen coverage ada; user mengonfirmasi run BP211 menghasilkan step & transaksi yang setara dengan VuGen (atau selisihnya tercatat).

---

## Di luar scope (jangan dikerjakan)

Sama dengan `plan.md` §2 & §10: recording, multi-VU/k6, Step Toolbox, mengubah struktur folder script, TypeScript/React/Express. Tambahan: jangan mengejar `vtc_*`, `web_reg_async_attributes` fungsional, multipart upload penuh, HTTP/2.

## Risiko

- **Parser header control-flow (S3)** paling rawan regresi — kerjakan dengan golden test dulu (TDD), jangan ubah golden lama tanpa alasan tertulis di commit.
- **Perilaku error VuGen (S4)** gampang beda tipis; bila ragu, cek dokumentasi LoadRunner atau tanya user — jangan menebak.
- Data run (`.cache/`) berisi token/kredensial nyata saat script bank dijalankan; pastikan `.cache/` tetap di `.gitignore` dan tidak pernah ikut commit.
