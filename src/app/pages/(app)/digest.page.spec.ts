import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';

import { digestFixture, digestsFixture } from '../../features/digest/digest.fixture';
import { DigestActions } from '../../features/digest/store/digest.actions';
import { initialDigestState, type DigestState } from '../../features/digest/store/digest.reducer';
import DigestPage from './digest.page';

describe('DigestPage', () => {
  const setup = async (digest: Partial<DigestState>) => {
    await TestBed.configureTestingModule({
      imports: [DigestPage],
      providers: [
        providePrimeNG(),
        provideRouter([]),
        provideMockStore({ initialState: { digest: { ...initialDigestState, ...digest } } }),
      ],
    }).compileComponents();
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(DigestPage);
    await fixture.whenStable();
    return { store, fixture, el: fixture.nativeElement as HTMLElement };
  };
  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('opens on load and leaves on destroy', async () => {
    const { store, fixture } = await setup({ status: 'loading' });
    expect(store.dispatch).toHaveBeenCalledWith(DigestActions.open());
    fixture.destroy();
    expect(store.dispatch).toHaveBeenCalledWith(DigestActions.leave());
  });

  it('shows the latest digest open and earlier ones collapsed, with the next run', async () => {
    const data = digestsFixture({
      digests: [
        digestFixture(),
        digestFixture({ id: 'd0', windowStart: '2026-09-14', unread: 0, itemCount: 4 }),
      ],
    });
    const { el } = await setup({ status: 'loaded', data });
    const digests = [...el.querySelectorAll<HTMLDetailsElement>('[data-testid="digest"]')];
    expect(digests.map((d) => d.open)).toEqual([true, false]);
    expect(digests.map((d) => text(d.querySelector('summary')))).toEqual([
      'Week of Sep 21: 1 item 1 new',
      'Week of Sep 14: 4 items',
    ]);
    expect(text(el.querySelector('[data-testid="digest-status"]'))).toMatch(
      /^Next digest: Monday, Oct 5, \d+:00 [AP]M\.$/,
    );
  });

  it('runs now, and shows the running state with the button disabled', async () => {
    const idle = await setup({ status: 'loaded', data: digestsFixture() });
    idle.el.querySelector<HTMLButtonElement>('[data-testid="run-now"] button')?.click();
    expect(idle.store.dispatch).toHaveBeenCalledWith(DigestActions.run());

    TestBed.resetTestingModule();
    const running = await setup({
      status: 'loaded',
      data: digestsFixture({
        running: { id: 'd2', trigger: 'manual', startedAt: '2026-09-28T10:00:00.000Z' },
      }),
      timedOut: true,
    });
    expect(text(running.el.querySelector('[data-testid="digest-status"]'))).toMatch(
      /^Collecting this week’s news… started \d+:00 [AP]M\.$/,
    );
    expect(
      running.el.querySelector<HTMLButtonElement>('[data-testid="run-now"] button')?.disabled,
    ).toBe(true);
    expect(running.el.querySelector('[data-testid="timed-out"]')).not.toBeNull();
  });

  it('explains an empty history and having no active medications', async () => {
    const empty = await setup({ status: 'loaded', data: digestsFixture({ digests: [] }) });
    expect(text(empty.el.querySelector('[data-testid="no-digests"]'))).toContain('No digest yet.');

    TestBed.resetTestingModule();
    const none = await setup({
      status: 'loaded',
      data: digestsFixture({ digests: [], hasActiveMedications: false }),
    });
    expect(none.el.querySelector('[data-testid="no-medications"]')).not.toBeNull();
    expect(none.el.querySelector('[data-testid="no-digests"]')).toBeNull();
  });

  it('offers Try again on a failed latest digest, and shows errors', async () => {
    const { el, store } = await setup({
      status: 'loaded',
      error: 'A digest is already being collected.',
      data: digestsFixture({
        digests: [digestFixture({ status: 'failed', error: 'PubMed is down', groups: [] })],
      }),
    });
    expect(text(el.querySelector('summary'))).toContain('Week of Sep 21: couldn’t be collected');
    expect(text(el.querySelector('[data-testid="digest-error"]'))).toBe(
      'A digest is already being collected.',
    );
    el.querySelector<HTMLButtonElement>('[data-testid="try-again"] button')?.click();
    expect(store.dispatch).toHaveBeenCalledWith(DigestActions.run());
  });
});
