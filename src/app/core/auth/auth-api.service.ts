import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  login(password: string): Observable<null> {
    return this.http.post<null>('/api/auth/login', { password });
  }

  logout(): Observable<null> {
    return this.http.post<null>('/api/auth/logout', null);
  }

  /** True when the session cookie is valid; any error (401, network) counts as signed out. */
  isAuthenticated(): Observable<boolean> {
    return this.http.get<{ authenticated: boolean }>('/api/auth/me').pipe(
      map((res) => res.authenticated === true),
      catchError(() => of(false)),
    );
  }
}
