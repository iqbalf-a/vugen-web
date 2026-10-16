/* Fixture sintetis: meniru POLA Action General KOPRA (nama, URL, nilai palsu). */
Loadpage(char* parentTrans)
{
	double seq1=0, seq2=0, tempSeq=0, totalSeq=0;
	char transSeqName[256];
	char *label = "demo";
	int i, attempts = 0;

	web_set_max_html_param_len("10000");

	lr_save_string(parentTrans, "parentTrans");
	web_js_run("Code= myFunc(LR.getParam('parentTrans'));",
	           SOURCES,
	           "Code= var myFunc = function(p) { "
	           "LR.setParam('subTrans', p.slice(0, 8)); "
	           "}",
	           ENDITEM,
	           LAST);

	web_set_sockets_option("SSL_VERSION", "AUTO");
	web_add_auto_header("Accept-Language", "en-US,en;q=0.9");

	startTime = lr_start_timer();
	web_url(lr_eval_string("DEMO_{subTrans}_01_ui"),
	        "URL=https://{host}/demo/ui",
	        "TargetFrame=",
	        "Resource=0",
	        "Referer=",
	        "Snapshot=t1.inf",
	        "Mode=HTML",
	        LAST);
	tempSeq = lr_end_timer(startTime);
	seq1 = compareDuration(seq1, tempSeq);

	for (i = 0; i < 3; i++) {
		sprintf(transSeqName, "%s_%d", parentTrans, i);
		strcpy(label, transSeqName);
	}

	while (attempts < retryLimit && strcmp(lr_eval_string("{flag}"), "y") == 0)
		attempts++;

	if (lr_get_transaction_status(lr_eval_string("{transName}")) == LR_FAIL) {
		lr_error_message("transaksi gagal: %s", lr_eval_string("{transName}"));
		lr_exit(LR_EXIT_ITERATION_AND_CONTINUE, LR_FAIL);
	}

	totalSeq = seq1 + seq2;
	lr_set_transaction(lr_eval_string("{transSeqName}"), totalSeq, lr_get_transaction_status(parentTrans));
	return 0;
}
