/**
 * vuser-api.js — Implementasi fungsi VuGen inti (plan §7.1).
 *
 * Fungsi ini di-bind ke objek `__vu` di runner.js, lalu dipanggil
 * oleh kode hasil transpile lewat `await __vu.web_url(...)`.
 *
 * Semua argumen string sudah melewati substitusi `{param}` di runner
 * (plan §7.2: substitusi runtime, bukan compile-time).
 *
 * Fungsi yang belum didukung diarahkan ke `__unsupportedCall` oleh transpiler.
 */

import vm from "node:vm";

import { decodeBody, saveStepBody } from "../runs/store.js";
import { compileJsonPath, queryJsonPath } from "./jsonpath.js";
import { formatPrintf } from "./printf.js";

/** @typedef {import("./http-client.js").ResponseInfo} ResponseInfo */

/**
 * @typedef {Object} VuContext
 * @property {HttpClient} http
 * @property {Map<string, string>} params - Parameter runtime (lr_save_string, correlation)
 * @property {Map<string, { startMs: number, failed: boolean }>} transactions - transaksi terbuka (urutan = urutan dibuka)
 * @property {Map<string, "Pass"|"Fail">} transactionResults - hasil transaksi yang sudah selesai
 * @property {number} seq - counter step (runner), mulai 0
 * @property {number} runStartMs - epoch ms awal run
 * @property {string} cacheDir
 * @property {string} runId
 * @property {number} currentIteration
 * @property {Function} sendEvent - (type, data) => void
 * @property {string} currentFile
 * @property {number} currentLine
 * @property {Function} log - (level, msg) => void
 * @property {Function} __at - (file, line) => void
 * @property {Function} __unsupported - (raw, file, line) => void
 * @property {Function} __unsupportedCall - (name, file, line) => void
 * @property {Object} runOptions - { thinkTime: "ignore"|"run", insecureTLS: boolean, timeoutMs: number }
 */

/** @type {VuContext} */
let ctx = null;

/** Correlation registry: array of { name, lb, rb, ord, regexp, saveParam } */
const correlationRegistry = [];

/** web_reg_find registry: array of { text, saveCount } */
const webRegFindRegistry = [];

/**
 * Bind context dari runner.
 * @param {VuContext} c
 */
export function __bind(c) {
  ctx = c;
}

/** Helper: throw jika context belum siap */
function needCtx() {
  if (!ctx) throw new Error("vuser-api: context not bound (call __bind first)");
  return ctx;
}

/** Set parameter (lr_save_string) */
export function lr_save_string(value, name) {
  const { params, log } = needCtx();
  params.set(name, String(value ?? ""), "lr_save_string");
  log("info", `lr_save_string: ${name} = "${params.get(name)}"`);
  return 0;
}

/** Set parameter dari nilai integer (lr_save_int) — disimpan sebagai string desimal */
export function lr_save_int(value, name) {
  const { params, log } = needCtx();
  params.set(name, String(Math.trunc(Number(value)) || 0), "lr_save_int");
  log("info", `lr_save_int: ${name} = "${params.get(name)}"`);
  return 0;
}

/** Jumlah elemen array parameter: baca {name}_count */
export function lr_paramarr_len(name) {
  const { params } = needCtx();
  return Number(params.get(`${name}_count`)) || 0;
}

/** Nilai elemen ke-i (1-based): baca {name}_i */
export function lr_paramarr_idx(name, index) {
  const { params } = needCtx();
  return params.get(`${name}_${index}`) ?? "";
}

/** Indeks acak 1..count; 0 bila array kosong */
export function lr_paramarr_random(name) {
  const { params } = needCtx();
  const count = Number(params.get(`${name}_count`)) || 0;
  if (count <= 0) return 0;
  return Math.floor(Math.random() * count) + 1;
}

/** Evaluasi parameter (lr_eval_string) — substitusi {param} */
export function lr_eval_string(str) {
  const { params } = needCtx();
  if (typeof str !== "string") return String(str ?? "");
  return str.replace(/\{([^}]+)\}/g, (_, key) => params.get(key) ?? `{${key}}`);
}

/** Output message ke log (format printf) */
export function lr_output_message(fmt, ...args) {
  needCtx().log("info", formatPrintf(fmt, args));
  return 0;
}

/** Error message ke log (format printf) */
export function lr_error_message(fmt, ...args) {
  needCtx().log("error", formatPrintf(fmt, args));
  return 0;
}

/**
 * lr_unmask — dekode string yang dimasking oleh VuGen (dipakai untuk password web_set_user).
 *
 * Algoritme: setiap pasangan hex → byte, XOR dengan (posisi + 1), stop di null byte.
 * Ini adalah pendekatan yang paling umum dilaporkan; jika hasil tidak terbaca (karakter
 * di luar printable ASCII), fungsi mengembalikan string kosong dan mencatat warning.
 *
 * Jika algoritme ini tidak cocok dengan versi LoadRunner yang dipakai untuk membuat script,
 * buat file `lr_unmask.json` di folder script dengan pemetaan:
 *   { "<masked_value>": "<password_asli>" }
 */
export function lr_unmask(masked) {
  const { log, unmaskMap } = needCtx();
  if (typeof masked !== "string" || masked.length === 0) return "";

  // Override dari lr_unmask.json (dimuat runner saat start, null = tidak ada file)
  if (unmaskMap && Object.prototype.hasOwnProperty.call(unmaskMap, masked)) {
    log("debug", `lr_unmask: override dari lr_unmask.json`);
    return String(unmaskMap[masked]);
  }

  // Algoritme dekode: hex pairs XOR posisi+1
  if (!/^[0-9a-fA-F]+$/.test(masked) || masked.length % 2 !== 0) {
    log("warn", `lr_unmask: format tidak dikenal (bukan hex genap): "${masked.substring(0, 20)}"`);
    return "";
  }
  let result = "";
  for (let i = 0; i < masked.length; i += 2) {
    const byte = parseInt(masked.substring(i, i + 2), 16);
    const key = (i / 2 + 1) & 0xFF;
    const c = byte ^ key;
    if (c === 0) break; // null terminator
    result += String.fromCharCode(c);
  }

  if (result && /^[\x20-\x7E]+$/.test(result)) {
    log("debug", `lr_unmask: dekode berhasil`);
    return result;
  }

  log("warn", `lr_unmask: tidak bisa mendekode — algoritme mungkin berbeda dari versi LoadRunner yang dipakai. Sediakan lr_unmask.json di folder script: {"${masked}": "<password_asli>"}`);
  return "";
}

