import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import type { EvidenceQuery, InteractionReport, LabelEvidence } from './interaction';

@Injectable({ providedIn: 'root' })
export class InteractionsApi {
  private readonly http = inject(HttpClient);

  current(): Observable<InteractionReport> {
    return this.http.get<InteractionReport>('/api/interactions/current');
  }

  check(rxcui: string): Observable<InteractionReport> {
    return this.http.get<InteractionReport>('/api/interactions/check', { params: { rxcui } });
  }

  evidence(query: EvidenceQuery): Observable<LabelEvidence[]> {
    return this.http.get<LabelEvidence[]>('/api/interactions/evidence', { params: { ...query } });
  }
}

export interface ApiFailure {
  error: string;
  /** No DDInter import has been run yet (HTTP 409 no-data). */
  noData: boolean;
}

/** Maps a failed interactions request to a user-facing message. */
export function toFailure(error: unknown): ApiFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return { error: 'Something went wrong. Please try again.', noData: false };
  }
  const body = error.error as { statusMessage?: string; data?: { code?: string } } | null;
  if (error.status === 409 && body?.data?.code === 'no-data') {
    return { error: 'Interaction data has not been imported yet.', noData: true };
  }
  if (error.status === 503) {
    return { error: body?.statusMessage ?? 'This lookup is unavailable right now.', noData: false };
  }
  if (error.status === 422) return { error: 'That product can’t be checked.', noData: false };
  return { error: 'Something went wrong. Please try again.', noData: false };
}
