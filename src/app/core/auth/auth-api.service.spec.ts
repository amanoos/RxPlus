import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { AuthApi } from './auth-api.service';

describe('AuthApi', () => {
  let api: AuthApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(AuthApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('posts the password to /api/auth/login', async () => {
    const result = firstValueFrom(api.login('pw'));
    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ password: 'pw' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await expect(result).resolves.toBeNull();
  });

  it('posts to /api/auth/logout', async () => {
    const result = firstValueFrom(api.logout());
    const req = http.expectOne('/api/auth/logout');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await expect(result).resolves.toBeNull();
  });

  it('maps /api/auth/me to a boolean', async () => {
    const yes = firstValueFrom(api.isAuthenticated());
    http.expectOne('/api/auth/me').flush({ authenticated: true });
    await expect(yes).resolves.toBe(true);

    const no = firstValueFrom(api.isAuthenticated());
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await expect(no).resolves.toBe(false);
  });
});
