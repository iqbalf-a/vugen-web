#ifndef _GLOBALS_H
#define _GLOBALS_H

#include "lrun.h"
#include "web_api.h"
#include "lrw_custom_body.h"

/* Fixture sintetis: meniru POLA globals.h script KOPRA (nama & nilai palsu). */
merc_timer_handle_t startTime;
int retryLimit = 3, retryCount;
char lastError[128];

double compareDuration(double duration1, double duration2) {
	if (duration1 < duration2) {
		return duration2;
	} else {
		return duration1;
	}
}

#endif // _GLOBALS_H
