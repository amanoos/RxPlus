import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, Subject, throwError, type Observable } from 'rxjs';

import { AuthActions } from '../../../core/auth/auth.actions';
import { DIGEST_MAX_POLL_MS, DIGEST_POLL_MS, type DigestsResponse } from '../digest';
import { DigestApi, digestError } from '../digest-api.service';
import { digestFixture, digestsFixture } from '../digest.fixture';
import { DigestActions } from './digest.actions';
import * as effects from './digest.effects';
import { digestFeature, initialDigestState } from './digest.reducer';

const { reducer } = digestFeature;
const RUNNING = { id: 'd2', trigger: 'manual' as const, startedAt: '2026-09-28T12:00:00.000Z' };
const ready = digestsFixture();
const running = digestsFixture({ running: RUNNING });

describe('DigestApi', () => {
  it('calls the list, unread count, run and read endpoints', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(DigestApi);
    const http = TestBed.inject(HttpTestingController);

    const list = firstValueFrom(api.list());
    http.expectOne('/api/digests').flush(ready);
    expect(await list).toEqual(ready);

    const count = firstValueFrom(api.unreadCount());
    http.expectOne('/api/digests/unread-count').flush({ count: 7 });
    expect(await count).toBe(7);

    const run = firstValueFrom(api.run());
    const r = http.expectOne('/api/digests/run');
    expect(r.request.method).toBe('POST');
    r.flush(RUNNING, { status: 202, statusText: 'Accepted' });
    expect(await run).toEqual(RUNNING);

    const read = firstValueFrom(api.markRead('d1'));
    const m = http.expectOne('/api/digests/d1/read');
    expect(m.request.method).toBe('POST');
    m.flush(null, { status: 204, statusText: 'No Content' });
    await read;
    http.verify();
  });

  it('shows the server’s message when a run is already going', () => {
    const busy = new HttpErrorResponse({
      status: 409,
      error: { statusMessage: 'A digest is already being collected.' },
    });
    expect(digestError(busy)).toBe('A digest is already being collected.');
    expect(digestError(new HttpErrorResponse({ status: 500 }))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('digest reducer', () => {
  it('loads, and keeps data visible when a later load fails', () => {
    let s = reducer(initialDigestState, DigestActions.open());
    expect(s.status).toBe('loading');
    s = reducer(s, DigestActions.loadSuccess({ data: ready }));
    expect(s).toMatchObject({ status: 'loaded', data: ready });
    s = reducer(s, DigestActions.loadFailure({ error: 'Down' }));
    expect(s).toMatchObject({ status: 'loaded', data: ready, error: 'Down' });
    expect(reducer(initialDigestState, DigestActions.loadFailure({ error: 'Down' })).status).toBe(
      'error',
    );
  });

  it('tracks Run now until the server answers, and shows the running digest', () => {
    let s = reducer(initialDigestState, DigestActions.loadSuccess({ data: ready }));
    s = reducer(s, DigestActions.run());
    expect(s.starting).toBe(true);
    s = reducer(s, DigestActions.runStarted({ running: RUNNING }));
    expect(s.starting).toBe(false);
    expect(digestFeature.selectRunning.projector(s.data)).toEqual(RUNNING);
    s = reducer(s, DigestActions.runFailure({ error: 'Busy' }));
    expect(s).toMatchObject({ starting: false, error: 'Busy' });
    expect(reducer(s, DigestActions.pollTimeout()).timedOut).toBe(true);
  });

  it('keeps the unread count and resets on logout', () => {
    const s = reducer(initialDigestState, DigestActions.unreadLoaded({ count: 3 }));
    expect(s.unread).toBe(3);
    expect(reducer(s, AuthActions.logoutSuccess())).toEqual(initialDigestState);
  });
});

describe('digest effects', () => {
  let actions$: Subject<Action>;
  let routerEvents$: Subject<unknown>;
  const api = {
    list: vi.fn<() => Observable<DigestsResponse>>(),
    unreadCount: vi.fn<() => Observable<number>>(),
    run: vi.fn(),
    markRead: vi.fn<(id: string) => Observable<void>>(),
  };
  const setup = (platform = 'browser', authenticated = true) => {
    actions$ = new Subject<Action>();
    routerEvents$ = new Subject<unknown>();
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {
            auth: {
              status: authenticated ? 'authenticated' : 'anonymous',
              pending: false,
              error: null,
            },
            digest: initialDigestState,
          },
        }),
        { provide: DigestApi, useValue: api },
        { provide: Router, useValue: { events: routerEvents$ } },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
  };
  const collect = (effect: () => Observable<Action>) => {
    const out: Action[] = [];
    TestBed.runInInjectionContext(effect).subscribe((a) => out.push(a));
    return out;
  };
  afterEach(() => vi.useRealTimers());

  it('opens by loading the digests', () => {
    setup();
    api.list.mockReturnValueOnce(of(ready));
    api.list.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    const opened = collect(effects.open);
    const loaded = collect(effects.reload);
    actions$.next(DigestActions.open());
    actions$.next(DigestActions.reload());
    actions$.next(DigestActions.reload());
    expect(opened).toEqual([DigestActions.reload()]);
    expect(loaded).toEqual([
      DigestActions.loadSuccess({ data: ready }),
      DigestActions.loadFailure({ error: 'Something went wrong. Please try again.' }),
    ]);
  });

  it('runs now and reloads, also after a 409', () => {
    setup();
    api.run.mockReturnValueOnce(of(RUNNING));
    api.run.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { statusMessage: 'A digest is already being collected.' },
          }),
      ),
    );
    const out = collect(effects.run);
    const reloads = collect(effects.reloadAfterRun);
    actions$.next(DigestActions.run());
    actions$.next(DigestActions.run());
    out.forEach((a) => actions$.next(a));
    expect(out).toEqual([
      DigestActions.runStarted({ running: RUNNING }),
      DigestActions.runFailure({ error: 'A digest is already being collected.' }),
    ]);
    expect(reloads).toEqual([DigestActions.reload(), DigestActions.reload()]);
  });

  it('polls while a run is going, stops when it is done or on leave', async () => {
    vi.useFakeTimers();
    setup();
    api.list.mockReturnValueOnce(of(running)).mockReturnValueOnce(of(ready));
    const out = collect(effects.pollRun);
    actions$.next(DigestActions.loadSuccess({ data: running }));
    await vi.advanceTimersByTimeAsync(DIGEST_POLL_MS * 3);
    expect(out).toEqual([
      DigestActions.pollSuccess({ data: running }),
      DigestActions.pollSuccess({ data: ready }),
    ]);

    api.list.mockReturnValue(of(running));
    actions$.next(DigestActions.loadSuccess({ data: running }));
    await vi.advanceTimersByTimeAsync(DIGEST_POLL_MS);
    actions$.next(DigestActions.leave());
    await vi.advanceTimersByTimeAsync(DIGEST_POLL_MS * 10);
    expect(api.list).toHaveBeenCalledTimes(3);
  });

  it('gives up after 30 minutes, and never polls during SSR', async () => {
    vi.useFakeTimers();
    setup();
    api.list.mockReturnValue(of(running));
    const out = collect(effects.pollRun);
    actions$.next(DigestActions.loadSuccess({ data: running }));
    await vi.advanceTimersByTimeAsync(DIGEST_MAX_POLL_MS + DIGEST_POLL_MS);
    expect(out.at(-1)).toEqual(DigestActions.pollTimeout());

    TestBed.resetTestingModule();
    setup('server');
    const server = collect(effects.pollRun);
    actions$.next(DigestActions.loadSuccess({ data: running }));
    await vi.advanceTimersByTimeAsync(DIGEST_POLL_MS * 3);
    expect(server).toEqual([]);
  });

  it('marks shown digests with unread items as read, then refreshes the badge', () => {
    setup();
    api.markRead.mockReturnValue(of(undefined));
    const marks = collect(effects.markShownRead);
    const done = collect(effects.markRead);
    const data = digestsFixture({
      digests: [digestFixture(), digestFixture({ id: 'd0', unread: 0 })],
    });
    actions$.next(DigestActions.loadSuccess({ data }));
    actions$.next(DigestActions.loadSuccess({ data: digestsFixture({ digests: [] }) }));
    expect(marks).toEqual([DigestActions.markRead({ ids: ['d1'] })]);
    actions$.next(marks[0]);
    expect(api.markRead).toHaveBeenCalledWith('d1');
    expect(done).toEqual([DigestActions.refreshUnread()]);
  });

  it('never marks read during SSR', () => {
    setup('server');
    const marks = collect(effects.markShownRead);
    actions$.next(DigestActions.loadSuccess({ data: ready }));
    expect(marks).toEqual([]);
  });

  it('refreshes the badge on navigation while signed in, and when a run finishes', () => {
    setup();
    api.unreadCount.mockReturnValue(of(4));
    const nav = collect(effects.refreshUnreadOnNavigation);
    const after = collect(effects.refreshUnreadAfterRun);
    const loaded = collect(effects.refreshUnread);
    routerEvents$.next(new NavigationEnd(1, '/', '/'));
    actions$.next(DigestActions.pollSuccess({ data: running }));
    actions$.next(DigestActions.pollSuccess({ data: ready }));
    actions$.next(DigestActions.refreshUnread());
    expect(nav).toEqual([DigestActions.refreshUnread()]);
    expect(after).toEqual([DigestActions.refreshUnread()]);
    expect(loaded).toEqual([DigestActions.unreadLoaded({ count: 4 })]);
  });

  it('does not ask for the badge when signed out', () => {
    setup('browser', false);
    const nav = collect(effects.refreshUnreadOnNavigation);
    routerEvents$.next(new NavigationEnd(1, '/login', '/login'));
    expect(nav).toEqual([]);
  });
});
