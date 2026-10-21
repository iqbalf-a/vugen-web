/**
 * src/utils/vugenComplete.js — Autocomplete sources untuk editor VuGen (CodeMirror 6).
 *
 * Tiga sumber:
 *   1. Fungsi VuGen dari toolbox JSON + konstanta VuGen
 *   2. Parameter {nama} dari .prm/.dat (trigger: `{`)
 *   3. Variabel lokal C + nama dari lr_save_string (regex scan dokumen)
 */

import { autocompletion, completionKeymap, snippetCompletion } from "@codemirror/autocomplete";
import { keymap } from "@codemirror/view";

import lrAL from "../data/toolbox/lr-a-l.json";
import lrMZ from "../data/toolbox/lr-m-z.json";
import webRequest from "../data/toolbox/web-request.json";
import webCorrelation from "../data/toolbox/web-correlation.json";
import webConfig from "../data/toolbox/web-config.json";
import webStream from "../data/toolbox/web-stream-service.json";
import cOther from "../data/toolbox/c-other.json";
import cStringMem from "../data/toolbox/c-string-mem.json";

// ── 1. Fungsi VuGen dari toolbox ──────────────────────────────────────────────

const ALL_FUNS = [
  ...lrAL, ...lrMZ,
  ...webRequest, ...webCorrelation, ...webConfig, ...webStream,
  ...cOther, ...cStringMem,
];

/** Snippet templates untuk fungsi yang paling sering dipakai. */
const SNIPPETS = {
  web_url:            '"${name}", "URL=${url}", "Resource=0", LAST',
  web_custom_request: '"${name}", "URL=${url}", "Method=POST", "Body=${body}", LAST',
  web_submit_data:    '"${name}", "Action=${action}", "Method=POST", ITEMDATA, "Name=${field}", "Value=${value}", ENDITEM, LAST',
  web_rest:           '"${name}", "URL=${url}", "Method=GET", LAST',
  web_js_run:         '"File=${file}.js", "ResultParam=${result}", LAST',
  web_reg_save_param:        '"${paramName}", "LB=${lb}", "RB=${rb}", "Ord=1", LAST',
  web_reg_save_param_ex:     '"${paramName}", "LB=${lb}", "RB=${rb}", "Ord=1", LAST',
  web_reg_save_param_regexp: '"${paramName}", "RegExp=${pattern}", "Ord=1", LAST',
  web_reg_save_param_json:   '"${paramName}", "QueryString=${$.path}", "Ord=1", LAST',
  web_reg_find:              '"${checkName}", "Text=${text}", LAST',
  web_add_header:            '"${name}", "${value}"',
  web_add_auto_header:       '"${name}", "${value}"',
  web_remove_auto_header:    '"${name}", LAST',
  web_add_cookie:            '"${name}=${value}; path=/", LAST',
  web_set_user:              '"${username}", "${password}", "${realm}"',
  lr_start_transaction:      '"${name}"',
  lr_end_transaction:        '"${name}", LR_AUTO',
  lr_think_time:             '${seconds}',
  lr_save_string:            '${value}, "${paramName}"',
  lr_save_int:               '${value}, "${paramName}"',
  lr_eval_string:            '"${string}"',
  lr_output_message:         '"${message}"',
  lr_error_message:          '"${message}"',
  lr_param_sprintf:          '"${paramName}", "${format}", ${args}',
  lr_paramarr_len:           '"${paramName}"',
  lr_paramarr_idx:           '"${paramName}", ${index}',
  lr_paramarr_random:        '"${paramName}"',
  lr_exit:                   'LR_EXIT_VUSER, LR_FAIL',
  lr_start_timer:            '',
  lr_end_timer:              '${handle}',
  web_concurrent_start:      'LAST',
  web_concurrent_end:        'LAST',
};

/** Ambil satu baris pertama signature untuk detail singkat. */
function shortSig(signature) {
  if (!signature) return "";
  const paren = signature.indexOf("(");
  if (paren === -1) return signature;
  return signature.slice(paren).replace(/\s+/g, " ").trim();
}

const vugenCompletions = ALL_FUNS.map((fn) => {
  const detail = shortSig(fn.signature);
  const info = fn.description
    ? () => {
        const el = document.createElement("div");
        el.style.cssText = "max-width:340px;font-size:11px;line-height:1.5;padding:4px 0";
        el.textContent = fn.description;
        return el;
      }
    : undefined;

  const tpl = SNIPPETS[fn.name];
  if (tpl !== undefined) {
    return snippetCompletion(`${fn.name}(${tpl})`, { label: fn.name, type: "function", detail, info });
  }
  return { label: fn.name, type: "function", detail, info };
});

// ── Konstanta VuGen ───────────────────────────────────────────────────────────

const VUGEN_CONSTANTS = [
  "LAST", "ITEMDATA", "ENDITEM", "EXTRARES",
  "LR_AUTO", "LR_PASS", "LR_FAIL",
  "LR_EXIT_VUSER", "LR_EXIT_ACTION", "LR_EXIT_ACTION_AND_CONTINUE", "LR_EXIT_ITERATION_AND_CONTINUE",
  "LR_ABORT",
  "ACTION_E_FUNC_ERR",
].map((name) => ({ label: name, type: "constant" }));

function vugenSource(context) {
  const word = context.matchBefore(/\w+/);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;
  if (!/^(web_|lr_|LR_|LAST|ITEM|ENDIT|EXTRA|ACTION)/.test(word.text) && !context.explicit) return null;
  return {
    from: word.from,
    options: [...vugenCompletions, ...VUGEN_CONSTANTS],
    validFor: /^\w*$/,
  };
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
    if (/^(web_|lr_|LR_|LAST|ITEM|ENDIT|EXTRA|ACTION)/.test(word.text)) return null;
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
