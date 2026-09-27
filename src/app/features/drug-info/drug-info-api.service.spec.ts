import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { DrugInfoApi, drugInfoError } from './drug-info-api.service';
import { factsFixture, reactionsFixture, summaryFixture } from './drug-info.fixture';

describe('DrugInfoApi', () => {
  let api: DrugInfoApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(DrugInfoApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('calls the facts, reactions and summary endpoints', async () => {
    const facts = firstValueFrom(api.facts('314076'));
    http.expectOne('/api/drugs/314076').flush(factsFixture());
    expect((await facts).name).toBe('lisinopril 10 MG Oral Tablet');

    const reactions = firstValueFrom(api.reportedReactions('314076'));
    http.expectOne('/api/drugs/314076/reported-reactions').flush(reactionsFixture());
    expect((await reactions).ingredients[0].total).toBe(304318);

    const started = firstValueFrom(api.startSummary('314076'));
    const post = http.expectOne('/api/drugs/314076/summary');
    expect(post.request.method).toBe('POST');
    post.flush(summaryFixture({ status: 'pending' }), { status: 202, statusText: 'Accepted' });
    expect((await started).status).toBe('pending');

    const refreshed = firstValueFrom(api.startSummary('314076', true));
    http.expectOne('/api/drugs/314076/summary?refresh=1').flush(summaryFixture());
    expect((await refreshed).status).toBe('ready');
  });

  it('treats a missing summary as null and passes other errors on', async () => {
    const none = firstValueFrom(api.summary('314076'));
    http
      .expectOne('/api/drugs/314076/summary')
      .flush({ statusMessage: 'No summary yet.' }, { status: 404, statusText: 'Not Found' });
    expect(await none).toBeNull();

    const down = firstValueFrom(api.summary('314076'));
    http
      .expectOne('/api/drugs/314076/summary')
      .flush(
        { statusMessage: 'The FDA label is unavailable right now.' },
        { status: 503, statusText: 'x' },
      );
    await expect(down).rejects.toBeInstanceOf(HttpErrorResponse);
  });
});

describe('drugInfoError', () => {
  const error = (status: number, statusMessage?: string) =>
    new HttpErrorResponse({ status, error: statusMessage ? { statusMessage } : null });

  it('shows the server’s explanation for expected failures', () => {
    expect(drugInfoError(error(503, 'AI summary unavailable: No local model configured.'))).toBe(
      'AI summary unavailable: No local model configured.',
    );
    expect(
      drugInfoError(error(429, 'The daily limit of 20 Claude summaries has been reached.')),
    ).toContain('daily limit');
    expect(drugInfoError(error(400))).toBe('That is not a valid RxNorm id.');
    expect(drugInfoError(error(500, 'stack details'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
