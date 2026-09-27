import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { REQUEST } from '@analogjs/router/tokens';

import { forwardCookieInterceptor } from './forward-cookie.interceptor';

describe('forwardCookieInterceptor', () => {
  const setup = (request: unknown) => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([forwardCookieInterceptor])),
        provideHttpClientTesting(),
        ...(request ? [{ provide: REQUEST, useValue: request }] : []),
      ],
    });
    return { http: TestBed.inject(HttpClient), ctrl: TestBed.inject(HttpTestingController) };
  };

  it('forwards the incoming cookie to same-origin API calls during SSR', () => {
    const { http, ctrl } = setup({ headers: { cookie: 'rxplus_session=abc' } });
    http.get('/api/auth/me').subscribe();
    expect(ctrl.expectOne('/api/auth/me').request.headers.get('cookie')).toBe('rxplus_session=abc');
  });

  it('never forwards cookies to other hosts', () => {
    const { http, ctrl } = setup({ headers: { cookie: 'rxplus_session=abc' } });
    http.get('https://api.example.com/api/x').subscribe();
    const req = ctrl.expectOne('https://api.example.com/api/x');
    expect(req.request.headers.has('cookie')).toBe(false);
  });

  it('does nothing in the browser (no REQUEST)', () => {
    const { http, ctrl } = setup(null);
    http.get('/api/auth/me').subscribe();
    expect(ctrl.expectOne('/api/auth/me').request.headers.has('cookie')).toBe(false);
  });
});