/** lr_param_sprintf(paramName, format, ...args) — simpan hasil format printf ke parameter */
export function lr_param_sprintf(paramName, format, ...args) {
  const { params, log } = needCtx();
  const value = formatPrintf(format, args);
  params.set(String(paramName), value, "lr_param_sprintf");
  log("info", `lr_param_sprintf: ${paramName} = "${value}"`);
  return 0;
}

/** Think time */
export function lr_think_time(seconds) {
  const { runOptions, log } = needCtx();
  const secs = Number(seconds) || 0;
  if (runOptions.thinkTime === "run" && secs > 0) {
    log("info", `lr_think_time: sleeping ${secs}s`);
    return new Promise((resolve) => setTimeout(resolve, secs * 1000));
  }
  log("info", `lr_think_time: ignored (${secs}s)`);
  return Promise.resolve(0);
}

/** Nama transaksi terbuka paling dalam (dibuka paling akhir), atau null */
function innermostTransaction() {
  const open = [...needCtx().transactions.keys()];
  return open.length > 0 ? open[open.length - 1] : null;
}

/** Tandai semua transaksi yang sedang terbuka gagal (step gagal di dalamnya) */
function markTransactionsFailed() {
  for (const transaction of needCtx().transactions.values()) transaction.failed = true;
}

/** Status eksplisit LR_PASS / LR_FAIL (angka atau string lama) -> "Pass" | "Fail"; selain itu null (LR_AUTO) */
function explicitTransactionStatus(status) {
  if (status === 0 || status === "0" || status === "LR_PASS") return "Pass";
  if (status === 1 || status === "1" || status === "LR_FAIL") return "Fail";
  return null;
}

/** Start transaction (boleh bersarang) */
export function lr_start_transaction(name) {
  const { transactions, transactionResults, log } = needCtx();
  if (transactions.has(name)) log("warn", `lr_start_transaction: transaksi "${name}" sudah terbuka; dimulai ulang`);
  transactions.set(name, { startMs: Date.now(), failed: false });
  transactionResults.delete(name);
  log("info", `lr_start_transaction: ${name}`);
  return 0;
}

/**
 * End transaction. `LR_AUTO` (2) -> Pass/Fail sesuai ada tidaknya step gagal sejak start;
 * `LR_PASS` (0) / `LR_FAIL` (1) dihormati. Angka maupun string lama ("LR_FAIL") diterima.
 */
export function lr_end_transaction(name, status = 2) {
  const c = needCtx();
  const transaction = c.transactions.get(name);
  if (!transaction) {
    c.log("warn", `lr_end_transaction: transaksi "${name}" tidak sedang terbuka`);
    return 1;
  }

  const durationMs = Date.now() - transaction.startMs;
  const result = explicitTransactionStatus(status) ?? (transaction.failed ? "Fail" : "Pass");
  c.transactions.delete(name);
  c.transactionResults.set(name, result);

  c.log("info", `lr_end_transaction: ${name} ${result} ${durationMs}ms`);
  c.sendEvent("transaction", { iteration: c.currentIteration || 1, name, status: result, durationMs });
  return 0;
}

/**
 * Tutup semua transaksi yang masih terbuka dan catat hasilnya.
 * @param {boolean} forceFail true: semua jadi Fail; false: Pass/Fail otomatis per transaksi
 * @param {string} reason alasan untuk log
 */
function closeOpenTransactions(forceFail, reason) {
  const c = needCtx();
  for (const [name, transaction] of c.transactions) {
    const durationMs = Date.now() - transaction.startMs;
    const result = forceFail || transaction.failed ? "Fail" : "Pass";
    c.transactionResults.set(name, result);
    c.log("warn", `Transaksi "${name}" ditutup sebagai ${result} karena ${reason}`);
    c.sendEvent("transaction", { iteration: c.currentIteration || 1, name, status: result, durationMs });
  }
  c.transactions.clear();
}

/** Dipanggil runner saat iterasi berhenti karena error: transaksi yang masih terbuka dicatat `Fail`. */
export function __failOpenTransactions() {
  closeOpenTransactions(true, "iterasi berhenti karena error");
}

/** Dipanggil runner saat iterasi diakhiri `lr_exit`: `Fail` bila statusnya LR_FAIL, selain itu otomatis per transaksi. */
export function __endOpenTransactionsOnExit(status) {
  closeOpenTransactions(status === 1, "lr_exit");
}

/** LR_FAIL (1) bila transaksi itu gagal (terbuka atau sudah selesai), selain itu LR_PASS (0) */
export function lr_get_transaction_status(name) {
  const { transactions, transactionResults } = needCtx();
  const open = transactions.get(name);
  if (open) return open.failed ? 1 : 0;
  return transactionResults.get(name) === "Fail" ? 1 : 0;
}

/** Catat transaksi langsung: durasi dalam detik (seperti LoadRunner), status LR_PASS/LR_FAIL (LR_AUTO -> Pass) */
export function lr_set_transaction(name, duration, status = 2) {
  const c = needCtx();
  const result = explicitTransactionStatus(status) ?? "Pass";
  const durationMs = Math.round((Number(duration) || 0) * 1000 * 1000) / 1000; // detik -> ms (3 desimal)
  c.transactionResults.set(name, result);
  c.log("info", `lr_set_transaction: ${name} ${result} ${durationMs}ms`);
  c.sendEvent("transaction", { iteration: c.currentIteration || 1, name, status: result, durationMs });
  return 0;
}

const EXIT_MODE_NAMES = ["LR_EXIT_VUSER", "LR_EXIT_ACTION_AND_CONTINUE", "LR_EXIT_ITERATION_AND_CONTINUE", "LR_EXIT_VUSER_AFTER_ITERATION", "LR_EXIT_VUSER_AFTER_ACTION"];
const EXIT_STATUS_NAMES = ["LR_PASS", "LR_FAIL", "LR_AUTO"];

/**
 * Sinyal `lr_exit` yang menghentikan unit (iterasi/action) saat ini. BUKAN Error biasa:
 * runner (`runUnit`) menanganinya sebagai akhir normal unit dengan status dari `status`.
 */
export class __VuserExit {
  /** @param {number} mode 0..2 @param {number} status 0=PASS 1=FAIL 2=AUTO */
  constructor(mode, status) {
    this.mode = mode;
    this.status = status;
  }
}

