import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';

import { AlternativeListComponent } from './alternative-list.component';
import type { AlternativesResponse } from './alternatives';
import {
  alternativeFixture,
  alternativesFixture,
  aprocitentan,
  ingredientAlternativesFixture,
} from './alternatives.fixture';
import { AlternativesSectionComponent } from './alternatives-section.component';
import { AlternativesActions } from './store/alternatives.actions';
import {
  alternativesFeature,
  initialAlternativesState,
  type AlternativesState,
} from './store/alternatives.reducer';

const rxcui = '314076';

function stateWith(
  data: AlternativesResponse | null,
  extra: (s: AlternativesState) => AlternativesState = (s) => s,
): AlternativesState {
  let s = alternativesFeature.reducer(
    initialAlternativesState,
    AlternativesActions.open({ rxcui }),
  );
  if (data) s = alternativesFeature.reducer(s, AlternativesActions.loadSuccess({ rxcui, data }));
  return extra(s);
}

describe('AlternativeListComponent', () => {
  it('links each drug to its page and shows approval, generic and a New tag', async () => {
    TestBed.configureTestingModule({ providers: [providePrimeNG(), provideRouter([])] });
    const fixture = TestBed.createComponent(AlternativeListComponent);
    fixture.componentRef.setInput('drugs', [aprocitentan, alternativeFixture()]);
    fixture.componentRef.setInput('action', 'hide');
    const acted: string[] = [];
    fixture.componentInstance.act.subscribe((id) => acted.push(id));
    await fixture.whenStable();
    const [first, second] = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="alternative"]'),
    ];
    expect(first.querySelector('a')?.getAttribute('href')).toBe('/drugs/2679064');
    expect(first.textContent).toContain('New (2024)');
    expect(first.textContent).toContain('No generic yet');
    expect(second.textContent).toContain('First approved 1985');
    expect(second.textContent).toContain('Generic available');
    expect(second.querySelector('[data-testid="new-tag"]')).toBeNull();
    (second.querySelector('[data-testid="alternative-action"]') as HTMLButtonElement).click();
    expect(acted).toEqual(['3827']);
  });
});

