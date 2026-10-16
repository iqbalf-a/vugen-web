/* Fixture sintetis: meniru POLA Action Utama MCM (Prelogin -> Login -> Logout). Semua nama/nilai palsu. */
Action()
{
	lr_save_string("127.0.0.1:18088", "host");
	lr_save_string("demo", "username");
	lr_save_string("secret", "password");

	Prelogin("DEMO_01_exc");
	Login("DEMO_02_exc");
	Logout("DEMO_03_exc");

	lr_output_message("action-selesai");
	return 0;
}
