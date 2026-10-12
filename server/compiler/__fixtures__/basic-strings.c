/*
 * Fixture tokenizer: escape, concatenation, komentar, makro.
 */
#include "globals.h"

Action()
{
    // komentar satu baris
    lr_output_message("kutip=\" backslash=\\ newline=\n tab=\t hex=\x41");
    lr_output_message("gabung " /* sisipan */ "dua " "tiga");
    lr_output_message("baris satu\n"
        "baris dua");

    web_url("home",
        "URL=http://example.com",
        "Resource=0",
        LAST);

    web_link("klik", "Text=OK", ENDITEM);

    lr_save_string("abc", 'c');
    int n = 0x1F;
    n++;
    return 0;
}
