import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';
import { BehaviorSubject } from 'rxjs';

import { factsFixture, reactionsFixture } from '../../../features/drug-info/drug-info.fixture';
import type { DrugFacts } from '../../../features/drug-info/drug-info';
import { DrugInfoActions } from '../../../features/drug-info/store/drug-info.actions';
import {
  drugInfoFeature,
  initialDrugInfoState,
  type DrugInfoState,
} from '../../../features/drug-info/store/drug-info.reducer';
import { initialLiteratureState } from '../../../features/literature/store/literature.reducer';
import DrugPage from './[rxcui].page';

const rxcui = '314076';

function stateWith(facts: DrugFacts | null, extra: Partial<Record<'factsError', string>> = {}) {
  let s: DrugInfoState = drugInfoFeature.reducer(
    initialDrugInfoState,
    DrugInfoActions.openDrug({ rxcui }),
  );
  if (facts) s = drugInfoFeature.reducer(s, DrugInfoActions.loadFactsSuccess({ rxcui, facts }));
  if (extra.factsError) {
    s = drugInfoFeature.reducer(
      s,
      DrugInfoActions.loadFactsFailure({ rxcui, error: extra.factsError }),
    );
  }
  return drugInfoFeature.reducer(
    s,
    DrugInfoActions.loadReactionsSuccess({ rxcui, reactions: reactionsFixture() }),
  );
}

describe('DrugPage', () => {
  const setup = async (drugInfo: DrugInfoState) => {
    const params = new BehaviorSubject(convertToParamMap({ rxcui }));
    await TestBed.configureTestingModule({
      imports: [DrugPage],
      providers: [
        providePrimeNG(),
        provideMockStore({ initialState: { drugInfo, literature: initialLiteratureState } }),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
      ],
    }).compileComponents();
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(DrugPage);
    await fixture.whenStable();
    return { store, fixture, params, el: fixture.nativeElement as HTMLElement };
  };

  it('opens the drug, and leaves it when the route changes or the page closes', async () => {
    const { store, fixture, params } = await setup(stateWith(null));
    expect(store.dispatch).toHaveBeenCalledWith(DrugInfoActions.openDrug({ rxcui }));
    params.next(convertToParamMap({ rxcui: '197885' }));
    await fixture.whenStable();
    expect(store.dispatch).toHaveBeenCalledWith(DrugInfoActions.leaveDrug({ rxcui }));
    expect(store.dispatch).toHaveBeenCalledWith(DrugInfoActions.openDrug({ rxcui: '197885' }));
    fixture.destroy();
    expect(store.dispatch).toHaveBeenLastCalledWith(DrugInfoActions.leaveDrug({ rxcui: '197885' }));
  });

  it('shows the name, details, class tags, uses and conditions to avoid', async () => {
    const { el } = await setup(stateWith(factsFixture({ brandName: 'Zestril' })));
    expect(el.querySelector('[data-testid="drug-name"]')?.textContent).toContain(
      'lisinopril 10 MG Oral Tablet',
    );
    expect(el.textContent).toContain('10 MG · Oral Tablet · Zestril');
    expect(el.textContent).toContain('Angiotensin Converting Enzyme Inhibitor');
    expect(el.textContent).toContain('ACE inhibitors, plain');
    expect(el.querySelector('[data-testid="uses"]')?.textContent).toMatch(
      /Heart Failure.*Hypertension/s,
    );
    expect(el.querySelector('[data-testid="avoid"]')?.textContent).toMatch(
      /Angioedema.*Pregnancy/s,
    );
    expect(el.querySelector('[data-testid="unavailable"]')).toBeNull();
  });

  it('links to DailyMed and MedlinePlus, and shows FDA reports with the disclaimer', async () => {
    const { el } = await setup(stateWith(factsFixture()));
    const links = [...el.querySelectorAll('[data-testid="links"] a')] as HTMLAnchorElement[];
    expect(links.map((a) => [a.textContent?.trim(), a.href, a.rel])).toEqual([
      [
        'FDA label on DailyMed',
        'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=set-1',
        'noopener noreferrer',
      ],
      [
        'MedlinePlus: Lisinopril',
        'https://medlineplus.gov/druginfo/meds/a692051.html',
        'noopener noreferrer',
      ],
    ]);
    expect(el.querySelector('[data-testid="faers-disclaimer"]')).not.toBeNull();
    expect(el.textContent).toContain('304,318 reports');
  });

  it('shows the summary panel for the drug', async () => {
    const { el } = await setup(stateWith(factsFixture()));
    expect(el.querySelector('app-summary-panel')?.textContent).toContain('Loading summary…');
    expect(el.querySelector('app-research-section')?.textContent).toContain('Research');
  });

  it('says which optional sources were unavailable', async () => {
    const { el } = await setup(
      stateWith(
        factsFixture({ unavailable: ['RxClass', 'MedlinePlus'], label: null, medlinePlus: [] }),
      ),
    );
    expect(el.querySelector('[data-testid="unavailable"]')?.textContent).toContain(
      'RxClass, MedlinePlus',
    );
    expect(el.querySelectorAll('[data-testid="links"] a')).toHaveLength(0);
  });

  it('shows loading and error states', async () => {
    let { el } = await setup(stateWith(null));
    expect(el.textContent).toContain('Loading…');
    TestBed.resetTestingModule();
    ({ el } = await setup(
      stateWith(null, { factsError: 'That is not a prescribable RxNorm product.' }),
    ));
    expect(el.querySelector('[data-testid="facts-error"]')?.textContent).toContain(
      'not a prescribable RxNorm product',
    );
  });
});
