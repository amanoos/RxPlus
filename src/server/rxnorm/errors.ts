import { createError } from 'h3';

import { RxNavUnavailableError } from './client';
import { RXNAV_UNAVAILABLE_MESSAGE } from './index';

/** Maps RxNav outages to a generic 503; anything else propagates unchanged. */
export function toHttpError(error: unknown): unknown {
  if (error instanceof RxNavUnavailableError) {
    console.warn(`[rxnav] ${error.message}`);
    return createError({
      statusCode: 503,
      statusMessage: RXNAV_UNAVAILABLE_MESSAGE,
      message: RXNAV_UNAVAILABLE_MESSAGE,
    });
  }
  return error;
}
