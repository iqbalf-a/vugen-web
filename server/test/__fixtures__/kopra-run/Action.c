/* Fixture sintetis untuk tes runtime: pola Action Utama KOPRA memanggil Action General. */
Action()
{
	lr_save_string("127.0.0.1:18084", "host");
	Loadpage("DEMO_01_exc");
	return 0;
}
