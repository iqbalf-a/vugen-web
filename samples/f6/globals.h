/* globals.h — deklarasi umum untuk script VuGen F6 */

#ifndef GLOBALS_H
#define GLOBALS_H

/* Fungsi bawaan VuGen yang dipakai di script */
int lr_start_transaction(const char *name);
int lr_end_transaction(const char *name, long status);
int lr_think_time(double seconds);
int lr_save_string(const char *value, const char *name);
const char *lr_eval_string(const char *str);
int lr_output_message(const char *fmt, ...);
int lr_error_message(const char *fmt, ...);

int web_url(const char *name, ...);
int web_custom_request(const char *name, ...);
int web_submit_data(const char *name, ...);
int web_submit_form(const char *name, ...);
int web_add_header(const char *name, const char *value);
int web_add_auto_header(const char *name, const char *value);
int web_reg_save_param(const char *name, ...);
int web_reg_save_param_ex(const char *name, ...);
int web_reg_save_param_regexp(const char *name, ...);
int web_reg_find(const char *text, ...);
int web_add_cookie(const char *cookie, ...);
int web_cleanup_cookies();
int web_set_user(const char *user, ...);

/* Fungsi C standar (subset F6) */
int strcmp(const char *s1, const char *s2);
int sprintf(char *str, const char *format, ...);
int atoi(const char *str);
char *strcpy(char *dest, const char *src);

/* Konstanta status transaksi */
#define LR_AUTO 0
#define LR_PASS 1
#define LR_FAIL 2

/* Makro argumen akhir */
#define LAST "LAST"
#define ITEMDATA "ITEMDATA"
#define ENDITEM "ENDITEM"
#define EXTRARES "EXTRARES"

#endif /* GLOBALS_H */