import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import { httpErrorInfo } from '../../shared/http-error';
import type { DigestsResponse, RunningDigest } from './digest';

@Injectable({ providedIn: 'root' })
export class DigestApi {
  private readonly http = inject(HttpClient);

  list(): Observable<DigestsResponse> {
    return this.http.get<DigestsResponse>('/api/digests');
  }

  unreadCount(): Observable<number> {
    return this.http
      .get<{ count: number }>('/api/digests/unread-count')
      .pipe(map(({ count }) => count));
  }

  run(): Observable<RunningDigest> {
    return this.http.post<RunningDigest>('/api/digests/run', null);
  }

  markRead(id: string): Observable<void> {
    return this.http.post<void>(`/api/digests/${id}/read`, null);
  }
}

/** A failed digest request as a user-facing message. */
export function digestError(error: unknown): string {
  const { status, statusMessage } = httpErrorInfo(error);
  if (statusMessage && [409, 503].includes(status)) return statusMessage;
  return 'Something went wrong. Please try again.';
}
