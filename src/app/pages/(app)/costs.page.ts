import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RouteMeta } from '@analogjs/router';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { EditMedicationDialogComponent } from '../../features/medications/edit-medication-dialog.component';
import { MedicationsActions } from '../../features/medications/store/medications.actions';
import { selectAllMedications } from '../../features/medications/store/medications.reducer';
import { dollars, type CostRow } from '../../features/pricing/pricing';
import { PricingActions } from '../../features/pricing/store/pricing.actions';
import { pricingFeature } from '../../features/pricing/store/pricing.reducer';

export const routeMeta: RouteMeta = { title: 'Costs · RxPlus' };

@Component({
  selector: 'app-costs-page',
  imports: [RouterLink, ButtonModule, MessageModule, EditMedicationDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold">Costs</h1>
    <p class="mt-1 text-sm text-surface-600 dark:text-surface-300">
      What your current medications cost a month: paying cash at Cost Plus Drugs, or your copay with
      insurance. Cost Plus prices are its list prices (plus per-order fees), not a quote; copays are
      what you entered.
    </p>

    @if (!costs()) {
      <p class="mt-6 text-sm">Loading…</p>
    }
    @if (costs(); as c) {
      @if (c.status === 'loading' && !c.data) {
        <p class="mt-6 text-sm">Loading…</p>
      } @else if (c.status === 'error' && !c.data) {
        <p-message severity="error" styleClass="mt-6" data-testid="costs-error">{{
          c.error
        }}</p-message>
      } @else if (c.data; as data) {
        @if (!data.rows.length) {
          <p class="mt-6 text-sm" data-testid="no-medications">
            You have no active medications. Add one on the
            <a routerLink="/medications" class="underline">Medications</a> page.
          </p>
        } @else {
          <table class="mt-6 hidden w-full text-left text-sm md:table" data-testid="costs-table">
            <thead class="border-b border-surface-200 dark:border-surface-700">
              <tr>
                <th scope="col" class="py-2 pr-3 font-medium">Medication</th>
                <th scope="col" class="px-3 py-2 text-right font-medium">Units / month</th>
                <th scope="col" class="px-3 py-2 text-right font-medium">Cost Plus cash</th>
                <th scope="col" class="px-3 py-2 text-right font-medium">Your copay</th>
                <th scope="col" class="px-3 py-2 font-medium">Cheaper</th>
                <th scope="col" class="py-2 pl-3"><span class="sr-only">Edit</span></th>
              </tr>
            </thead>
            <tbody>
              @for (row of data.rows; track row.medicationId) {
                <tr
                  class="border-b border-surface-100 dark:border-surface-800"
                  data-testid="cost-row"
                >
                  <th scope="row" class="py-2 pr-3 font-normal">
                    <a class="underline" [routerLink]="['/drugs', row.rxcui]">{{ row.name }}</a>
                  </th>
                  <td class="px-3 py-2 text-right">{{ row.unitsPerMonth }}</td>
                  <td class="px-3 py-2 text-right">
                    @if (row.price) {
                      <a
                        class="underline"
                        [href]="row.price.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ money(row.cashCents) }}</a
                      >
                    } @else {
                      <span class="text-surface-600 dark:text-surface-300">{{
                        missingPrice(row)
                      }}</span>
                    }
                  </td>
                  <td class="px-3 py-2 text-right">{{ money(row.insuredCents) }}</td>
                  <td class="px-3 py-2">{{ cheaper(row) }}</td>
                  <td class="py-2 pl-3 text-right">
                    <p-button
                      label="Edit"
                      size="small"
                      severity="secondary"
                      [text]="true"
                      [ariaLabel]="'Edit units and copay: ' + row.name"
                      (onClick)="edit(row.medicationId)"
                    />
                  </td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr class="font-semibold" data-testid="totals">
                <th scope="row" class="py-2 pr-3">Total a month</th>
                <td></td>
                <td class="px-3 py-2 text-right">{{ money(data.totals.cashCents) }}</td>
                <td class="px-3 py-2 text-right">{{ money(data.totals.insuredCents) }}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>

          <ul class="mt-6 flex flex-col gap-3 md:hidden" data-testid="costs-cards">
            @for (row of data.rows; track row.medicationId) {
              <li class="rounded border border-surface-200 p-3 text-sm dark:border-surface-700">
                <a class="font-medium underline" [routerLink]="['/drugs', row.rxcui]">{{
                  row.name
                }}</a>
                <p class="mt-1">{{ row.unitsPerMonth }} units a month</p>
                <p>
                  Cost Plus cash:
                  @if (row.price) {
                    {{ money(row.cashCents) }}
                  } @else {
                    {{ missingPrice(row) }}
                  }
                </p>
                <p>Your copay: {{ money(row.insuredCents) }}</p>
                @if (row.cheaper) {
                  <p class="font-medium">{{ cheaper(row) }}</p>
                }
                <p-button
                  label="Edit"
                  size="small"
                  severity="secondary"
                  [text]="true"
                  styleClass="-ml-3"
                  [ariaLabel]="'Edit units and copay: ' + row.name"
                  (onClick)="edit(row.medicationId)"
                />
              </li>
            }
            <li class="p-3 text-sm font-semibold">
              Total a month: {{ money(data.totals.cashCents) }} cash ·
              {{ money(data.totals.insuredCents) }} with insurance
            </li>
          </ul>

          @if (missingNote(); as note) {
            <p class="mt-3 text-sm text-surface-600 dark:text-surface-300" data-testid="missing">
              {{ note }}
            </p>
          }
        }
        @if (c.error) {
          <p class="mt-2 text-xs text-surface-600 dark:text-surface-300">{{ c.error }}</p>
        }
      }
    }

    <app-edit-medication-dialog
      [medication]="editing()"
      mode="edit"
      [visible]="!!editing()"
      (visibleChange)="$event || editingId.set(null)"
    />
  `,
})
export default class CostsPage implements OnInit {
  private readonly store = inject(Store);
  protected readonly costs = this.store.selectSignal(pricingFeature.selectCosts);
  private readonly medications = this.store.selectSignal(selectAllMedications);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editing = computed(
    () => this.medications().find((m) => m.id === this.editingId()) ?? null,
  );

  /** "Totals leave out: 1 without a Cost Plus price, 2 without a copay." */
  protected readonly missingNote = computed(() => {
    const t = this.costs()?.data?.totals;
    if (!t || (!t.missingPrice && !t.missingCopay)) return null;
    const parts = [
      t.missingPrice ? `${t.missingPrice} of ${t.medications} without a Cost Plus price` : '',
      t.missingCopay ? `${t.missingCopay} of ${t.medications} without a copay` : '',
    ].filter(Boolean);
    return `Totals leave out ${parts.join(' and ')}.`;
  });

  ngOnInit(): void {
    this.store.dispatch(PricingActions.loadCosts());
    this.store.dispatch(MedicationsActions.load());
  }

  edit(medicationId: string): void {
    this.editingId.set(medicationId);
  }

  money(cents: number | null): string {
    return cents === null ? '—' : dollars(cents);
  }

  missingPrice(row: CostRow): string {
    return row.status === 'unavailable' ? 'Unavailable right now' : 'Not sold';
  }

  cheaper(row: CostRow): string {
    if (row.cheaper === null || row.savingsCents === null) return '—';
    if (row.cheaper === 'same') return 'Same';
    const by = dollars(row.savingsCents);
    return row.cheaper === 'cash' ? `Cash, by ${by}` : `Copay, by ${by}`;
  }
}
