/* Fixture sintetis: request gagal hanya pada hit pertama ke /flaky (500), sesudahnya 200. */
Action()
{
	lr_save_string("127.0.0.1:18084", "host");
	lr_start_transaction("T_FLAKY");
	web_url("flaky", "URL=http://{host}/flaky", LAST);
	lr_end_transaction("T_FLAKY", LR_AUTO);
	return 0;
}