/** Mode/status (angka atau nama string lama) -> indeks, atau -1 */
function exitIndex(value, names) {
  if (typeof value === "string" && names.includes(value)) return names.indexOf(value);
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < names.length ? n : -1;
}

/**
 * lr_exit — keluar dari iterasi/action/Vuser.
 * - ITERATION_AND_CONTINUE (2) / ACTION_AND_CONTINUE (1): akhiri iterasi ini, lanjut iterasi berikutnya.
 * - VUSER (0): hentikan iterasi tersisa dan langsung ke vuser_end.
 * - VUSER_AFTER_ITERATION (3) / VUSER_AFTER_ACTION (4): selesaikan iterasi ini (kode setelah lr_exit tetap
 *   jalan), lalu tidak ada iterasi baru; vuser_end tetap jalan.
 * Status: LR_FAIL (1) = iterasi failed, LR_PASS (0) = passed, LR_AUTO (2, default) = failed bila ada step gagal.
 */
export function lr_exit(mode, status = 2) {
  const c = needCtx();
  const modeIndex = exitIndex(mode, EXIT_MODE_NAMES);
  if (modeIndex < 0) return concludeFailure("lr_exit", "", `mode tidak dikenal: ${mode}`);
  const statusIndex = Math.max(0, exitIndex(status, EXIT_STATUS_NAMES) === -1 ? 2 : exitIndex(status, EXIT_STATUS_NAMES));

  c.log("info", `lr_exit: ${EXIT_MODE_NAMES[modeIndex]} ${EXIT_STATUS_NAMES[statusIndex]}`);
  if (modeIndex >= 3) {
    c.exitRequest = { mode: modeIndex, status: statusIndex };
    return 0;
  }
  throw new __VuserExit(modeIndex, statusIndex);
}

/** Header permanen (web_add_auto_header): dikirim di setiap request sampai dibersihkan */
const autoHeaders = new Map();
/** Header sekali pakai (web_add_header): hanya untuk request berikutnya */
const nextHeaders = new Map();

export function web_add_header(name, value) {
  const { log } = needCtx();
  const resolved = substituteParams(String(value ?? "")); // {param} disubstitusi saat fungsi dipanggil (seperti VuGen)
  nextHeaders.set(String(name).toLowerCase(), resolved);
  log("info", `web_add_header: ${name} = ${resolved}`);
  return 0;
}

export function web_add_auto_header(name, value) {
  const { log } = needCtx();
  const resolved = substituteParams(String(value ?? "")); // {param} disubstitusi saat fungsi dipanggil (seperti VuGen)
  autoHeaders.set(String(name).toLowerCase(), resolved);
  log("info", `web_add_auto_header: ${name} = ${resolved}`);
  return 0;
}

/** Hapus semua auto header */
export function web_cleanup_auto_headers() {
  autoHeaders.clear();
  return 0;
}

/**
 * web_remove_auto_header — cabut auto header (nama case-insensitive). Header sekali pakai tidak terpengaruh.
 * Argumen: "Nama-Header", [atribut], LAST. `ImplicitGen=` (header hasil rekaman) diabaikan dengan warning.
 */
export function web_remove_auto_header(name, ...rest) {
  const { log } = needCtx();
  for (const arg of rest) {
    if (arg === "LAST") break;
    if (typeof arg === "string" && arg.includes("=")) log("warn", `web_remove_auto_header("${name}"): atribut ${arg.split("=")[0]} diabaikan`);
  }
  const removed = autoHeaders.delete(String(name).toLowerCase());
  log("info", `web_remove_auto_header: ${name}${removed ? "" : " (tidak ada)"}`);
  return 0;
}

/**
 * web_revert_auto_header — kembalikan header ke perilaku awal. Runtime ini tidak membuat header implisit,
 * jadi artinya sama dengan mencabut auto header yang ditambahkan script.
 */
export function web_revert_auto_header(name) {
  const { log } = needCtx();
  const removed = autoHeaders.delete(String(name).toLowerCase());
  log("info", `web_revert_auto_header: ${name}${removed ? "" : " (tidak ada)"}`);
  return 0;
}

/**
 * Gabungkan header request: auto < next < eksplisit (argumen fungsi web_*).
 * `consume`: kosongkan header sekali pakai (dipanggil tepat saat request dikirim).
 *
 * @param {Record<string, string>} explicit
 * @param {{ consume?: boolean }} [options]
 */
function mergeRequestHeaders(explicit = {}, { consume = false } = {}) {
  const headers = { ...Object.fromEntries(autoHeaders), ...Object.fromEntries(nextHeaders), ...explicit };
  if (consume) nextHeaders.clear();
  return headers;
}

/**
 * web_rest — REST API request (VuGen web_rest function)
 * Supports: URL, Method, Body, Header, Snapshot, LAST
 * Similar to web_custom_request but with REST-specific defaults
 */
export async function web_rest(name, ...args) {
  const { log } = needCtx();

  const opts = parseWebArgs(args);
  const url = opts.URL || opts.Url || opts.url;
  const method = (opts.Method || opts.method || "POST").toUpperCase();
  const body = opts.Body || opts.body || "";
  const snapshotName = opts.Snapshot || opts.snapshot;

  if (!url) {
    log("error", `web_rest("${name}"): missing URL`);
    return -1;
  }

  // Header eksplisit dari argumen (auto/next header digabung di sendRequest)
  const headers = {};
  if (opts.Header) {
    // Header can be array of "Name: Value" or object
    if (Array.isArray(opts.Header)) {
      for (const h of opts.Header) {
        const [key, ...valParts] = h.split(":");
        if (key && valParts.length > 0) {
          headers[key.trim().toLowerCase()] = valParts.join(":").trim();
        }
      }
    } else if (typeof opts.Header === "object") {
      for (const [key, value] of Object.entries(opts.Header)) {
        headers[key.trim().toLowerCase()] = String(value);
      }
    }
  }
  const finalUrl = substituteParams(url);
  log("info", `web_rest: ${name} ${method} -> ${finalUrl}`);

  return sendRequest({
    type: "web_rest",
    name,
    snapshotName,
    method,
    url: finalUrl,
    explicitHeaders: headers,
    defaultContentType: opts.EncType || opts.enctype || "application/json",
    body: substituteParams(body),
  });
}

/**
 * web_url — GET request sederhana.
 * Argumen: "URL=...", "TargetFrame=", "Resource=", "RecContentType=", "Referer=", "Mode=", "Snapshot=...", LAST
 */
