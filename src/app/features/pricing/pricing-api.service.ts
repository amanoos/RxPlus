import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { httpErrorInfo } from '../../shared/http-error';
import type { CostsResponse, PricesResponse } from './pricing';

@Injectable({ providedIn: 'root' })
export class PricingApi {
  private readonly http = inject(HttpClient);

  prices(rxcui: string): Observable<PricesResponse> {
    return this.http.get<PricesResponse>(`/api/drugs/${rxcui}/prices`);
  }

  costs(): Observable<CostsResponse> {
    return this.http.get<CostsResponse>('/api/costs');
  }
}

/** A failed pricing request as a user-facing message. */
export function pricingError(error: unknown): string {
  const { status, statusMessage } = httpErrorInfo(error);
  if (statusMessage && status === 503) return statusMessage;
  return 'Something went wrong. Please try again.';
}
