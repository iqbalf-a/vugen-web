/**
 * Sample script VuGen untuk F3 — fungsi inti saja.
 * web_url, web_custom_request, lr_*, web_add_header
 *
 * Digunakan untuk tes manual dan CLI runner.
 */

Action()
{
    lr_start_transaction("T01_home");

    web_reg_save_param("csrf",
        "LB=name=\"csrf\" value=\"",
        "RB=\"",
        "Ord=1",
        LAST);

    web_url("home",
        "URL=http://127.0.0.1:18081/",
        "TargetFrame=",
        "Resource=0",
        "RecContentType=text/html",
        "Referer=",
        "Mode=HTML",
        LAST);

    lr_end_transaction("T01_home", LR_AUTO);

    lr_think_time(1);

    web_add_header("X-Custom-Header", "test-value");

    web_submit_data("login",
        "Action=http://127.0.0.1:18081/login",
        "Method=POST",
        "Mode=HTML",
        ITEMDATA,
        "Name=user", "Value=demo", ENDITEM,
        "Name=pass", "Value=secret", ENDITEM,
        "Name=csrf", "Value={csrf}", ENDITEM,
        LAST);

    lr_start_transaction("T02_dashboard");
    web_url("dashboard",
        "URL=http://127.0.0.1:18081/dashboard",
        "TargetFrame=",
        "Resource=0",
        "RecContentType=text/html",
        "Referer=http://127.0.0.1:18081/",
        "Mode=HTML",
        LAST);
    lr_end_transaction("T02_dashboard", LR_AUTO);

    return 0;
}