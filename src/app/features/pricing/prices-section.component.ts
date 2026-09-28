import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { EditMedicationDialogComponent } from '../medications/edit-medication-dialog.component';
import { MedicationsActions } from '../medications/store/medications.actions';
import {
  selectAllMedications,
  selectMedicationsLoaded,
} from '../medications/store/medications.reducer';
import { dollars, unitDollars, type MedicationCost } from './pricing';
import { PricingActions } from './store/pricing.actions';
import { pricingFeature } from './store/pricing.reducer';

/** "30 tablets" / "1 unit": the form's word when Cost Plus gives one. */
export function unitsLabel(count: number, form: string | undefined): string {
  const word = /tablet/i.test(form ?? '')
    ? 'tablet'
    : /capsule/i.test(form ?? '')
      ? 'capsule'
      : 'unit';
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

/** The drug page's Prices: Cost Plus Drugs cash price vs the owner's copay, per month. */
@Component({
  selector: 'app-prices-section',
  imports: [ButtonModule, MessageModule, EditMedicationDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="prices-heading" data-testid="prices">
      <h2 id="prices-heading" class="text-lg font-semibold">Prices</h2>
      @let s = state();
      @if (!s || (s.status === 'loading' && !s.data)) {
        <p class="mt-2 text-sm">Loading prices…</p>
      } @else if (s.status === 'error' && !s.data) {
        <p-message severity="warn" styleClass="mt-2" data-testid="prices-error">{{
          s.error
        }}</p-message>
      } @else if (s.data; as d) {
        @if (d.price; as p) {
          <p class="mt-2 text-sm" data-testid="cash-price">
            <span class="font-medium">Cost Plus Drugs:</span> {{ unit(p.unitPrice) }} per
            {{ unitWord(p.form) }}
            @if (d.medication; as m) {
              → <span class="font-medium">{{ money(m.cashCents) }}</span> for
              {{ units(m.unitsPerMonth, p.form) }} a month
            } @else if (d.defaultMonthlyCents !== null) {
              → {{ money(d.defaultMonthlyCents) }} for {{ units(30, p.form) }} a month
            }
          </p>
          <p class="mt-1 text-xs text-surface-600 dark:text-surface-300">
            Plus Cost Plus’s per-order fees (shown at checkout). ·
            <a class="underline" [href]="p.url" target="_blank" rel="noopener noreferrer"
              >See it at Cost Plus Drugs</a
            >
            @if (d.asOf) {
              · as of {{ time(d.asOf) }}
            }
          </p>
        } @else {
          <p class="mt-2 text-sm" data-testid="not-sold">
            Not sold at Cost Plus Drugs (it carries mostly generics).
          </p>
        }

        @if (d.medication; as m) {
          <div class="mt-3 text-sm" data-testid="my-cost">
            @if (m.insuredCents !== null) {
              <p>
                <span class="font-medium">Your copay:</span> {{ money(m.copayCents) }} per
                {{ units(m.copayUnits ?? 0, d.price?.form) }} →
                <span class="font-medium">{{ money(m.insuredCents) }}</span> a month
              </p>
            } @else {
              <p class="text-surface-600 dark:text-surface-300">No copay entered.</p>
            }
            @if (comparison(m); as c) {
              <p class="mt-1 font-medium" data-testid="comparison">{{ c }}</p>
            }
            <p-button
              label="Edit units and copay"
              size="small"
              severity="secondary"
              [text]="true"
              styleClass="mt-1 -ml-3"
              data-testid="edit-cost"
              (onClick)="editing.set(true)"
            />
          </div>
        }
        @if (s.error) {
          <p class="mt-2 text-xs text-surface-600 dark:text-surface-300">{{ s.error }}</p>
        }
      }
    </section>

    <app-edit-medication-dialog
      [medication]="medication()"
      mode="edit"
      [visible]="editing() && !!medication()"
      (visibleChange)="$event || editing.set(false)"
    />
  `,
})
export class PricesSectionComponent {
  private readonly store = inject(Store);
  readonly rxcui = input.required<string>();

  protected readonly editing = signal(false);
  private readonly prices = this.store.selectSignal(pricingFeature.selectPrices);
  protected readonly state = computed(() => this.prices()[this.rxcui()] ?? null);
  private readonly medications = this.store.selectSignal(selectAllMedications);
  private readonly medicationsLoaded = this.store.selectSignal(selectMedicationsLoaded);
  protected readonly medication = computed(() => {
    const id = this.state()?.data?.medication?.medicationId;
    return (id && this.medications().find((m) => m.id === id)) || null;
  });

  constructor() {
    effect(() => this.store.dispatch(PricingActions.loadPrices({ rxcui: this.rxcui() })));
    // The edit dialog needs the medication itself.
    effect(() => {
      if (this.state()?.data?.medication && !this.medicationsLoaded()) {
        this.store.dispatch(MedicationsActions.load());
      }
    });
  }

  money(cents: number | null): string {
    return cents === null ? '—' : dollars(cents);
  }

  unit(value: number): string {
    return unitDollars(value);
  }

  unitWord(form: string | undefined): string {
    return unitsLabel(1, form).replace(/^1 /, '');
  }

  units(count: number, form: string | undefined): string {
    return unitsLabel(count, form);
  }

  time(iso: string): string {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
      new Date(iso),
    );
  }

  /** "Cash is cheaper by $2.94 a month." */
  comparison(m: MedicationCost): string | null {
    if (m.cheaper === null || m.savingsCents === null) return null;
    if (m.cheaper === 'same') return 'Cash and your copay cost the same.';
    const by = dollars(m.savingsCents);
    return m.cheaper === 'cash'
      ? `Cash at Cost Plus is cheaper by ${by} a month.`
      : `Your copay is cheaper by ${by} a month.`;
  }
}
