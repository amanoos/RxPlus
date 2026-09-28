import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { httpErrorInfo } from '../../shared/http-error';
import type { AlternativesResponse } from './alternatives';

@Injectable({ providedIn: 'root' })
export class AlternativesApi {
  private readonly http = inject(HttpClient);

  /** `condition` applies for this visit only (for products not on the medication list). */
  get(rxcui: string, condition?: string | null): Observable<AlternativesResponse> {
    return this.http.get<AlternativesResponse>(`/api/drugs/${rxcui}/alternatives`, {
      params: condition ? { condition } : {},
    });
  }

  refresh(rxcui: string, condition?: string | null): Observable<AlternativesResponse> {
    return this.http.post<AlternativesResponse>(`/api/drugs/${rxcui}/alternatives/refresh`, null, {
      params: condition ? { condition } : {},
    });
  }

  hide(ingredient: string, rxcui: string): Observable<void> {
    return this.http.post<void>(`/api/alternatives/${ingredient}/hidden/${rxcui}`, null);
  }

  unhide(ingredient: string, rxcui: string): Observable<void> {
    return this.http.delete<void>(`/api/alternatives/${ingredient}/hidden/${rxcui}`);
  }
}

/** A failed alternatives request as a user-facing message. */
export function alternativesError(error: unknown): string {
  const { status, statusMessage } = httpErrorInfo(error);
  if (statusMessage && [400, 422, 503].includes(status)) return statusMessage;
  return 'Something went wrong. Please try again.';
}
