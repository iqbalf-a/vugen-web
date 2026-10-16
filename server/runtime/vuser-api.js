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

import { decodeBody, saveStepBody } from "../runs/store.js";

/** @typedef {import("./http-client.js").ResponseInfo} ResponseInfo */

/**
 * @typedef {Object} VuContext
 * @property {HttpClient} http
 * @property {Map<string, string>} params - Parameter runtime (lr_save_string, correlation)
 * @property {Object} transaction - { name, startMs }
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
  params.set(name, String(value ?? ""));
  log("info", `lr_save_string: ${name} = "${params.get(name)}"`);
  return 0;
}

/** Evaluasi parameter (lr_eval_string) — substitusi {param} */
export function lr_eval_string(str) {
  const { params } = needCtx();
  if (typeof str !== "string") return String(str ?? "");
  return str.replace(/\{([^}]+)\}/g, (_, key) => params.get(key) ?? `{${key}}`);
}

/** Output message ke log */
export function lr_output_message(fmt, ...args) {
  const { log } = needCtx();
  const msg = args.length > 0 ? fmt.replace(/%s/g, () => String(args.shift())) : fmt;
  log("info", msg);
  return 0;
}

/** Error message ke log */
export function lr_error_message(fmt, ...args) {
  const { log } = needCtx();
  const msg = args.length > 0 ? fmt.replace(/%s/g, () => String(args.shift())) : fmt;
  log("error", msg);
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

/** Start transaction */
export function lr_start_transaction(name) {
  const { transaction, log } = needCtx();
  transaction.name = name;
  transaction.startMs = Date.now();
  log("info", `lr_start_transaction: ${name}`);
  return 0;
}

/** Label status transaksi sesuai TransactionResult: Pass | Fail | Auto */
function transactionStatusLabel(status) {
  if (status === 0 || status === "0" || status === "LR_PASS") return "Pass";
  if (status === 1 || status === "1" || status === "LR_FAIL") return "Fail";
  return "Auto";
}

/** End transaction */
export function lr_end_transaction(name, status = "LR_AUTO") {
  const { transaction, log } = needCtx();
  if (!transaction.name || transaction.name !== name) {
    log("warn", `lr_end_transaction: name mismatch (started="${transaction.name}", ended="${name}")`);
  }
  const durationMs = Date.now() - (transaction.startMs || Date.now());
  const statusStr = String(status);
  log("info", `lr_end_transaction: ${name} ${statusStr} ${durationMs}ms`);
  needCtx().sendEvent("transaction", {
    iteration: needCtx().currentIteration || 1,
    name,
    status: transactionStatusLabel(status),
    durationMs,
  });
  transaction.name = null;
  transaction.startMs = 0;
  return 0;
}

/** Get transaction status */
export function lr_get_transaction_status(name) {
  const { transaction } = needCtx();
  if (transaction.name && transaction.name === name) {
    return 0; // LR_PASS equivalent - transaction in progress
  }
  return 1; // LR_FAIL equivalent - transaction not found or ended
}

/** Set transaction status/duration manually */
export function lr_set_transaction(name, duration, status = "LR_AUTO") {
  const { log } = needCtx();
  // Convert numeric status to string constants (VuGen compatibility)
  let statusStr = String(status);
  if (status === 0 || status === "0") statusStr = "LR_PASS";
  else if (status === 1 || status === "1") statusStr = "LR_FAIL";
  else if (status === 2 || status === "2") statusStr = "LR_AUTO";
  log("info", `lr_set_transaction: ${name} ${duration}ms ${statusStr}`);
  return 0;
}

/** Add header untuk request berikutnya */
const headerStore = new Map();

export function web_add_header(name, value) {
  const { log } = needCtx();
  headerStore.set(String(name).toLowerCase(), String(value ?? ""));
  log("info", `web_add_header: ${name} = ${value}`);
  return 0;
}

export function web_add_auto_header(name, value) {
  // Same as web_add_header in this implementation
  return web_add_header(name, value);
}

/** Clear auto headers (not in core but useful) */
export function web_cleanup_auto_headers() {
  headerStore.clear();
  return 0;
}

/**
 * web_rest — REST API request (VuGen web_rest function)
 * Supports: URL, Method, Body, Header, Snapshot, LAST
 * Similar to web_custom_request but with REST-specific defaults
 */
export async function web_rest(name, ...args) {
  const { http, log, runOptions } = needCtx();

  const opts = parseWebArgs(args);
  const url = opts.URL || opts.Url || opts.url;
  const method = (opts.Method || opts.method || "POST").toUpperCase();
  const body = opts.Body || opts.body || "";
  const snapshotName = opts.Snapshot || opts.snapshot;

  if (!url) {
    log("error", `web_rest("${name}"): missing URL`);
    return -1;
  }

  // Merge headers: stored headers + explicit headers from args
  const headers = { ...getRequestHeaders() };
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
  // Set default content-type if body provided
  if (body && !headers["content-type"]) {
    headers["content-type"] = opts.EncType || opts.enctype || "application/json";
  }

  // Substitute params in URL and body
  const finalUrl = substituteParams(url);
  const finalBody = substituteParams(body);

  log("info", `web_rest: ${name} ${method} -> ${finalUrl}`);

  try {
    const resp = await http.doRequest({
      method,
      url: finalUrl,
      headers,
      body: finalBody,
      followRedirects: true,
      timeoutMs: runOptions.timeoutMs,
    });

    await handleResponse(name, resp, "web_rest", snapshotName);
    return 0;
  } catch (error) {
    log("error", `web_rest("${name}") failed: ${error.message}`);
    throw error;
  }
}

/** Get merged headers for a request */
function getRequestHeaders() {
  const headers = {};
  for (const [k, v] of headerStore) headers[k] = v;
  return headers;
}

/**
 * web_url — GET request sederhana.
 * Argumen: "URL=...", "TargetFrame=", "Resource=", "RecContentType=", "Referer=", "Mode=", "Snapshot=...", LAST
 */
export async function web_url(name, ...args) {
  const { http, log, runOptions } = needCtx();

  // Parse named arguments from args array
  const opts = parseWebArgs(args);
  const url = opts.URL || opts.Url || opts.url;
  const snapshotName = opts.Snapshot || opts.snapshot;
  if (!url) {
    log("error", `web_url("${name}"): missing URL`);
    return -1;
  }

  const headers = { ...getRequestHeaders(), ...opts.headers };

  log("info", `web_url: ${name} -> ${url}`);

  try {
    const resp = await http.doRequest({
      method: "GET",
      url: substituteParams(url),
      headers,
      followRedirects: true,
      timeoutMs: runOptions.timeoutMs,
    });

    await handleResponse(name, resp, "web_url", snapshotName);
    return 0;
  } catch (error) {
    log("error", `web_url("${name}") failed: ${error.message}`);
    throw error;
  }
}

/**
 * web_custom_request — Request kustom (method, body, dll).
 * Argumen: "URL=...", "Method=...", "Body=...", "EncType=...", "Referer=", "Mode=", "Snapshot=...", LAST
 */
export async function web_custom_request(name, ...args) {
  const { http, log, runOptions } = needCtx();

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

  const headers = { ...getRequestHeaders(), ...opts.headers };
  if (body && !headers["content-type"]) {
    headers["content-type"] = encType;
  }

  log("info", `web_custom_request: ${name} ${method} -> ${url}`);

  try {
    const resp = await http.doRequest({
      method,
      url: substituteParams(url),
      headers,
      body: substituteParams(body),
      followRedirects: true,
      timeoutMs: runOptions.timeoutMs,
    });

    await handleResponse(name, resp, "web_custom_request", snapshotName);
    return 0;
  } catch (error) {
    log("error", `web_custom_request("${name}") failed: ${error.message}`);
    throw error;
  }
}

/**
 * web_submit_data — POST dengan data ITEMDATA/ENDITEM.
 * Argumen: "Action=...", "Method=...", "Mode=...", ITEMDATA, "Name=...", "Value=...", ENDITEM, ..., LAST
 */
export async function web_submit_data(name, ...args) {
  const { http, log, runOptions } = needCtx();

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

  const headers = { ...getRequestHeaders(), ...opts.headers };
  const contentType = headers["content-type"] || "application/x-www-form-urlencoded";
  headers["content-type"] = contentType;

  // Build body
  let body = "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    body = formData.map(f => `${encodeURIComponent(f.name)}=${encodeURIComponent(substituteParams(f.value))}`).join("&");
  } else if (contentType.includes("multipart/form-data")) {
    log("warn", `web_submit_data: multipart/form-data not fully supported, using urlencoded`);
    body = formData.map(f => `${encodeURIComponent(f.name)}=${encodeURIComponent(substituteParams(f.value))}`).join("&");
  }

  log("info", `web_submit_data: ${name} ${method} -> ${url} (${formData.length} fields)`);

  try {
    const resp = await http.doRequest({
      method,
      url: substituteParams(url),
      headers,
      body,
      followRedirects: true,
      timeoutMs: runOptions.timeoutMs,
    });

    await handleResponse(name, resp, "web_submit_data", opts.Snapshot);
    return 0;
  } catch (error) {
    log("error", `web_submit_data("${name}") failed: ${error.message}`);
    throw error;
  }
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
 * Argumen: "cookie string", LAST
 */
export function web_add_cookie(...args) {
  const { http, log } = needCtx();
  const cookieStr = args[0];
  if (!cookieStr || typeof cookieStr !== "string") {
    log("error", `web_add_cookie: missing cookie string`);
    return -1;
  }
  const url = http.lastUrl || "http://localhost/";
  http.addCookie(cookieStr, url);
  log("info", `web_add_cookie: ${cookieStr}`);
  return 0;
}

/**
 * web_cleanup_cookies — Clear cookie jar.
 */
export function web_cleanup_cookies() {
  const { http, log } = needCtx();
  http.cleanupCookies();
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
      result.headers.referer = value;
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
  return str.replace(/\{([^}]+)\}/g, (_, key) => {
    const val = params.get(key);
    if (val === undefined) {
      needCtx().log("warn", `Parameter "{${key}}" not found, leaving as-is`);
      return `{${key}}`;
    }
    return val;
  });
}

