/**
 * src/utils/vugenComplete.js — Autocomplete sources untuk editor VuGen (CodeMirror 6).
 *
 * Tiga sumber:
 *   1. Fungsi VuGen statis (web_*, lr_*)
 *   2. Parameter {nama} dari .prm/.dat (trigger: `{`)
 *   3. Variabel lokal C + nama dari lr_save_string (regex scan dokumen)
 */

import { autocompletion, completionKeymap, snippetCompletion } from "@codemirror/autocomplete";
import { keymap } from "@codemirror/view";

// ── 1. Fungsi VuGen statis ────────────────────────────────────────────────────

const VUGEN_FUNS = [
  // HTTP requests
  { label: "web_url",            sig: '("${name}", "URL=${url}", "Resource=0", LAST)' },
  { label: "web_custom_request", sig: '("${name}", "URL=${url}", "Method=POST", "Body=${body}", LAST)' },
  { label: "web_submit_data",    sig: '("${name}", "Action=${action}", "Method=POST", ITEMDATA, "Name=${field}", "Value=${value}", ENDITEM, LAST)' },
  { label: "web_rest",           sig: '("${name}", "URL=${url}", "Method=GET", LAST)' },
  { label: "web_js_run",         sig: '("File=${file}.js", "ResultParam=${result}", LAST)' },
  // Correlation
  { label: "web_reg_save_param",        sig: '("${paramName}", "LB=${lb}", "RB=${rb}", "Ord=1", LAST)' },
  { label: "web_reg_save_param_ex",     sig: '("${paramName}", "LB=${lb}", "RB=${rb}", "Ord=1", LAST)' },
  { label: "web_reg_save_param_regexp", sig: '("${paramName}", "RegExp=${pattern}", "Ord=1", LAST)' },
  { label: "web_reg_save_param_json",   sig: '("${paramName}", "QueryString=${$.path}", "Ord=1", LAST)' },
  { label: "web_reg_find",              sig: '("${checkName}", "Text=${text}", LAST)' },
  // Headers / cookies
  { label: "web_add_header",          sig: '("${name}", "${value}")' },
  { label: "web_add_auto_header",     sig: '("${name}", "${value}")' },
  { label: "web_remove_auto_header",  sig: '("${name}", LAST)' },
  { label: "web_revert_auto_header",  sig: '("${name}")' },
  { label: "web_cleanup_auto_headers",sig: '()' },
  { label: "web_add_cookie",          sig: '("${name}=${value}; path=/", LAST)' },
  { label: "web_cleanup_cookies",     sig: '()' },
  { label: "web_set_user",            sig: '("${username}", "${password}", "${realm}")' },
  // Concurrent
  { label: "web_concurrent_start", sig: '(LAST)' },
  { label: "web_concurrent_end",   sig: '(LAST)' },
  // Transactions
  { label: "lr_start_transaction",      sig: '("${name}")' },
  { label: "lr_end_transaction",        sig: '("${name}", LR_AUTO)' },
  { label: "lr_get_transaction_status", sig: '("${name}")' },
  { label: "lr_set_transaction",        sig: '("${name}", ${duration}, LR_PASS)' },
  // Parameters
  { label: "lr_save_string",   sig: '(${value}, "${paramName}")' },
  { label: "lr_save_int",      sig: '(${value}, "${paramName}")' },
  { label: "lr_eval_string",   sig: '("${string}")' },
  { label: "lr_param_sprintf", sig: '("${paramName}", "${format}", ${args})' },
  { label: "lr_paramarr_len",  sig: '("${paramName}")' },
  { label: "lr_paramarr_idx",  sig: '("${paramName}", ${index})' },
  { label: "lr_paramarr_random", sig: '("${paramName}")' },
  // Logging / control
  { label: "lr_output_message", sig: '("${message}")' },
  { label: "lr_error_message",  sig: '("${message}")' },
  { label: "lr_think_time",     sig: '(${seconds})' },
  { label: "lr_exit",           sig: '(LR_EXIT_VUSER, LR_FAIL)' },
  { label: "lr_unmask",         sig: '("${masked}")' },
  { label: "lr_start_timer",    sig: '()' },
  { label: "lr_end_timer",      sig: '(${handle})' },
];

const vugenCompletions = VUGEN_FUNS.map(({ label, sig }) =>
  snippetCompletion(`${label}${sig}`, { label, type: "function", detail: sig }),
);

function vugenSource(context) {
  const word = context.matchBefore(/\w+/);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;
  if (!/^(web_|lr_)/.test(word.text) && !context.explicit) return null;
  return { from: word.from, options: vugenCompletions, validFor: /^\w*$/ };
}

// ── 2. Parameter {nama} dari .prm/.dat ───────────────────────────────────────

function makeParamSource(paramNames) {
  if (!paramNames.length) return () => null;
  const options = paramNames.map((name) => ({ label: name, type: "variable", detail: "{param}" }));
  return (context) => {
    const before = context.matchBefore(/\{[\w_]*/);
    if (!before) return null;
    return { from: before.from + 1, options, validFor: /^[\w_]*$/ };
  };
}

// ── 3. Variabel lokal + lr_save_string ───────────────────────────────────────

function makeVarSource(varNames) {
  if (!varNames.length) return () => null;
  const options = varNames.map((name) => ({ label: name, type: "variable" }));
  return (context) => {
    const word = context.matchBefore(/\w+/);
    if (!word || word.from === word.to) return null;
    if (/^(web_|lr_)/.test(word.text)) return null;
    return { from: word.from, options, validFor: /^\w*$/ };
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Buat extension CodeMirror 6 untuk autocomplete.
 * @param {string[]} paramNames - nama parameter dari .prm/.dat
 * @param {string[]} varNames   - variabel lokal + nama lr_save_string
 */
export function makeCompletionExtension(paramNames = [], varNames = []) {
  return [
    autocompletion({
      override: [vugenSource, makeParamSource(paramNames), makeVarSource(varNames)],
      activateOnTyping: true,
      maxRenderedOptions: 30,
    }),
    keymap.of(completionKeymap),
  ];
}

/**
 * Ekstrak nama variabel C dan parameter lr_save_string dari teks dokumen.
 * @param {Iterable<string>} docTexts
 * @returns {string[]}
 */
export function extractSymbols(docTexts) {
  const names = new Set();
  const varRe = /\b(?:char|int|BOOL|double|float|long)\s+\*?\s*(\w+)\b/g;
  const saveRe = /lr_save_(?:string|int)\s*\([^,]+,\s*"(\w+)"/g;
  for (const text of docTexts) {
    for (const re of [varRe, saveRe]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) names.add(m[1]);
    }
  }
  return [...names];
}
