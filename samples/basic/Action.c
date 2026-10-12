Action()
{
    lr_start_transaction("T01_home");

    web_reg_save_param("csrf",
        "LB=name=\"csrf\" value=\"",
        "RB=\"",
        "Ord=1",
        LAST);

    web_url("home",
        "URL=https://example.test/",
        "TargetFrame=",
        "Resource=0",
        "RecContentType=text/html",
        "Referer=",
        "Mode=HTML",
        LAST);

    lr_end_transaction("T01_home", LR_AUTO);

    lr_think_time(2);

    web_submit_data("login",
        "Action=https://example.test/login",
        "Method=POST",
        "Mode=HTML",
        ITEMDATA,
        "Name=user", "Value=demo", ENDITEM,
        "Name=csrf", "Value={csrf}", ENDITEM,
        LAST);

    return 0;
}