describe('AlternativesSectionComponent', () => {
  const render = async (alternatives: AlternativesState, platform = 'browser') => {
    TestBed.configureTestingModule({
      providers: [
        providePrimeNG(),
        provideRouter([]),
        provideMockStore({ initialState: { alternatives } }),
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(AlternativesSectionComponent);
    fixture.componentRef.setInput('rxcui', rxcui);
    fixture.componentRef.setInput('drugName', 'lisinopril');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, store, el, q: (id: string) => el.querySelector(`[data-testid="${id}"]`) };
  };

  it('opens in the browser and leaves on destroy, but not during SSR', async () => {
    const { store, fixture } = await render(stateWith(null));
    expect(store.dispatch).toHaveBeenCalledWith(AlternativesActions.open({ rxcui }));
    fixture.destroy();
    expect(store.dispatch).toHaveBeenLastCalledWith(AlternativesActions.leave({ rxcui }));

    TestBed.resetTestingModule();
    const server = await render(stateWith(null), 'server');
    expect(server.store.dispatch).not.toHaveBeenCalled();
  });

  it('always shows the note, then the three groups for the chosen condition', async () => {
    const { el, q } = await render(stateWith(alternativesFixture()));
    expect(q('alternatives-note')?.textContent).toContain(
      'Not a recommendation: talk to your prescriber before changing anything.',
    );
    expect(q('condition')?.textContent).toMatch(
      /For\s+Hypertension\s+\(saved for this medication\)/,
    );
    expect(q('group-new')?.textContent).toContain('aprocitentan');
    expect(el.textContent).toContain('Same class (Angiotensin Converting Enzyme Inhibitor)');
    expect(q('group-same-class')?.querySelectorAll('[data-testid="alternative"]')).toHaveLength(2);
    expect(
      [...el.querySelectorAll('[data-testid="other-class"]')].map((s) => s.textContent?.trim()),
    ).toEqual(['Angiotensin 2 Receptor Blocker (1)', 'Endothelin Receptor Antagonist (1)']);
    expect(q('alternatives-footer')?.textContent).toBe(
      'From RxClass (FDA and MED-RT) and Drugs@FDA, updated Sep 27, 2026.',
    );
  });

  it('asks what the drug is taken for and saves the choice on the medication', async () => {
    const { el, store } = await render(
      stateWith(alternativesFixture({ condition: null, conditionSource: null })),
    );
    expect(el.textContent).toContain('What do you take lisinopril for?');
    const buttons = [...el.querySelectorAll('[data-testid="condition-choices"] button')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Heart Failure', 'Hypertension']);
    (buttons[1] as HTMLButtonElement).click();
    expect(store.dispatch).toHaveBeenCalledWith(
      AlternativesActions.chooseCondition({
        rxcui,
        condition: { id: 'D006973', name: 'Hypertension' },
        medicationId: 'm1',
      }),
    );
  });

  it('lets the choice be changed, and marks a visit-only choice', async () => {
    const { fixture, q, el } = await render(
      stateWith(alternativesFixture({ conditionSource: 'visit', medicationId: null })),
    );
    expect(q('condition')?.textContent).toContain('(this visit only)');
    (q('change-condition') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.textContent).toContain('What do you take lisinopril for?');
  });

  it('shows building, failure and skipped states', async () => {
    const data = alternativesFixture({
      ingredients: [
        ingredientAlternativesFixture({
          classList: { status: 'pending', builtAt: null, skipped: null, error: null },
          conditionList: { status: 'failed', builtAt: null, skipped: 2, error: 'RxNav timed out' },
        }),
      ],
    });
    const { q, store } = await render(stateWith(data));
    expect(q('alternatives-building')?.textContent).toContain('Finding alternatives…');
    expect(q('alternatives-failed')?.textContent).toContain('RxNav timed out');
    expect(q('skipped')?.textContent).toMatch(/2 drugs couldn’t be checked/);
    (
      q('alternatives-failed')?.parentElement?.querySelector('p-button button') as HTMLButtonElement
    ).click();
    expect(store.dispatch).toHaveBeenCalledWith(AlternativesActions.refresh({ rxcui }));
  });

  it('hides a drug and shows hidden ones again', async () => {
    const data = alternativesFixture({
      ingredients: [
        ingredientAlternativesFixture({
          groups: {
            ...ingredientAlternativesFixture().groups,
            hidden: [alternativeFixture({ ingredientRxcui: '1998', name: 'captopril' })],
          },
        }),
      ],
    });
    const { fixture, q, store } = await render(stateWith(data));
    (
      q('group-same-class')?.querySelector(
        '[data-testid="alternative-action"]',
      ) as HTMLButtonElement
    ).click();
    expect(store.dispatch).toHaveBeenCalledWith(
      AlternativesActions.hide({ rxcui, ingredient: '29046', target: '3827' }),
    );
    expect(q('toggle-hidden-alternatives')?.textContent?.trim()).toBe('Show hidden (1)');
    (q('toggle-hidden-alternatives') as HTMLButtonElement).click();
    await fixture.whenStable();
    (
      q('hidden-alternatives')?.querySelector(
        '[data-testid="alternative-action"]',
      ) as HTMLButtonElement
    ).click();
    expect(store.dispatch).toHaveBeenCalledWith(
      AlternativesActions.unhide({ rxcui, ingredient: '29046', target: '1998' }),
    );
  });

  it('checks for new approvals and shows load errors', async () => {
    const { q, store } = await render(stateWith(alternativesFixture()));
    (q('refresh-alternatives')?.querySelector('button') as HTMLButtonElement).click();
    expect(store.dispatch).toHaveBeenCalledWith(AlternativesActions.refresh({ rxcui }));

    TestBed.resetTestingModule();
    const failed = await render(
      stateWith(null, (s) =>
        alternativesFeature.reducer(
          s,
          AlternativesActions.loadFailure({ rxcui, error: 'Server down' }),
        ),
      ),
    );
    expect(failed.q('alternatives-error')?.textContent).toContain('Server down');
  });
});
