/**
 * Sample script VuGen untuk F6 — parameter file + control flow.
 *
 * Fitur yang diuji:
 * - Parameter dari data/users.dat (sequential, ganti per iterasi)
 * - Control flow: if/else, for, while
 * - C functions: strcmp, sprintf, atoi, strcpy
 */

Action()
{
    int i;
    char buf[256];
    int user_count = 3;

    lr_start_transaction("T01_loop_test");

    // Test for loop
    for (i = 0; i < user_count; i++) {
        lr_output_message("Loop iteration: %d", i);

        // Test sprintf
        sprintf(buf, "user_%d", i);
        lr_output_message("sprintf result: %s", buf);

        // Test atoi
        int num = atoi("42");
        lr_output_message("atoi result: %d", num);

        // Test strcpy
        strcpy(buf, "test_string");
        lr_output_message("strcpy result: %s", buf);

        // Test strcmp
        if (strcmp(buf, "test_string") == 0) {
            lr_output_message("strcmp: strings are equal");
        } else {
            lr_output_message("strcmp: strings differ");
        }

        // Test if/else with parameter
        if (i == 1) {
            lr_output_message("Special case for i=1: user={username}");
        } else {
            lr_output_message("Normal iteration: user={username}");
        }
    }

    // Test while loop
    i = 0;
    while (i < 2) {
        lr_output_message("While loop iteration: %d", i);
        i++;
    }

    lr_end_transaction("T01_loop_test", LR_AUTO);

    // Test parameter substitution from data file
    lr_start_transaction("T02_param_test");
    web_url("param_test",
        "URL=http://127.0.0.1:18081/?user={username}&pass={password}",
        "TargetFrame=",
        "Resource=0",
        "RecContentType=text/html",
        "Referer=",
        "Mode=HTML",
        LAST);
    lr_end_transaction("T02_param_test", LR_AUTO);

    return 0;
}