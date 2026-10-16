# Prompt untuk sesi Sonnet (plan-stabilisasi.md revisi 2)

Satu sesi baru per tahap. Tempel **prompt umum** lalu **prompt tahap**.
S0 sudah selesai (commit `f2dfb97`). Mulai dari S1.

---

## Prompt umum (tempel di awal setiap sesi)

```
Konteks: repo vugen-web (Vite + vanilla JS) untuk menjalankan script LoadRunner VuGen (C) lewat transpile ke JS.
Rencana kerja: plan-stabilisasi.md (revisi 2). Spesifikasi produk: plan.md.

Aturan:
- Fokus MEMPERBAIKI BUG dan MERAPIKAN kode yang sudah ada. JANGAN menambah fitur baru (fungsi VuGen baru, endpoint baru, panel/tab/opsi UI baru, dependency baru). Lihat definisi di bagian 0 butir 2 plan. Jika perbaikan terasa butuh fitur baru: berhenti, catat di §9 Backlog, tanya saya.
- Baca bagian 0, 1, 2 plan-stabilisasi.md, lalu bagian tahap yang saya minta. Kerjakan HANYA tahap itu.
- Cek git log dan todo.md dulu; jika tahap sebelumnya belum ber-commit, berhenti dan lapor.
- Folder D:\Mandiri\... read-only total. Jangan salin IP, user, token, atau isi .dat ke repo. Fixture uji dibuat sintetis.
- Jangan menebak perilaku/format VuGen. Jika ragu, lihat contoh read-only di D:\Mandiri\KOPRA\R10.1\script atau tanya saya.
- Setelah menulis kode berisi entitas HTML (&amp; &lt; dst.), cek dengan grep bahwa entitasnya tidak berubah jadi karakter mentah.
- Sebelum commit: npx vitest run, npx eslint ., dan (mulai S2) node server/test/run-cli.js samples/f5 1 harus lulus.
- Satu commit per tahap, pesan "S<n>: ...", update todo.md di commit yang sama.
- Selesai: laporkan tiap butir AC (lulus/gagal + bukti output), file yang diubah/dihapus, dan hal yang perlu keputusan saya. Lalu BERHENTI.
```

---

## S1 — Keamanan UI

```
Kerjakan S1 di plan-stabilisasi.md (temuan K1, K2, F1).
Catatan:
- Ini prioritas tertinggi: HTML dari server target saat ini bisa mengeksekusi kode di aplikasi.
- Satu escapeHtml di src/utils/html.js; hapus 6 salinan. Audit SEMUA innerHTML di src/ — nilai dari run/server/file wajib di-escape, termasuk di atribut.
- Snapshot HTML wajib di <iframe sandbox=""> dengan srcdoc yang di-set lewat DOM API, bukan string di innerHTML. Jangan tambahkan allow-scripts.
- Toggle "Load resources" yang sudah ada dihubungkan saja; jangan tambah opsi lain.
- Hapus requestPanel.js dan responsePanel.js setelah memastikan dengan grep tidak ada yang meng-import.
- Berikan saya langkah verifikasi manual di browser untuk AC (mis. mock yang mengembalikan HTML berbahaya).
```

## S2 — Jalur step & penyimpanan run

```
Kerjakan S2 di plan-stabilisasi.md (temuan T1–T5, T8 sisi server).
Catatan:
- Tulis test server/test/run.f5.test.js lebih dulu (harus merah), baru perbaiki sampai hijau.
- Ikuti desain di S2 apa adanya: runner memberi seq dan menulis body; IPC hanya metadata; event objek langsung (bukan log level "step" berisi string JSON).
- Hapus seluruh mekanisme snapshots/ (daftar lengkap ada di plan). snapshotPanel.js harus ikut diubah agar mengambil body via /api/run/:id/step/:seq/body — ini perubahan minimal agar UI tidak rusak, bukan redesign.
- Satu modul server/runs/execute.js dipakai run.js dan run-cli.js; jangan sisakan dua salinan switch event.
- Event done ke SSE baru dikirim setelah saveRun selesai.
```

