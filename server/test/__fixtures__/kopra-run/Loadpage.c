/* Fixture sintetis: pola Action General KOPRA (web_js_run, timer, compareDuration, transaksi). */
Loadpage(char* parentTrans)
{
	double seq1=0, seq2=0, tempSeq=0, totalSeq=0;
	char buf[64];

	lr_save_string(parentTrans, "parentTrans");
	web_js_run("Code= myFunc(LR.getParam('parentTrans'));",
	           SOURCES,
	           "Code= var myFunc = function(p) { "
	           "LR.setParam('subTrans', p.match(/.*?_[0-9][0-9]/)); "
	           "}",
	           ENDITEM,
	           LAST);

	web_add_auto_header("Accept-Language", "id-ID");

	startTime = lr_start_timer();
	web_url(lr_eval_string("RPS_{subTrans}_01_ui"),
	        "URL=http://{host}/",
	        "Referer=",
	        "Mode=HTML",
	        LAST);
	tempSeq = lr_end_timer(startTime);
	seq1 = compareDuration(seq1, tempSeq);

	lr_start_transaction("T_ECHO");
	web_add_header("X-Once", "1");
	web_url("echo_first", "URL=http://{host}/echo-headers", LAST);
	web_url("echo_second", "URL=http://{host}/echo-headers", LAST);
	lr_end_transaction("T_ECHO", LR_AUTO);

	lr_start_transaction("T_FAIL");
	web_url("boom", "URL=http://{host}/status/500", LAST);
	lr_end_transaction("T_FAIL", LR_AUTO);
	if (lr_get_transaction_status("T_FAIL") == LR_FAIL) {
		lr_save_string("ya", "failDetected");
	}

	totalSeq = seq1 + seq2;
	sprintf(buf, "%f", totalSeq);
	lr_save_string(buf, "totalSeq");
	lr_set_transaction(lr_eval_string("{subTrans}_total"), totalSeq, lr_get_transaction_status(parentTrans));
	return 0;
}
