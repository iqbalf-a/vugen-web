/* Fixture sintetis: kasus transpile di luar pola KOPRA (cast, switch, do-while, blok bersarang, nama reserved JS). */
Action()
{
	int count = (int)3.7;
	char *p = (char *)"teks";
	int var = 1, function = 2;
	char buf[16];

	strcpy(buf, "abc");
	sprintf(buf, "%d-%s", count, p);
	strcat(buf, "x");

	{
		int inner = var + function;
		lr_output_message("%d", inner);
	}
	{
		int inner = 5;
		lr_output_message("%d", inner);
	}

	do {
		count--;
	} while (count > 0);

	switch (count) {
		case 0:
			lr_output_message("nol");
			break;
		default:
			lr_output_message("lain");
	}

	if (count == 0) lr_think_time(1); else lr_think_time(2);
	unknown_function(1);
	lr_output_message(buf);
	return count + 1;
}
