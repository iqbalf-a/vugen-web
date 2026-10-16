/* Fixture sintetis: pola Login MCM (Basic auth, correlation JSON, blok concurrent, cek transaksi + lr_exit). */
Login(char* parentTrans)
{
	lr_start_transaction(parentTrans);

	web_add_header("Authorization",
	               "Basic {basicUsername}");

	web_reg_save_param_json(
		"ParamName=kopraId",
		"QueryString=$.data.profile.kopraId",
		SEARCH_FILTERS,
		"Scope=BODY",
		LAST);

	web_reg_save_param_json(
		"ParamName=token",
		"QueryString=$..token",
		SEARCH_FILTERS,
		LAST);

	web_url("signin",
	        "URL=http://{host}/json",
	        "TargetFrame=",
	        "Resource=0",
	        "Referer=",
	        "Mode=HTML",
	        LAST);

	web_add_auto_header("X-Token",
	                    "{token}");

	web_concurrent_start(NULL);

	web_url("echo_1",
	        "URL=http://{host}/echo-headers",
	        "Resource=1",
	        LAST);

	web_url("echo_2",
	        "URL=http://{host}/echo-headers",
	        "Resource=1",
	        LAST);

	web_concurrent_end(NULL);

	lr_end_transaction(parentTrans, LR_AUTO);

	if (lr_get_transaction_status(parentTrans) == LR_FAIL) {
		lr_error_message("login gagal");
		lr_exit(LR_EXIT_ITERATION_AND_CONTINUE, LR_FAIL);
	}

	return 0;
}
