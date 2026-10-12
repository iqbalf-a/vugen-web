/* Fixture control-flow: header disimpan mentah, body tetap diparse rekursif. */
Action()
{
    int i;
    for (i = 0; i < 3; i++) {
        lr_output_message("loop");
    }

    while (strcmp(lr_eval_string("{flag}"), "y") == 0)
        lr_think_time(1);

    if (strcmp(lr_eval_string("{status}"), "ok") == 0) {
        lr_output_message("sukses");
    } else {
        lr_error_message("gagal");
    }

    do {
        lr_output_message("sekali");
    } while (0);

    switch (1) {
        case 1:
            lr_output_message("satu");
            break;
    }

    return 0;
}