export async function web_url(name, ...args) {
  const { log } = needCtx();

  // Parse named arguments from args array
  const opts = parseWebArgs(args);
  const url = opts.URL || opts.Url || opts.url;
  const snapshotName = opts.Snapshot || opts.snapshot;
  if (!url) {
    log("error", `web_url("${name}"): missing URL`);
    return -1;
  }

  log("info", `web_url: ${name} -> ${url}`);

  return sendRequest({ type: "web_url", name, snapshotName, method: "GET", url, explicitHeaders: opts.headers });
}

/**
 * web_custom_request — Request kustom (method, body, dll).
 * Argumen: "URL=...", "Method=...", "Body=...", "EncType=...", "Referer=", "Mode=", "Snapshot=...", LAST
 */
export async function web_custom_request(name, ...args) {
  const { log } = needCtx();

  const opts = parseWebArgs(args);
  const url = opts.URL || opts.Url || opts.url;
  const snapshotName = opts.Snapshot || opts.snapshot;
  const method = (opts.Method || opts.method || "POST").toUpperCase();
  const body = opts.Body || opts.body || "";
  const encType = opts.EncType || opts.enctype || "application/x-www-form-urlencoded";

  if (!url) {
    log("error", `web_custom_request("${name}"): missing URL`);
    return -1;
  }

  log("info", `web_custom_request: ${name} ${method} -> ${url}`);

  return sendRequest({
    type: "web_custom_request",
    name,
    snapshotName,
    method,
    url,
    explicitHeaders: opts.headers,
    defaultContentType: encType,
    body: substituteParams(body),
  });
}

/**
 * web_submit_data — POST dengan data ITEMDATA/ENDITEM.
 * Argumen: "Action=...", "Method=...", "Mode=...", ITEMDATA, "Name=...", "Value=...", ENDITEM, ..., LAST
 */
export async function web_submit_data(name, ...args) {
  const { log } = needCtx();

  const opts = parseWebArgs(args);
  const url = opts.Action || opts.URL || opts.Url || opts.url;
  const method = (opts.Method || opts.method || "POST").toUpperCase();

  if (!url) {
    log("error", `web_submit_data("${name}"): missing Action/URL`);
    return -1;
  }

  // Parse ITEMDATA/ENDITEM pairs from remaining args
  const formData = [];
  let inItemData = false;
  let currentName = null;

  for (const arg of args) {
    if (arg === "LAST" || arg === '"LAST"') break;
    if (arg === "ITEMDATA" || arg === '"ITEMDATA"') {
      inItemData = true;
      continue;
    }
    if (arg === "ENDITEM" || arg === '"ENDITEM"') {
      currentName = null;
      continue;
    }
    if (!inItemData) continue;
    if (typeof arg !== "string") continue;

    const eq = arg.indexOf("=");
    if (eq <= 0) continue;
    const key = arg.slice(0, eq).trim();
    const value = arg.slice(eq + 1).trim();

    if (key === "Name") {
      currentName = value;
    } else if (key === "Value" && currentName !== null) {
      formData.push({ name: currentName, value });
      currentName = null;
    }
  }

  const contentType = mergeRequestHeaders(opts.headers)["content-type"] || "application/x-www-form-urlencoded";

  // Build body
  let body = "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    body = formData.map(f => `${encodeURIComponent(f.name)}=${encodeURIComponent(substituteParams(f.value))}`).join("&");
  } else if (contentType.includes("multipart/form-data")) {
    log("warn", `web_submit_data: multipart/form-data not fully supported, using urlencoded`);
    body = formData.map(f => `${encodeURIComponent(f.name)}=${encodeURIComponent(substituteParams(f.value))}`).join("&");
  }

  log("info", `web_submit_data: ${name} ${method} -> ${url} (${formData.length} fields)`);

  return sendRequest({
    type: "web_submit_data",
    name,
    snapshotName: opts.Snapshot,
    method,
    url,
    explicitHeaders: opts.headers,
    defaultContentType: contentType,
    body,
  });
}

/**
 * web_submit_form — Simplified form submission.
 * Argumen: "Action=...", "Method=...", "Mode=...", ITEMDATA, "Name=...", "Value=...", ENDITEM, ..., LAST
 */
export async function web_submit_form(name, ...args) {
  return web_submit_data(name, ...args);
}

/**
 * web_reg_save_param — Register correlation rule (left/right boundary).
 * Argumen: "LB=...", "RB=...", "Ord=...", "SaveParam=...", LAST
 */
export function web_reg_save_param(paramName, ...args) {
  const { log } = needCtx();
  const opts = parseWebArgs(args);

  const rule = {
    name: paramName,
    lb: opts.LB || opts.lb || "",
    rb: opts.RB || opts.rb || "",
    ord: parseInt(opts.Ord || opts.ord || "1", 10),
    regexp: null,
    saveParam: opts.SaveParam || opts.saveparam || paramName,
  };

  correlationRegistry.push(rule);
  log("info", `web_reg_save_param: registered "${paramName}" LB="${rule.lb}" RB="${rule.rb}" Ord=${rule.ord}`);
  return 0;
}

/**
 * web_reg_save_param_ex — Extended correlation (supports regexp).
 * Argumen: "ParamName=...", "LB=...", "RB=...", "RegExp=...", "Ord=...", LAST
 */
export function web_reg_save_param_ex(...args) {
  const { log } = needCtx();
  const opts = parseWebArgs(args);

  const paramName = opts.ParamName || opts.paramname;
  if (!paramName) {
    log("error", `web_reg_save_param_ex: missing ParamName`);
    return -1;
  }

  const rule = {
    name: paramName,
    lb: opts.LB || opts.lb || "",
    rb: opts.RB || opts.rb || "",
    ord: parseInt(opts.Ord || opts.ord || "1", 10),
    regexp: opts.RegExp || opts.regexp || null,
    saveParam: opts.SaveParam || opts.saveparam || paramName,
  };

  correlationRegistry.push(rule);
  log("info", `web_reg_save_param_ex: registered "${paramName}" ${rule.regexp ? `RegExp="${rule.regexp}"` : `LB="${rule.lb}" RB="${rule.rb}"`} Ord=${rule.ord}`);
  return 0;
}

/**
 * web_reg_save_param_regexp — Regex-based correlation.
 * Argumen: "ParamName=...", "RegExp=...", "Ord=...", LAST
 */
