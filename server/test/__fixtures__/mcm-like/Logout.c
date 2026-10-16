/* Fixture sintetis: pola Logout MCM (auto header di-revert; transaksi diperiksa lalu lr_exit bila gagal). */
Logout(char* parentTrans)
{
	lr_start_transaction(parentTrans);

	web_revert_auto_header("Device-Id");

	web_remove_auto_header("X-Token",
	                       "ImplicitGen=Yes",
	                       LAST);

	web_url("logout_check",
	        "URL=http://{host}/echo-headers",
	        "Resource=0",
	        LAST);

	web_url("logout_flaky",
	        "URL=http://{host}/flaky",
	        "Resource=0",
	        LAST);

	lr_end_transaction(parentTrans, LR_AUTO);

	if (lr_get_transaction_status(parentTrans) == LR_FAIL) {
		lr_error_message("logout gagal");
		lr_exit(LR_EXIT_ITERATION_AND_CONTINUE, LR_FAIL);
	}

	lr_output_message("logout-selesai");
	return 0;
}
