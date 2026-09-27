import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { medicationFixture } from './medication.fixture';
import { MedicationsApi } from './medications-api.service';

describe('MedicationsApi', () => {
  let api: MedicationsApi;
  let http: HttpTestingController;
  const med = medicationFixture();

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(MedicationsApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('lists, adds, updates and removes', async () => {
    const list = firstValueFrom(api.list());
    http.expectOne({ method: 'GET', url: '/api/medications' }).flush([med]);
    expect(await list).toEqual([med]);

    const added = firstValueFrom(api.add({ rxcui: '314076', startedOn: '2026-01-15' }));
    const post = http.expectOne({ method: 'POST', url: '/api/medications' });
    expect(post.request.body).toEqual({ rxcui: '314076', startedOn: '2026-01-15' });
    post.flush(med);
    expect(await added).toEqual(med);

    const updated = firstValueFrom(api.update(med.id, { notes: 'x' }));
    const patch = http.expectOne({ method: 'PATCH', url: `/api/medications/${med.id}` });
    expect(patch.request.body).toEqual({ notes: 'x' });
    patch.flush({ ...med, notes: 'x' });
    expect((await updated).notes).toBe('x');

    const removed = firstValueFrom(api.remove(med.id));
    http
      .expectOne({ method: 'DELETE', url: `/api/medications/${med.id}` })
      .flush(null, { status: 204, statusText: 'No Content' });
    await expect(removed).resolves.toBeNull();
  });
});