export function web_reg_save_param_regexp(...args) {
  const { log } = needCtx();
  const opts = parseWebArgs(args);

  const paramName = opts.ParamName || opts.paramname;
  const regexp = opts.RegExp || opts.regexp;
  if (!paramName || !regexp) {
    log("error", `web_reg_save_param_regexp: missing ParamName or RegExp`);
    return -1;
  }

  const rule = {
    name: paramName,
    lb: "",
    rb: "",
    ord: parseInt(opts.Ord || opts.ord || "1", 10),
    regexp,
    saveParam: opts.SaveParam || opts.saveparam || paramName,
  };

  correlationRegistry.push(rule);
  log("info", `web_reg_save_param_regexp: registered "${paramName}" RegExp="${regexp}" Ord=${rule.ord}`);
  return 0;
}

/** Atribut web_reg_save_param_json yang dikenal; lainnya diabaikan dengan warning */
const JSON_PARAM_ATTRIBUTES = new Set(["ParamName", "QueryString", "Scope", "SelectAll", "NotFound", "Ordinal"]);

/**
 * web_reg_save_param_json — Register correlation dari body JSON (berlaku untuk request berikutnya).
 * Argumen: "ParamName=x", "QueryString=<jsonpath>", SEARCH_FILTERS, "Scope=BODY", ["SelectAll=Yes|No"],
 *   ["NotFound=Error|Warning"], ["Ordinal=n"], LAST
 * JSONPath subset: $, .nama, ..nama, [n], [*], ['nama'] (lihat jsonpath.js).
 * `Scope=ALL` (dipakai script KOPRA) diperlakukan sebagai BODY; scope lain diabaikan dengan warning.
 */
export function web_reg_save_param_json(...args) {
  const { log } = needCtx();
  const opts = parseWebArgs(args);

  const name = opts.ParamName;
  const query = opts.QueryString;
  if (!name) return concludeFailure("web_reg_save_param_json", "", "atribut ParamName wajib");
  if (!query) return concludeFailure("web_reg_save_param_json", "", `atribut QueryString wajib (ParamName=${name})`);

  let segments;
  try {
    segments = compileJsonPath(query);
  } catch (error) {
    return concludeFailure("web_reg_save_param_json", "", `ParamName=${name}: ${error.message}`);
  }

  for (const key of Object.keys(opts)) {
    if (key !== "headers" && !JSON_PARAM_ATTRIBUTES.has(key)) log("warn", `web_reg_save_param_json "${name}": atribut ${key} tidak dikenal; diabaikan`);
  }

  const scope = String(opts.Scope ?? "BODY").toUpperCase();
  if (scope !== "BODY" && scope !== "ALL") log("warn", `web_reg_save_param_json "${name}": Scope=${opts.Scope} belum didukung; memakai BODY`);

  let selectAll = /^yes$/i.test(opts.SelectAll ?? "");
  let ordinal = 1;
  if (opts.Ordinal !== undefined) {
    if (/^all$/i.test(opts.Ordinal)) selectAll = true;
    else if (/^[1-9]\d*$/.test(opts.Ordinal)) ordinal = Number(opts.Ordinal);
    else log("warn", `web_reg_save_param_json "${name}": Ordinal=${opts.Ordinal} tidak valid; memakai 1`);
  }

  correlationRegistry.push({
    kind: "json",
    name,
    query,
    segments,
    selectAll,
    ordinal,
    notFoundIsError: !/^warning$/i.test(opts.NotFound ?? ""),
  });
  log("info", `web_reg_save_param_json: registered "${name}" QueryString=${query}${selectAll ? " SelectAll=Yes" : ordinal > 1 ? ` Ordinal=${ordinal}` : ""}`);
  return 0;
}

/**
 * web_reg_find — Register content check.
 * Argumen: "Text=...", "SaveCount=...", LAST
 */
export function web_reg_find(...args) {
  const { log } = needCtx();
  const opts = parseWebArgs(args);

  const text = opts.Text || opts.text;
  if (!text) {
    log("error", `web_reg_find: missing Text`);
    return -1;
  }

  const rule = {
    text: substituteParams(text),
    saveCount: opts.SaveCount || opts.savecount || null,
  };

  webRegFindRegistry.push(rule);
  log("info", `web_reg_find: registered Text="${rule.text}"`);
  return 0;
}

/**
 * web_add_cookie — Add cookie to jar.
 * Argumen: "name=value; DOMAIN=host; PATH=/; ...", LAST
 * `{param}` disubstitusi; DOMAIN= menentukan host konteks (fallback: URL request terakhir).
 */
export async function web_add_cookie(...args) {
  const { http, log } = needCtx();
  const raw = args[0];
  if (!raw || typeof raw !== "string") {
    log("error", `web_add_cookie: missing cookie string`);
    return -1;
  }

  const cookieStr = substituteParams(raw);
  const domain = /(?:^|;)\s*domain\s*=\s*([^;\s]+)/i.exec(cookieStr)?.[1]?.replace(/^\./, "");
  const secure = /(?:^|;)\s*secure\s*(?:;|$)/i.test(cookieStr);
  const url = domain ? `${secure ? "https" : "http"}://${domain}/` : http.lastUrl || "http://localhost/";

  const result = await http.addCookie(cookieStr, url);
  if (!result.ok) {
    log("warn", `web_add_cookie ditolak: ${result.error} (${cookieStr})`);
    return -1;
  }
  log("info", `web_add_cookie: ${cookieStr}`);
  return 0;
}

/**
 * web_cleanup_cookies — Clear cookie jar.
 */
export function web_cleanup_cookies() {
  const { http, log } = needCtx();
  http.clearCookies();
  log("info", `web_cleanup_cookies: cleared`);
  return 0;
}

/**
 * web_set_user — Set user credentials (basic auth).
 * Argumen: "username:password", "host:port", LAST
 */
export function web_set_user(...args) {
  const { log } = needCtx();
  const credentials = args[0];
  const host = args[1];
  log("info", `web_set_user: ${credentials} @ ${host} (stored for future requests)`);
  return 0;
}

