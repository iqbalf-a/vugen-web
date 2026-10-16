# Plan F7 — Fungsi VuGen yang dibutuhkan script KOPRA

Lanjutan setelah stabilisasi S0–S7 (`828f33d`). Tujuan: `BP000_MCM_ViewDashboard` ter-compile **tanpa warning** dan bisa jalan end-to-end ke mock yang meniru polanya. Bonus: warning script `BP211_*`/`BP601_*`/`BPXXX_*` turun drastis.

Ini **tahap fitur** — menambah fungsi runtime diizinkan, tetapi **hanya** fungsi di daftar ini. Tidak ada endpoint, panel UI, atau dependency baru.

## 0. Aturan

1. Folder `D:\Mandiri\...` read-only total. Jangan salin isi script, IP, user, token, atau isi `.dat` ke repo. Fixture uji sintetis.
2. **Jangan** mengirim request ke server target asli. Semua uji run ke mock lokal.
3. Setiap fungsi baru: export di `server/runtime/vuser-api.js` **dan** nama di `server/runtime/api-names.js` (test sinkron sudah ada).
4. TDD: unit test per fungsi (tabel kasus), lalu satu test integrasi run ke mock.
5. Jangan menebak semantik VuGen. Bila ragu (ditandai **[cek]** di bawah), lihat pemakaian nyatanya di script (read-only) atau tanya user.
6. Hasil S1–S7 (keamanan UI, bentuk event/`RunResult`, registry, transpiler, perilaku error S5) tidak diubah kecuali perlu — jelaskan.
7. Sebelum commit: `npx vitest run`, `npx eslint .`, `node server/test/run-cli.js samples/f5 1`. Satu commit per sub-tahap (`F7a: …`, `F7b: …`, …), update `todo.md`.

## 1. Pola nyata (sudah dicek read-only, nilai disamarkan)

| Fungsi | Pemakaian | Bentuk argumen |
|---|---|---|
| `lr_exit` | MCM ×5, total KOPRA ×36 | selalu `lr_exit(LR_EXIT_ITERATION_AND_CONTINUE, LR_FAIL)` di dalam `if (lr_get_transaction_status(...) == LR_FAIL)` |
| `web_reg_save_param_json` | MCM ×3, total ×50 | `"ParamName=x", "QueryString=<jsonpath>", SEARCH_FILTERS, "Scope=BODY", LAST`. JSONPath yang muncul: `$.a`, `$..a` (paling sering), `$.a.b.c`, `$.a.b[n].c` |
| `web_revert_auto_header` | MCM ×2 | `web_revert_auto_header("Nama-Header")` |
| `web_remove_auto_header` | total ×26 | `web_remove_auto_header("Nama-Header", LAST)` |
| `lr_param_sprintf` | MCM ×1 | `lr_param_sprintf("usernamePassword", "%s", lr_eval_string("{username}:{password}"))` |
| `web_convert_from_formatted` | MCM ×1 | `"FormattedData={usernamePassword}", "TargetParam=basicUsername", "Extensions=Base64", LAST` |
| `web_concurrent_start/end` | total ×337 | `web_concurrent_start(NULL);` … request … `web_concurrent_end(NULL);` |

## 2. Sub-tahap

### F7a — Kontrol alur: `lr_exit`

- [x] `lr_exit(mode, status)` melempar sinyal khusus (mis. class `VuserExit` dengan `mode`, `status`) yang **bukan** error biasa, ditangkap `runUnit` di `runner.js`.
- [x] Mode (angka dari S4; terima juga string):
  - `LR_EXIT_ITERATION_AND_CONTINUE` (2) dan `LR_EXIT_ACTION_AND_CONTINUE` (1): akhiri iterasi/action saat ini, lanjut iterasi berikutnya. (Runner hanya punya satu action per iterasi, jadi keduanya sama.)
  - `LR_EXIT_VUSER` (0): hentikan iterasi tersisa, lalu jalankan `vuser_end`. **[cek]** dokumentasi LR: "exit and go directly to end action".
  - `LR_EXIT_VUSER_AFTER_ITERATION` (3) / `LR_EXIT_VUSER_AFTER_ACTION` (4): selesaikan iterasi/action saat ini, lalu tidak ada iterasi baru; `vuser_end` tetap jalan.
- [x] `status`: `LR_FAIL` → iterasi `failed` (run `failed`); `LR_PASS` → `passed`; `LR_AUTO` → `failed` bila ada step gagal di iterasi itu, selain itu `passed`.
- [x] Transaksi yang masih terbuka saat `lr_exit`: perlakukan sama dengan S5 (dicatat `Fail`) bila status `LR_FAIL`; **[cek]** untuk `LR_PASS`/`LR_AUTO` — default: `LR_AUTO` per transaksi.
- [x] Log `info`: `lr_exit: <mode> <status>` dengan file/baris.
- [x] Test: `iterations=3`, `lr_exit(ITERATION_AND_CONTINUE, LR_FAIL)` di iterasi 1 → kode setelahnya tidak jalan, iterasi 2–3 jalan, `vuser_end` 1×, run `failed`. `lr_exit(LR_EXIT_VUSER, LR_PASS)` di iterasi 1 → iterasi 2–3 tidak jalan, `vuser_end` jalan, run `passed`.

