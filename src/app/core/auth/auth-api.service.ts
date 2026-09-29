import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';

/** The signed-in account. */
export interface AuthUser {
  id: string;
  username: string;
}

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  login(username: string, password: string): Observable<null> {
    return this.http.post<null>('/api/auth/login', { username, password });
  }

  logout(): Observable<null> {
    return this.http.post<null>('/api/auth/logout', null);
  }

  /** The session's user; any error (401, network) counts as signed out (null). */
  currentUser(): Observable<AuthUser | null> {
    return this.http.get<{ authenticated: boolean; user?: AuthUser }>('/api/auth/me').pipe(
      map((res) => (res.authenticated === true && res.user ? res.user : null)),
      catchError(() => of(null)),
    );
  }
}