/** Parse argumen style VuGen: "Key=Value", "Key=Value", LAST */
function parseWebArgs(args) {
  const result = { headers: {} };
  for (const arg of args) {
    if (arg === "LAST" || arg === '"LAST"') break;
    if (typeof arg !== "string") continue;
    const eq = arg.indexOf("=");
    if (eq <= 0) continue;
    const key = arg.slice(0, eq).trim();
    const value = arg.slice(eq + 1).trim();
    // Handle known headers
    if (key.toLowerCase() === "referer") {
      if (value !== "") result.headers.referer = value; // "Referer=" kosong: tidak ada header
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Substitute {param} in string using current params */
function substituteParams(str) {
  if (typeof str !== "string") return str;
  const { params } = needCtx();
  return str.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key) => {
    const val = params.get(key);
    if (val === undefined) {
      needCtx().log("warn", `Parameter "{${key}}" not found, leaving as-is`);
      return match;
    }
    return val;
  });
}

/** Panjang maksimum nilai variabel C yang dikirim ke UI */
const VAR_VALUE_MAX = 300;

/** Nilai variabel C -> teks untuk tabel (angka apa adanya, string dipotong, larik/objek sebagai JSON ringkas) */
function formatCValue(value) {
  let text;
  if (value === null || value === undefined) text = "NULL";
  else if (typeof value === "boolean") text = value ? "1" : "0";
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  return text.length > VAR_VALUE_MAX ? `${text.slice(0, VAR_VALUE_MAX)}…` : text;
}

/** Variabel C yang terlihat di baris step saat ini: [{ name, type, value }] (kosong bila tidak ada getter) */
function captureVars(c) {
  if (typeof c.currentVars !== "function") return [];
  try {
    return c.currentVars().map(([name, value, type]) => ({ name, type, value: formatCValue(value) }));
  } catch {
    return []; // variabel belum diinisialisasi (TDZ) atau getter rusak: jangan menggagalkan step
  }
}

/** Perubahan parameter VuGen sejak step sebelumnya (kosong bila params bukan TrackedParams, mis. di unit test) */
function drainParamChanges(c) {
  return typeof c.params?.drain === "function" ? c.params.drain() : [];
}

/** Batas bodyPreview request (karakter) */
const BODY_PREVIEW_MAX = 2048;

/** Ringkas body request untuk ditampilkan (≤ 2 KB) */
function previewBody(body) {
  if (body === undefined || body === null) return "";
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
  return text.length > BODY_PREVIEW_MAX ? text.slice(0, BODY_PREVIEW_MAX) : text;
}

/** Pesan error request yang mudah dibaca (timeout, koneksi ditolak, dst.) */
function describeRequestError(error, timeoutMs) {
  if (error?.name === "AbortError") return `timeout setelah ${timeoutMs} ms`;
  const code = error?.cause?.code ?? error?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code && !message.includes(code) ? `${message} (${code})` : message;
}

/** Hasil akhir step gagal: tandai transaksi, catat log, lalu lempar kecuali continueOnError */
function concludeFailure(type, name, problem) {
  const { log, runOptions } = needCtx();
  const label = name ? `${type} "${name}"` : type;
  markTransactionsFailed();
  needCtx().stepFailures = (needCtx().stepFailures ?? 0) + 1;
  log("error", `${label} gagal: ${problem}`);
  if (runOptions.continueOnError) return 1; // LR_FAIL, script lanjut
  throw new Error(`${label}: ${problem}`);
}

/**
 * Kirim request lalu proses response. Satu jalur untuk semua web_* yang melakukan request.
 *
 * @param {{ type: string, name: string, snapshotName?: string, method: string, url: string,
 *   explicitHeaders?: Record<string, string>, defaultContentType?: string, body?: string }} spec
 */
async function sendRequest({ type, name, snapshotName, method, url, explicitHeaders = {}, defaultContentType, body }) {
  const c = needCtx();
  const finalUrl = substituteParams(url);
  const headers = mergeRequestHeaders(explicitHeaders, { consume: true });
  if (body && defaultContentType && !headers["content-type"]) headers["content-type"] = defaultContentType;

  let resp;
  try {
    resp = await c.http.doRequest({
      method,
      url: finalUrl,
      headers,
      body: body || undefined,
      followRedirects: true,
      timeoutMs: c.runOptions.timeoutMs,
    });
  } catch (error) {
    const problem = describeRequestError(error, c.runOptions.timeoutMs);
    emitFailedRequestStep({ type, name, snapshotName, method, url: finalUrl, headers, body, problem });
    return concludeFailure(type, name, problem);
  }

  return handleResponse(name, resp, type, snapshotName);
}

/** Step untuk request yang gagal sebelum ada response (koneksi ditolak, timeout, ...) */
function emitFailedRequestStep({ type, name, snapshotName, method, url, headers, body, problem }) {
  const c = needCtx();
  // reg_* hanya berlaku untuk request berikutnya, berhasil atau tidak
  correlationRegistry.length = 0;
  webRegFindRegistry.length = 0;

  c.sendEvent("step", {
    seq: ++c.seq,
    type,
    name: substituteParams(name),
    snapshot: snapshotName || null,
    file: c.currentFile || "",
    line: c.currentLine || 0,
    iteration: c.currentIteration || 1,
    transaction: innermostTransaction(),
    request: { method, url, headers, bodyPreview: previewBody(body) },
    response: { status: 0, statusText: "", headers: {}, contentType: "", size: 0, bodyFile: "", truncated: false, redirects: [] },
    timing: { startMs: Math.max(0, Date.now() - (c.runStartMs || 0)), durationMs: 0 },
    checks: [],
    error: problem,
    params: drainParamChanges(c),
    vars: captureVars(c),
  });
}

/**
 * Ambil nilai correlation dari body. Kembalikan { value } atau { error } (regex tidak valid).
 * @param {{ regexp: string|null, lb: string, rb: string, ord: number }} rule
 * @param {string} bodyText
 */
function extractCorrelation(rule, bodyText) {
  if (rule.regexp) {
    let regex;
    try {
      regex = new RegExp(rule.regexp);
    } catch (error) {
      return { error: `RegExp tidak valid (${error.message})` };
    }
    const matches = bodyText.match(regex);
    if (matches && matches.length > rule.ord) return { value: matches[rule.ord] };
    if (matches && matches.length > 0) return { value: matches[0] };
    return { value: null };
  }

  if (rule.lb && rule.rb) {
    // Left/right boundary extraction
    let value = null;
    let startIdx = 0;
    for (let i = 0; i < rule.ord; i++) {
      const lbIdx = bodyText.indexOf(rule.lb, startIdx);
      if (lbIdx === -1) { value = null; break; }
      startIdx = lbIdx + rule.lb.length;
      const rbIdx = bodyText.indexOf(rule.rb, startIdx);
      if (rbIdx === -1) { value = null; break; }
      if (i === rule.ord - 1) value = bodyText.substring(startIdx, rbIdx);
      startIdx = rbIdx + rule.rb.length;
    }
    return { value };
  }

  return { value: null };
}

const JSON_SOURCE = "web_reg_save_param_json (JSONPath)";

/** Nilai JSON -> teks parameter (objek/array disimpan sebagai JSON ringkas) */
function jsonValueToParam(value) {
  return value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Evaluasi satu aturan web_reg_save_param_json terhadap response.
 * @param {{ name: string, query: string, segments: any[], selectAll: boolean, ordinal: number, notFoundIsError: boolean }} rule
 * @param {string[]} problems alasan step gagal (diisi bila NotFound=Error)
 */
function applyJsonRule(rule, resp, bodyText, contentType, problems) {
  const { log, params } = needCtx();

  const notFound = (reason) => {
    const message = `web_reg_save_param_json "${rule.name}": ${reason}`;
    if (rule.notFoundIsError) problems.push(message);
    else log("warn", message);
  };

  let document;
  try {
    document = JSON.parse(bodyText || decodeBody(resp.body, contentType));
  } catch {
    notFound("body response bukan JSON valid");
    return;
  }

  const matches = queryJsonPath(document, rule.segments);

  if (rule.selectAll) {
    if (matches.length === 0) return notFound(`QueryString ${rule.query} tidak ditemukan`);
    const previous = Number(params.get(`${rule.name}_count`)) || 0;
    for (let i = 1; i <= previous; i++) params.delete(`${rule.name}_${i}`);
    matches.forEach((value, index) => params.set(`${rule.name}_${index + 1}`, jsonValueToParam(value), JSON_SOURCE));
    params.set(`${rule.name}_count`, String(matches.length), JSON_SOURCE);
    log("info", `JSON correlation: ${rule.name}_count = ${matches.length}`);
    return;
  }

  if (rule.ordinal > matches.length) {
    return notFound(`QueryString ${rule.query} tidak ditemukan${rule.ordinal > 1 ? ` (Ordinal=${rule.ordinal}, ada ${matches.length} match)` : ""}`);
  }
  const value = jsonValueToParam(matches[rule.ordinal - 1]);
  params.set(rule.name, value, JSON_SOURCE);
  log("info", `JSON correlation: ${rule.name} = "${value}"`);
}

/** Handle response: simpan body, correlation, web_reg_find, kirim event step, lalu nilai sukses/gagal */
async function handleResponse(stepName, resp, type, snapshotName) {
  const c = needCtx();
  const { log, params } = c;

  // Decode body (sesuai charset di Content-Type)
  const contentType = resp.contentType || "";
  const isText = contentType.includes("text/") || contentType.includes("json") || contentType.includes("xml");
  const bodyText = isText ? decodeBody(resp.body, contentType) : "";

  /** Alasan step gagal (R6/R7) */
  const problems = [];
  if (resp.status >= 400) problems.push(`HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ""}`);

  // Process correlations: extract values and save to params
  for (const rule of correlationRegistry) {
    if (rule.kind === "json") {
      applyJsonRule(rule, resp, bodyText, contentType, problems);
      continue;
    }
    const { value, error } = extractCorrelation(rule, bodyText);
    if (error) {
      problems.push(`Correlation "${rule.name}": ${error}`);
    } else if (value !== null) {
      params.set(rule.saveParam, value, rule.regexp ? "web_reg_save_param (regexp)" : "web_reg_save_param (boundary)");
      log("info", `Correlation: ${rule.saveParam} = "${value}"`);
    } else {
      log("warn", `Correlation "${rule.name}" (save as ${rule.saveParam}) not found`);
    }
  }
  // Clear correlation registry after processing (one-time use per step)
  correlationRegistry.length = 0;

  const resolvedStepName = substituteParams(stepName);

  // Process web_reg_find
  const checks = [];
  for (const rule of webRegFindRegistry) {
    const found = bodyText.includes(rule.text);
    checks.push({ type: "web_reg_find", text: rule.text, passed: found });
    log(found ? "info" : "error", `web_reg_find: Text="${rule.text}" ${found ? "FOUND" : "NOT FOUND"}`);
    if (!found) problems.push(`web_reg_find: teks "${rule.text}" tidak ditemukan`);
  }
  webRegFindRegistry.length = 0;

  // Runner yang memberi seq dan menulis body; lewat IPC hanya metadata
  const seq = ++c.seq;
  const saved = await saveStepBody(c.cacheDir, c.runId, seq, resp.body);
  const sent = resp.request || { method: "", url: "", headers: {} };
  const error = problems.length > 0 ? problems.join("; ") : null;

  c.sendEvent("step", {
    seq,
    type,
    name: resolvedStepName,
    snapshot: snapshotName || null,
    file: c.currentFile || "",
    line: c.currentLine || 0,
    iteration: c.currentIteration || 1,
    transaction: innermostTransaction(),
    request: {
      method: sent.method,
      url: sent.url,
      headers: sent.headers,
      bodyPreview: previewBody(sent.body),
    },
    response: {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
      contentType,
      size: saved.size,
      bodyFile: saved.bodyFile,
      truncated: saved.truncated,
      redirects: resp.redirectChain || [],
    },
    timing: {
      startMs: Math.max(0, (resp.startedAt || Date.now()) - (c.runStartMs || 0)),
      durationMs: resp.durationMs || 0,
    },
    checks,
    error,
    params: drainParamChanges(c),
    vars: captureVars(c),
  });
  log("info", `${type} "${resolvedStepName}": ${resp.status} ${resp.statusText} (${resp.size} bytes)`);

  return error ? concludeFailure(type, resolvedStepName, error) : 0;
}

/**
 * web_convert_from_formatted — konversi teks ke parameter. Hanya `Extensions=Base64` yang didukung
 * (encode UTF-8 -> Base64; dipakai untuk `Authorization: Basic {param}`). Extension lain: warning, param tidak diisi.
 * Argumen: "FormattedData=...", "TargetParam=...", "Extensions=Base64", LAST
 */
export function web_convert_from_formatted(...args) {
  const { params, log } = needCtx();
  const opts = parseWebArgs(args);

  const target = opts.TargetParam;
  if (opts.FormattedData === undefined) return concludeFailure("web_convert_from_formatted", "", "atribut FormattedData wajib");
  if (!target) return concludeFailure("web_convert_from_formatted", "", "atribut TargetParam wajib");

  for (const key of Object.keys(opts)) {
    if (key !== "headers" && !["FormattedData", "TargetParam", "Extensions"].includes(key)) {
      log("warn", `web_convert_from_formatted: atribut ${key} diabaikan`);
    }
  }

  if (!/^base64$/i.test(opts.Extensions ?? "")) {
    log("warn", `web_convert_from_formatted: Extensions=${opts.Extensions ?? "(kosong)"} belum didukung (hanya Base64); ${target} tidak diisi`);
    return 1;
  }

  const value = Buffer.from(substituteParams(opts.FormattedData), "utf8").toString("base64");
  params.set(target, value, "web_convert_from_formatted");
  log("info", `web_convert_from_formatted: ${target} = "${value}"`);
  return 0;
}

/**
 * web_concurrent_start / web_concurrent_end — penanda blok request paralel di VuGen.
 * Di sini no-op: request di antaranya tetap dijalankan BERURUTAN (tidak ada eksekusi paralel).
 */
export function web_concurrent_start(...args) {
  needCtx().log("debug", `web_concurrent_start(${args.length} argumen): no-op, request tetap berurutan`);
  return 0;
}

export function web_concurrent_end(...args) {
  needCtx().log("debug", `web_concurrent_end(${args.length} argumen): no-op`);
  return 0;
}

/** Timer functions — `lr_end_timer` mengembalikan DETIK (double) seperti LoadRunner */
const timerStore = new Map();
let nextTimerHandle = 1;

export function lr_start_timer() {
  const handle = nextTimerHandle++;
  timerStore.set(handle, performance.now());
  return handle;
}

export function lr_end_timer(handle) {
  const start = timerStore.get(handle);
  if (start === undefined) return 0;
  timerStore.delete(handle);
  return (performance.now() - start) / 1000;
}

/** web_set_max_html_param_len — set max HTML parameter length */
export function web_set_max_html_param_len(len) {
  const { log } = needCtx();
  log("info", `web_set_max_html_param_len: ${len}`);
  return 0;
}

/** web_set_sockets_option — set socket options */
export function web_set_sockets_option(option, value) {
  const { log } = needCtx();
  log("info", `web_set_sockets_option: ${option} = ${value}`);
  return 0;
}

/** web_reg_async_attributes — no-op (async request attribution tidak dipakai di runtime ini) */
export function web_reg_async_attributes(..._args) {
  const { log } = needCtx();
  log("info", "web_reg_async_attributes: no-op");
  return 0;
}

/** web_stop_async — no-op */
export function web_stop_async(..._args) {
  const { log } = needCtx();
  log("info", "web_stop_async: no-op");
  return 0;
}

/** Batas waktu eksekusi satu potongan JavaScript di web_js_run */
const JS_RUN_TIMEOUT_MS = 1000;

/**
 * web_js_run — jalankan JavaScript.
 * Argumen: "Code=<kode utama>", SOURCES, "Code=<definisi>", ..., ENDITEM, LAST
 * Semua `Code=` di blok SOURCES...ENDITEM dijalankan lebih dulu, lalu kode utama,
 * dalam satu context `node:vm` (timeout 1 detik). `LR.getParam/setParam` tersedia.
 * Catatan: `vm` memisahkan scope global, bukan sandbox keamanan penuh.
 */
export async function web_js_run(...args) {
  const { log, params } = needCtx();

  let mainCode = "";
  const sources = [];
  let inSources = false;
  for (const arg of args) {
    if (arg === "LAST") break;
    if (arg === "SOURCES") { inSources = true; continue; }
    if (arg === "ENDITEM") { inSources = false; continue; }
    if (typeof arg !== "string") continue;

    if (arg.startsWith("Code=")) {
      const code = arg.slice(5);
      if (inSources) sources.push(code);
      else mainCode = code;
    } else if (arg.startsWith("File=")) {
      log("warn", `web_js_run: File= belum didukung (${arg.slice(5)})`);
    }
  }

  log("info", `web_js_run: executing JS (${sources.length} source${sources.length === 1 ? "" : "s"})`);
  const context = vm.createContext({
    LR: {
      getParam: (name) => params.get(name) ?? "",
      setParam: (name, value) => params.set(name, String(value ?? ""), "web_js_run (LR.setParam)"),
    },
  });

  try {
    for (const code of [...sources, mainCode]) {
      if (code.trim() !== "") vm.runInContext(code, context, { timeout: JS_RUN_TIMEOUT_MS });
    }
    return 0;
  } catch (error) {
    // Seperti error web_* lain, tetapi bukan step HTTP: tidak ada entri step
    return concludeFailure("web_js_run", "", error.message);
  }
}

/** Placeholder for unsupported functions */
export function __unsupportedCall(name, file, line) {
  const { log } = needCtx();
  log("warn", `Unsupported function call: ${name} at ${file}:${line}`);
  return Promise.resolve(0);
}

export function __unsupported(raw, file, line) {
  const { log } = needCtx();
  log("warn", `Unsupported statement: ${raw} at ${file}:${line}`);
  return Promise.resolve(0);
}

export function __at(file, line, vars) {
  const c = needCtx();
  c.currentFile = file;
  c.currentLine = line;
  c.currentVars = typeof vars === "function" ? vars : null; // getter variabel C yang terlihat di baris ini (hanya baris penghasil step)
}

/** Header sekali pakai dibuang saat user baru; auto header (web_add_auto_header) tetap */
export function __resetHeaders() {
  nextHeaders.clear();
}

/** C standard library functions (subset for F6) */

export function strcmp(s1, s2) {
  const str1 = String(s1 ?? "");
  const str2 = String(s2 ?? "");
  if (str1 < str2) return -1;
  if (str1 > str2) return 1;
  return 0;
}

export function strstr(haystack, needle) {
  const str = String(haystack ?? "");
  const search = String(needle ?? "");
  if (search === "") return str; // C behavior: empty needle returns haystack
  const index = str.indexOf(search);
  return index >= 0 ? str.slice(index) : null;
}

export function sprintf(format, ...args) {
  return formatPrintf(format, args);
}

export function atoi(str) {
  const num = Number.parseInt(String(str ?? ""), 10);
  return Number.isNaN(num) ? 0 : num;
}

export function strcpy(dest, src) {
  // In JS, strings are immutable, but we can simulate by returning the source
  // For lr_save_string usage: lr_save_string(strcpy(buf, "value"), "param")
  return String(src ?? "");
}
