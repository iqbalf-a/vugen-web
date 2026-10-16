/**
 * Sample script VuGen untuk F5 — correlation + web_submit_data.
 *
 * Flow login 3 langkah:
 * 1. web_url GET / → ambil CSRF token via web_reg_save_param
 * 2. web_submit_data POST /login dengan CSRF token
 * 3. web_url GET /dashboard → verifikasi login
 */

Action()
{
    lr_start_transaction("T01_home");

    // Register correlation to extract CSRF token from response
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

    // Login with correlation parameter
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

    // Test web_reg_find
    web_reg_find("Text=Welcome", "SaveCount=1", LAST);
    web_url("verify",
        "URL=http://127.0.0.1:18081/dashboard",
        "TargetFrame=",
        "Resource=0",
        "RecContentType=text/html",
        "Referer=",
        "Mode=HTML",
        LAST);

    return 0;
}