import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { httpErrorInfo } from '../../shared/http-error';
import type { LiteratureResponse } from './literature';

@Injectable({ providedIn: 'root' })
export class LiteratureApi {
  private readonly http = inject(HttpClient);

  get(rxcui: string): Observable<LiteratureResponse> {
    return this.http.get<LiteratureResponse>(`/api/drugs/${rxcui}/literature`);
  }

  refresh(rxcui: string): Observable<LiteratureResponse> {
    return this.http.post<LiteratureResponse>(`/api/drugs/${rxcui}/literature/refresh`, null);
  }

  startTakeaways(rxcui: string): Observable<LiteratureResponse> {
    return this.http.post<LiteratureResponse>(`/api/drugs/${rxcui}/literature/takeaways`, null);
  }

  hide(ingredient: string, pmid: string): Observable<void> {
    return this.http.post<void>(`/api/literature/${ingredient}/papers/${pmid}/hide`, null);
  }

  unhide(ingredient: string, pmid: string): Observable<void> {
    return this.http.delete<void>(`/api/literature/${ingredient}/papers/${pmid}/hide`);
  }
}

/** A failed research request as a user-facing message. */
export function literatureError(error: unknown): string {
  const { status, statusMessage } = httpErrorInfo(error);
  if (statusMessage && [404, 422, 429, 503].includes(status)) return statusMessage;
  return 'Something went wrong. Please try again.';
}