### F7b — Correlation JSON: `web_reg_save_param_json`

- [ ] Registrasi seperti `web_reg_save_param` yang sudah ada (berlaku untuk request berikutnya), evaluasi pada body response.
- [ ] Atribut: `ParamName` (wajib), `QueryString` (wajib), `Scope=BODY` (default; nilai lain → warning, tetap BODY), `SelectAll=Yes|No` (default No), `NotFound=Error|Warning` (default Error), `Ordinal` (opsional). Abaikan `SEARCH_FILTERS` sentinel dan atribut filter tak dikenal dengan warning.
- [ ] Evaluator JSONPath **subset sendiri** (tanpa dependency) di `server/runtime/jsonpath.js`: `$`, `.nama`, `..nama` (recursive descent), `[n]`, `[*]`, `['nama']`. Sintaks lain → error registrasi yang jelas.
- [ ] Hasil: match pertama (atau `Ordinal`); string → apa adanya, angka/boolean → `String()`, objek/array → `JSON.stringify` (**[cek]** LR menyimpan teks JSON aslinya). `SelectAll=Yes` → `name_1..name_n` + `name_count` (sama dengan pola `web_reg_save_param` yang ada, bila ada; kalau belum ada, cukup `name_count` + `name_n`).
- [ ] Body bukan JSON valid / tidak ketemu → `NotFound=Error`: step error (perilaku S5), `Warning`: log warn.
- [ ] Test tabel jsonpath + test integrasi dengan mock JSON (mis. `$..token` di objek bersarang, `$.data.items[1].id`).

### F7c — Header & parameter

- [ ] `web_remove_auto_header(name, ..., LAST)` dan `web_revert_auto_header(name)`: hapus header itu dari `autoHeaders` (nama case-insensitive). Header lain tetap. **[cek]** atribut `ImplicitGen=` bila ditemukan di script: abaikan dengan warning.
- [ ] `lr_param_sprintf(paramName, format, ...args)`: `lr_save_string(printf(format, ...args), paramName)` memakai `server/runtime/printf.js` dari S5.
- [ ] `web_convert_from_formatted`: dukung hanya `Extensions=Base64` → `TargetParam` = Base64 dari `FormattedData` (setelah substitusi `{param}`, UTF-8). **[cek]** arah konversi: verifikasi read-only bahwa `{basicUsername}` dipakai sebagai `Authorization: Basic {basicUsername}` (berarti encode). Extension lain → warning, param tidak diisi.
- [ ] Test: header hilang dari request berikutnya; `lr_param_sprintf` + `web_convert_from_formatted` menghasilkan `dXNlcjpwYXNz` untuk `user:pass`.

### F7d — `web_concurrent_start/end` (no-op berurutan)

- [ ] Keduanya menerima argumen apa pun, log `debug`, kembalikan 0. Request di antaranya tetap dijalankan **berurutan** seperti biasa (tidak ada eksekusi paralel — tulis di known limitations).
- [ ] Test: request di dalam blok tercatat sebagai step normal.

## 3. Di luar F7 (tetap backlog)

- `lr_unmask` (algoritme mask milik LoadRunner; tidak bisa diimplementasi dengan benar — hanya dipakai untuk password `web_set_user`).
- `web_reg_async_attributes` / `web_stop_async` (polling async).
- `lr_save_int`, `lr_paramarr_*`, mesin `.prm`, multipart, HTTP/2, tab Transactions.

## 4. AC akhir F7

- Smoke test `VUGEN_REAL_SCRIPTS="D:/Mandiri/KOPRA/R10.1/script"`: `BP000_VugenWeb` **0** warning, `BP000_MCM_ViewDashboard` **0** warning; laporkan sisa warning per folder lain (harapan: hanya `lr_unmask`, `web_reg_async_attributes`, `web_stop_async`).
- Fixture sintetis `server/test/__fixtures__/mcm-like/` meniru **pola** MCM (login dengan Basic auth dari `lr_param_sprintf` + `web_convert_from_formatted`, token dari `web_reg_save_param_json` dipakai di request berikutnya, auto header di-revert, cek transaksi + `lr_exit`) dijalankan ke mock: status sesuai, token terpakai, header revert hilang.
- `todo.md`: status F7, script referensi diperbarui, known limitations (concurrent berurutan, subset JSONPath).
