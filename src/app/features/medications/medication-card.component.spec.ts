import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';

import { medicationFixture } from './medication.fixture';
import { MedicationCardComponent } from './medication-card.component';

describe('MedicationCardComponent', () => {
  const render = async (overrides = {}) => {
    await TestBed.configureTestingModule({
      imports: [MedicationCardComponent],
      providers: [providePrimeNG(), provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(MedicationCardComponent);
    (fixture.componentRef as ComponentRef<MedicationCardComponent>).setInput(
      'medication',
      medicationFixture(overrides),
    );
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('shows the product, strength, form and start date without a timezone shift', async () => {
    const el = await render({ notes: 'with breakfast' });
    expect(el.querySelector('h3')?.textContent).toContain('lisinopril 10 MG Oral Tablet');
    expect(el.textContent).toContain('10 MG');
    expect(el.textContent).toContain('Oral Tablet');
    expect(el.textContent).toContain('Started Jan 15, 2026');
    expect(el.textContent).toContain('with breakfast');
  });

  it('shows what it is taken for', async () => {
    const el = await render({ takenForId: 'D006973', takenForName: 'Hypertension' });
    expect(el.querySelector('[data-testid="taken-for"]')?.textContent).toBe('For: Hypertension');
  });

  it('links to the drug page', async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="about-drug"]')?.getAttribute('href')).toBe(
      '/drugs/314076',
    );
  });

  it('shows the brand for branded products and the stop date when stopped', async () => {
    const el = await render({
      tty: 'SBD',
      brandName: 'Zestril',
      stoppedOn: '2026-06-01',
    });
    expect(el.textContent).toContain('Zestril');
    expect(el.textContent).toContain('Stopped Jun 1, 2026');
  });

  it('omits missing optional details', async () => {
    const el = await render({ strength: null, startedOn: null, notes: null });
    expect(el.textContent).not.toContain('Started');
    expect(el.querySelector('[data-testid="notes"]')).toBeNull();
  });
});
