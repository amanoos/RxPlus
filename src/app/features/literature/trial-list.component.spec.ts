import { TestBed } from '@angular/core/testing';
import { providePrimeNG } from 'primeng/config';

import { ingredientFixture } from './literature.fixture';
import { phaseLabel, TrialListComponent } from './trial-list.component';

describe('phaseLabel', () => {
  it('reads ClinicalTrials.gov phase codes', () => {
    expect(phaseLabel(['PHASE4'])).toBe('Phase 4');
    expect(phaseLabel(['PHASE2', 'PHASE3'])).toBe('Phase 2/3');
    expect(phaseLabel(['EARLY_PHASE1'])).toBe('Early phase 1');
    expect(phaseLabel(['NA'])).toBe('');
    expect(phaseLabel([])).toBe('');
  });
});

describe('TrialListComponent', () => {
  it('shows status, phase, NCT id and a link to each trial', async () => {
    TestBed.configureTestingModule({ providers: [providePrimeNG()] });
    const fixture = TestBed.createComponent(TrialListComponent);
    fixture.componentRef.setInput('trials', ingredientFixture().trials);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const [completed, recruiting] = [...el.querySelectorAll('[data-testid="trial"]')];
    expect(completed.textContent).toContain('Completed · results posted');
    expect(completed.textContent).toContain('Phase 4');
    expect(completed.textContent).toContain('NCT05049616');
    const link = completed.querySelector('[data-testid="trial-title"]') as HTMLAnchorElement;
    expect(link.href).toBe('https://clinicaltrials.gov/study/NCT05049616');
    expect(link.rel).toBe('noopener noreferrer');
    expect(recruiting.textContent).toContain('Recruiting');
  });
});