## S3 — Lifecycle child, SSE, routing

```
Kerjakan S3 di plan-stabilisasi.md (temuan T6, T7).
Catatan:
- Registri child di server/runs/registry.js, dipakai vite-plugin.js dan execute.js; pastikan tidak ada import sirkular.
- Ini Windows: gunakan fileURLToPath/pathToFileURL, jangan merangkai "file://".
- Routing satu lapis di routes/index.js; hapus handleRunRoutes dan endpoint /run/:id/debug.
- Test stop: assert event 'exit' child benar-benar terjadi < 2 s.
- Beri saya perintah PowerShell untuk cek proses runner yatim setelah restart Vite.
```

## S4 — Transpiler

```
Kerjakan S4 di plan-stabilisasi.md (temuan T9–T14). Tahap paling rawan — TDD.
Urutan:
1. Lihat pola nyata (read-only): D:\Mandiri\KOPRA\R10.1\script\BP211_Adjustment_UDC_ST\Loadpage.c, BP601_Maker.c, globals.h. Jangan salin; buat fixture sintetis kopra-loadpage.c dan kopra-globals.h yang meniru POLA-nya.
2. Tulis golden + test import() hasil transpile (harus merah).
3. Parser: header control-flow jadi ekspresi, VariableDeclaration multi-deklarator (lokal & global), abaikan include header LoadRunner.
4. Transpiler: hapus jalur teks mentah/regex, global modul, hapus hardcode startTime, perbaiki return undefined, makro status jadi angka, strcpy/sprintf ke assignment.
5. T12: buat server/runtime/api-names.js sebagai satu-satunya daftar fungsi didukung + test sinkron dengan export vuser-api.js. JANGAN menambah fungsi runtime baru di tahap ini.
6. Golden F2 lama tidak boleh berubah kecuali karena node baru; jelaskan setiap perubahan golden.
Setelah hijau, jalankan smoke test dengan VUGEN_REAL_SCRIPTS="D:/Mandiri/KOPRA/R10.1/script" dan laporkan jumlah lulus/gagal + pesan error (tanpa menyalin isi script).
```

## S5 — Runtime

```
Kerjakan S5 di plan-stabilisasi.md (temuan R1–R8).
Catatan:
- Hanya memperbaiki fungsi yang SUDAH ADA di vuser-api.js / http-client.js / runner.js. Tidak ada fungsi VuGen baru (lr_exit, web_reg_save_param_json, dll. tetap di backlog).
- web_js_run pakai node:vm dengan timeout; SOURCES dieksekusi dulu, lalu Code utama di context yang sama.
- R6 (kapan step/action dianggap gagal) mengubah perilaku run: implementasikan sesuai plan, dan jika ada kasus yang tidak jelas, tanya saya.
- Unit test per perbaikan terhadap mock; sprintf diuji dengan tabel kasus.
```

## S6 — Loader parameter + frontend

```
Kerjakan S6 di plan-stabilisasi.md (temuan L1–L3, F2, T8 sisi UI).
Catatan:
- Bukan mesin .prm baru: hapus parsing .prm yang salah, perbaiki pembacaan .dat (header = nama kolom, multi-kolom, case-sensitive).
- Script saya mengandalkan ip.dat / subTrans.dat tanpa lr_save_string — perilaku itu harus tetap jalan.
- Frontend: sesuaikan main.js dengan bentuk event dari S2, satukan state iterasi di store. Jangan tambah panel/tab baru.
- Jika memungkinkan jalankan app dan verifikasi dengan Playwright (skill webapp-testing); jika tidak, beri saya langkah manual.
```

## S7 — Rapikan akhir

```
Kerjakan S7 di plan-stabilisasi.md.
Catatan:
- Cari export/file yang tidak dipakai dengan grep, hapus yang benar-benar mati.
- todo.md harus jujur: status F3–F6 dan S1–S7, known limitations, dan salinan §9 Backlog.
- Laporan akhir: ringkasan perubahan S1–S7 dan apa yang masih belum jalan di script KOPRA (berdasarkan smoke test S4 dan warning unsupported).
```
