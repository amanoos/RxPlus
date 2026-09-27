import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of, throwError } from 'rxjs';

import { httpErrorInfo } from '../../shared/http-error';
import type { DrugFacts, DrugSummary, ReportedReactions } from './drug-info';

@Injectable({ providedIn: 'root' })
export class DrugInfoApi {
  private readonly http = inject(HttpClient);

  facts(rxcui: string): Observable<DrugFacts> {
    return this.http.get<DrugFacts>(`/api/drugs/${rxcui}`);
  }

  reportedReactions(rxcui: string): Observable<ReportedReactions> {
    return this.http.get<ReportedReactions>(`/api/drugs/${rxcui}/reported-reactions`);
  }

  /** The stored summary for the current label, or null when none exists yet (404). */
  summary(rxcui: string): Observable<DrugSummary | null> {
    return this.http
      .get<DrugSummary>(`/api/drugs/${rxcui}/summary`)
      .pipe(
        catchError((e: unknown) =>
          httpErrorInfo(e).status === 404 ? of(null) : throwError(() => e),
        ),
      );
  }

  startSummary(rxcui: string): Observable<DrugSummary> {
    return this.http.post<DrugSummary>(`/api/drugs/${rxcui}/summary`, null);
  }
}

/** A failed drug-info request as a user-facing message. */
export function drugInfoError(error: unknown): string {
  const { status, statusMessage } = httpErrorInfo(error);
  if (statusMessage && [422, 429, 503].includes(status)) return statusMessage;
  if (status === 400) return 'That is not a valid RxNorm id.';
  return 'Something went wrong. Please try again.';
}
