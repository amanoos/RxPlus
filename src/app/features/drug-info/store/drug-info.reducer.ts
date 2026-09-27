import { createEntityAdapter, type EntityState, type Update } from '@ngrx/entity';
import { createFeature, createReducer, createSelector, on } from '@ngrx/store';

import { AuthActions } from '../../../core/auth/auth.actions';
import type { DrugFacts, DrugSummary, ReportedReactions } from '../drug-info';
import { DrugInfoActions } from './drug-info.actions';

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface Remote<T> {
  status: LoadStatus;
  data: T | null;
  error: string | null;
}

export interface SummaryState {
  /** `none`: no summary for the current label yet. */
  status: 'idle' | 'loading' | 'none' | 'pending' | 'ready' | 'failed' | 'error';
  data: DrugSummary | null;
  error: string | null;
  /** A start request is in flight. */
  starting: boolean;
  /** Polling gave up while the summary was still pending. */
  timedOut: boolean;
}

export interface DrugInfoEntry {
  rxcui: string;
  facts: Remote<DrugFacts>;
  reactions: Remote<ReportedReactions>;
  summary: SummaryState;
}

export type DrugInfoState = EntityState<DrugInfoEntry>;

const adapter = createEntityAdapter<DrugInfoEntry>({ selectId: (e) => e.rxcui });

export const initialDrugInfoState: DrugInfoState = adapter.getInitialState();

const loading = <T>(previous?: Remote<T>): Remote<T> => ({
  status: 'loading',
  data: previous?.data ?? null,
  error: null,
});

const emptyEntry = (rxcui: string): DrugInfoEntry => ({
  rxcui,
  facts: loading(),
  reactions: loading(),
  summary: { status: 'loading', data: null, error: null, starting: false, timedOut: false },
});

/** Applies a summary response (or its absence) from any source. */
function withSummary(summary: DrugSummary | null): Pick<SummaryState, 'status' | 'data' | 'error'> {
  if (!summary) return { status: 'none', data: null, error: null };
  return { status: summary.status, data: summary, error: summary.error };
}

type Changes = (entry: DrugInfoEntry) => Partial<DrugInfoEntry>;

/** Updates an entry that is still in the store (ignores late responses after logout). */
const patch = (state: DrugInfoState, rxcui: string, changes: Changes): DrugInfoState => {
  const entry = state.entities[rxcui];
  if (!entry) return state;
  const update: Update<DrugInfoEntry> = { id: rxcui, changes: changes(entry) };
  return adapter.updateOne(update, state);
};

export const drugInfoFeature = createFeature({
  name: 'drugInfo',
  reducer: createReducer(
    initialDrugInfoState,
    on(DrugInfoActions.openDrug, (state, { rxcui }) => {
      const entry = state.entities[rxcui];
      if (!entry) return adapter.addOne(emptyEntry(rxcui), state);
      // Reopening keeps what's loaded on screen while it refreshes.
      return adapter.updateOne(
        {
          id: rxcui,
          changes: {
            facts: loading(entry.facts),
            reactions: loading(entry.reactions),
            summary: { ...entry.summary, timedOut: false },
          },
        },
        state,
      );
    }),
    on(DrugInfoActions.loadFactsSuccess, (s, { rxcui, facts }) =>
      patch(s, rxcui, () => ({ facts: { status: 'loaded', data: facts, error: null } })),
    ),
    on(DrugInfoActions.loadFactsFailure, (s, { rxcui, error }) =>
      patch(s, rxcui, (e) => ({ facts: { status: 'error', data: e.facts.data, error } })),
    ),
    on(DrugInfoActions.loadReactionsSuccess, (s, { rxcui, reactions }) =>
      patch(s, rxcui, () => ({ reactions: { status: 'loaded', data: reactions, error: null } })),
    ),
    on(DrugInfoActions.loadReactionsFailure, (s, { rxcui, error }) =>
      patch(s, rxcui, (e) => ({ reactions: { status: 'error', data: e.reactions.data, error } })),
    ),
    on(
      DrugInfoActions.loadSummarySuccess,
      DrugInfoActions.pollSummarySuccess,
      (s, { rxcui, summary }) =>
        patch(s, rxcui, (e) => ({ summary: { ...e.summary, ...withSummary(summary) } })),
    ),
    on(DrugInfoActions.loadSummaryFailure, (s, { rxcui, error }) =>
      patch(s, rxcui, (e) => ({ summary: { ...e.summary, status: 'error', error } })),
    ),
    on(DrugInfoActions.startSummary, (s, { rxcui }) =>
      patch(s, rxcui, (e) => ({
        summary: { ...e.summary, starting: true, timedOut: false, error: null },
      })),
    ),
    on(DrugInfoActions.startSummarySuccess, (s, { rxcui, summary }) =>
      patch(s, rxcui, (e) => ({
        summary: { ...e.summary, ...withSummary(summary), starting: false },
      })),
    ),
    // The stored summary (if any) stays; the error explains why a new one didn't start.
    on(DrugInfoActions.startSummaryFailure, (s, { rxcui, error }) =>
      patch(s, rxcui, (e) => ({ summary: { ...e.summary, starting: false, error } })),
    ),
    on(DrugInfoActions.pollSummaryTimeout, (s, { rxcui }) =>
      patch(s, rxcui, (e) => ({ summary: { ...e.summary, timedOut: true } })),
    ),
    on(AuthActions.logoutSuccess, () => initialDrugInfoState),
  ),
});

export const selectDrugInfo = (rxcui: string) =>
  createSelector(drugInfoFeature.selectEntities, (entities) => entities[rxcui] ?? null);