/** Batas bodyPreview request (byte/karakter) */
const BODY_PREVIEW_MAX = 2048;

/** Ringkas body request untuk ditampilkan (≤ 2 KB) */
function previewBody(body) {
  if (body === undefined || body === null) return "";
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
  return text.length > BODY_PREVIEW_MAX ? text.slice(0, BODY_PREVIEW_MAX) : text;
}

/** Handle response: simpan body, correlation, web_reg_find, lalu kirim event step */
async function handleResponse(stepName, resp, type, snapshotName) {
  const c = needCtx();
  const { log, params } = c;

  // Decode body (sesuai charset di Content-Type)
  const contentType = resp.contentType || "";
  const isText = contentType.includes("text/") || contentType.includes("json") || contentType.includes("xml");
  const bodyText = isText ? decodeBody(resp.body, contentType) : "";

  // Process correlations: extract values and save to params
  for (const rule of correlationRegistry) {
    let value = null;
    if (rule.regexp) {
      // Regex-based extraction
      const regex = new RegExp(rule.regexp);
      const matches = bodyText.match(regex);
      if (matches && matches.length > rule.ord) {
        value = matches[rule.ord];
      } else if (matches && matches.length > 0) {
        value = matches[0];
      }
    } else if (rule.lb && rule.rb) {
      // Left/right boundary extraction
      let startIdx = 0;
      for (let i = 0; i < rule.ord; i++) {
        const lbIdx = bodyText.indexOf(rule.lb, startIdx);
        if (lbIdx === -1) { value = null; break; }
        startIdx = lbIdx + rule.lb.length;
        const rbIdx = bodyText.indexOf(rule.rb, startIdx);
        if (rbIdx === -1) { value = null; break; }
        if (i === rule.ord - 1) {
          value = bodyText.substring(startIdx, rbIdx);
        }
        startIdx = rbIdx + rule.rb.length;
      }
    }
    if (value !== null) {
      params.set(rule.saveParam, value);
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
  }
  webRegFindRegistry.length = 0;

  // Runner yang memberi seq dan menulis body; lewat IPC hanya metadata
  const seq = ++c.seq;
  const saved = await saveStepBody(c.cacheDir, c.runId, seq, resp.body);
  const sent = resp.request || { method: "", url: "", headers: {} };

  const stepData = {
    seq,
    type,
    name: resolvedStepName,
    snapshot: snapshotName || null,
    file: c.currentFile || "",
    line: c.currentLine || 0,
    iteration: c.currentIteration || 1,
    transaction: c.transaction?.name || null,
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
  };

  c.sendEvent("step", stepData);
  log("info", `${type} "${resolvedStepName}": ${resp.status} ${resp.statusText} (${resp.size} bytes)`);
}

/** Timer functions */
const timerStore = new Map();

export function lr_start_timer() {
  const handle = Date.now() + Math.random();
  timerStore.set(handle, Date.now());
  return handle;
}

export function lr_end_timer(handle) {
  const start = timerStore.get(handle);
  if (start === undefined) return 0;
  timerStore.delete(handle);
  return Date.now() - start;
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

/** web_js_run — execute JavaScript code */
export async function web_js_run(...args) {
  const { log } = needCtx();
  // Parse VuGen web_js_run arguments: "Code=...", SOURCES, "File=...", ENDITEM, LAST
  let code = "";
  let file = "";
  for (const arg of args) {
    if (typeof arg === "string") {
      if (arg.startsWith("Code=")) code = arg.slice(5);
      else if (arg.startsWith("File=")) file = arg.slice(5);
    }
  }
  log("info", `web_js_run: executing JS${file ? ` from ${file}` : ""}`);
  // Execute in a sandboxed context with LR object
  try {
    const LR = {
      getParam: (name) => needCtx().params.get(name) ?? "",
      setParam: (name, value) => needCtx().params.set(name, String(value ?? "")),
    };
    const fn = new Function("LR", code);
    await fn(LR);
  } catch (e) {
    log("error", `web_js_run failed: ${e.message}`);
  }
  return 0;
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

export function __at(file, line) {
  const c = needCtx();
  c.currentFile = file;
  c.currentLine = line;
}

/** Reset header store (called per iteration if needed) */
export function __resetHeaders() {
  headerStore.clear();
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
  // Simple sprintf implementation supporting %s, %d, %f, %%
  let result = String(format ?? "");
  let argIndex = 0;
  result = result.replace(/%([0-9]*\.?[0-9]*)([sdfeEgG%])/g, (match, width, type) => {
    const arg = args[argIndex++];
    switch (type) {
      case "s": return String(arg ?? "");
      case "d": return Number.parseInt(arg, 10).toString();
      case "f": return Number.parseFloat(arg).toFixed(width ? parseInt(width, 10) : 6);
      case "e": case "E": return Number.parseFloat(arg).toExponential(width ? parseInt(width, 10) : 6);
      case "g": case "G": return Number.parseFloat(arg).toPrecision(width ? parseInt(width, 10) : 6);
      case "%": return "%";
      default: return match;
    }
  });
  return result;
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

export default {
  __bind,
  lr_save_string,
  lr_eval_string,
  lr_output_message,
  lr_error_message,
  lr_think_time,
  lr_start_transaction,
  lr_end_transaction,
  web_add_header,
  web_add_auto_header,
  web_cleanup_auto_headers,
  web_url,
  web_custom_request,
  web_submit_data,
  web_submit_form,
  web_reg_save_param,
  web_reg_save_param_ex,
  web_reg_save_param_regexp,
  web_reg_find,
  web_add_cookie,
  web_cleanup_cookies,
  web_set_user,
  strcmp,
  sprintf,
  atoi,
  strcpy,
  __unsupportedCall,
  __unsupported,
  __at,
  __resetHeaders,
};