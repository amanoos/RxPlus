import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { reportFixture } from './interaction.fixture';
import { InteractionsApi } from './interactions-api.service';

describe('InteractionsApi', () => {
  it('calls current, check and evidence endpoints', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(InteractionsApi);
    const http = TestBed.inject(HttpTestingController);
    const report = reportFixture();

    const current = firstValueFrom(api.current());
    http.expectOne('/api/interactions/current').flush(report);
    expect(await current).toEqual(report);

    const check = firstValueFrom(api.check('313096'));
    http.expectOne('/api/interactions/check?rxcui=313096').flush(report);
    expect(await check).toEqual(report);

    const evidence = firstValueFrom(
      api.evidence({ a: '1', aIngredient: '2', b: '3', bIngredient: '4' }),
    );
    http.expectOne('/api/interactions/evidence?a=1&aIngredient=2&b=3&bIngredient=4').flush([]);
    expect(await evidence).toEqual([]);
    http.verify();
  });
});
