/* Fixture sintetis: pola Prelogin MCM (Basic auth dari lr_param_sprintf + web_convert_from_formatted). */
Prelogin(char* parentTrans)
{
	lr_param_sprintf("usernamePassword", "%s", lr_eval_string("{username}:{password}"));

	web_convert_from_formatted(
		"FormattedData={usernamePassword}",
		"TargetParam=basicUsername",
		"Extensions=Base64",
		LAST);

	web_add_auto_header("Accept-Language",
	                    "id-ID");
	web_add_auto_header("Device-Id",
	                    "dev-001");

	return 0;
}
