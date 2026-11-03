void SetRpsResult(int httpCode)
{
	if (httpCode == 200 || httpCode == 409) {
		lr_set_transaction_status_by_name(LR_PASS, lr_eval_string("{transName}"));
	} else {
		lr_set_transaction_status_by_name(LR_FAIL, lr_eval_string("{transName}"));
	}
}

Action()
{
	web_set_rts_key("key=HttpErrorsAsWarnings", "Value=1", LAST);
	SetRpsResult(web_get_int_property(HTTP_INFO_RETURN_CODE));
	web_set_rts_key("key=HttpErrorsAsWarnings", "Value=0", LAST);
	return 0;
}
