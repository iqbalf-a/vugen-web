/**
 * runtime/api-names.js — Satu-satunya daftar fungsi VuGen/C yang didukung runtime.
 *
 * Dipakai transpiler: pemanggilan fungsi bernama di sini ditranspile menjadi
 * `await __vu.<nama>(...)`; selain ini (dan fungsi user) -> warning "unsupported".
 *
 * Harus sama persis dengan export `vuser-api.js` (tanpa awalan `__` dan tanpa
 * `default`); `api-names.test.js` menjaga kesinkronannya. Menambah fungsi runtime
 * berarti mengubah DUA tempat: export di vuser-api.js dan daftar ini.
 */

export const SUPPORTED_FUNCTIONS = Object.freeze([
  "atoi",
  "lr_end_timer",
  "lr_end_transaction",
  "lr_error_message",
  "lr_eval_string",
  "lr_exit",
  "lr_get_transaction_status",
  "lr_output_message",
  "lr_param_sprintf",
  "lr_save_string",
  "lr_set_transaction",
  "lr_start_timer",
  "lr_start_transaction",
  "lr_think_time",
  "sprintf",
  "strcmp",
  "strcpy",
  "strstr",
  "web_add_auto_header",
  "web_add_cookie",
  "web_add_header",
  "web_cleanup_auto_headers",
  "web_cleanup_cookies",
  "web_concurrent_end",
  "web_concurrent_start",
  "web_convert_from_formatted",
  "web_custom_request",
  "web_js_run",
  "web_reg_find",
  "web_reg_save_param",
  "web_reg_save_param_ex",
  "web_reg_save_param_json",
  "web_reg_save_param_regexp",
  "web_remove_auto_header",
  "web_rest",
  "web_revert_auto_header",
  "web_set_max_html_param_len",
  "web_set_sockets_option",
  "web_set_user",
  "web_submit_data",
  "web_submit_form",
  "web_url",
]);

export const SUPPORTED_FUNCTION_SET = new Set(SUPPORTED_FUNCTIONS);
