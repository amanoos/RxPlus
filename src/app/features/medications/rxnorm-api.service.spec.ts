import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { lookupErrorMessage, RxNormApi, sortProducts, type RxProduct } from './rxnorm-api.service';

describe('RxNormApi', () => {
  let api: RxNormApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(RxNormApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('searches names and lists sorted products with encoded parameters', async () => {
    const names = firstValueFrom(api.search('lisin opril'));
    http.expectOne('/api/rxnorm/search?q=lisin%20opril').flush(['lisinopril']);
    expect(await names).toEqual(['lisinopril']);

    const products = firstValueFrom(api.products('hydroCHLOROthiazide / lisinopril'));
    // Angular leaves '/' unencoded in query values (valid; the server decodes it).
    http.expectOne('/api/rxnorm/products?name=hydroCHLOROthiazide%20/%20lisinopril').flush([]);
    expect(await products).toEqual([]);
  });
});

describe('sortProducts', () => {
  const p = (name: string, tty: 'SCD' | 'SBD'): RxProduct => ({
    rxcui: name,
    name,
    tty,
    brandName: tty === 'SBD' ? 'Brand' : null,
  });

  it('puts single-ingredient before combinations, generics before brands, then by name', () => {
    const sorted = sortProducts([
      p('hydrochlorothiazide 12.5 MG / lisinopril 10 MG Oral Tablet', 'SCD'),
      p('lisinopril 10 MG Oral Tablet [Zestril]', 'SBD'),
      p('lisinopril 20 MG Oral Tablet', 'SCD'),
      p('lisinopril 10 MG Oral Tablet', 'SCD'),
    ]).map((x) => x.name);
    expect(sorted).toEqual([
      'lisinopril 10 MG Oral Tablet',
      'lisinopril 20 MG Oral Tablet',
      'lisinopril 10 MG Oral Tablet [Zestril]',
      'hydrochlorothiazide 12.5 MG / lisinopril 10 MG Oral Tablet',
    ]);
  });

  it('orders strengths numerically, not alphabetically', () => {
    const sorted = sortProducts([
      p('lisinopril 40 MG Oral Tablet', 'SCD'),
      p('lisinopril 5 MG Oral Tablet', 'SCD'),
      p('lisinopril 10 MG Oral Tablet', 'SCD'),
    ]).map((x) => x.name);
    expect(sorted).toEqual([
      'lisinopril 5 MG Oral Tablet',
      'lisinopril 10 MG Oral Tablet',
      'lisinopril 40 MG Oral Tablet',
    ]);
  });
});

describe('lookupErrorMessage', () => {
  it('explains outages and falls back to a generic message', async () => {
    const { HttpErrorResponse } = await import('@angular/common/http');
    expect(lookupErrorMessage(new HttpErrorResponse({ status: 503 }))).toBe(
      'Drug lookup is unavailable right now.',
    );
    expect(lookupErrorMessage(new HttpErrorResponse({ status: 0 }))).toBe(
      'Drug lookup is unavailable right now.',
    );
    expect(lookupErrorMessage(new Error('x'))).toBe('Drug lookup failed. Please try again.');
  });
});
