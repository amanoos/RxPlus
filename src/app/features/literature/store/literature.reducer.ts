import { createEntityAdapter, type EntityState } from '@ngrx/entity';
import { createFeature, createReducer, createSelector, on } from '@ngrx/store';

import { AuthActions } from '../../../core/auth/auth.actions';
import type { LiteratureResponse } from '../literature';
import { LiteratureActions } from './literature.actions';

export interface LiteratureEntry {
  /** Product RXCUI of the drug page. */
  rxcui: string;
  status: 'loading' | 'loaded' | 'error';
  data: LiteratureResponse | null;
  error: string | null;
  refreshing: boolean;
  /** A takeaway start request is in flight. */
  starting: boolean;
  /** Why takeaways couldn't start (e.g. no model configured, daily limit). */
  startError: string | null;
  /** Polling gave up while takeaways were still being written. */
  timedOut: boolean;
  /** The lists before an optimistic hide/unhide, restored if it fails. */
  beforeHide: LiteratureResponse | null;
  hideError: string | null;
}

export type LiteratureState = EntityState<LiteratureEntry>;

const adapter = createEntityAdapter<LiteratureEntry>({ selectId: (e) => e.rxcui });

export const initialLiteratureState: LiteratureState = adapter.getInitialState();

const emptyEntry = (rxcui: string): LiteratureEntry => ({
  rxcui,
  status: 'loading',
  data: null,
  error: null,
  refreshing: false,
  starting: false,
  startError: null,
  timedOut: false,
  beforeHide: null,
  hideError: null,
});

type Changes = (entry: LiteratureEntry) => Partial<LiteratureEntry>;

/** Updates an entry that is still in the store (ignores late responses after logout). */
const patch = (state: LiteratureState, rxcui: string, changes: Changes): LiteratureState => {
  const entry = state.entities[rxcui];
  return entry ? adapter.updateOne({ id: rxcui, changes: changes(entry) }, state) : state;
};

/** Moves a paper between the shown and hidden lists of one ingredient. */
function movePaper(
  data: LiteratureResponse,
  ingredient: string,
  pmid: string,
  hide: boolean,
): LiteratureResponse {
  return {
    ingredients: data.ingredients.map((lit) => {
      if (lit.rxcui !== ingredient) return lit;
      const from = hide ? lit.papers : lit.hidden;
      const paper = from.find((p) => p.pmid === pmid);
      if (!paper) return lit;
      const rest = from.filter((p) => p.pmid !== pmid);
      return hide
        ? { ...lit, papers: rest, hidden: [...lit.hidden, paper] }
        : { ...lit, hidden: rest, papers: [...lit.papers, paper] };
    }),
  };
}

const loaded = (data: LiteratureResponse): Partial<LiteratureEntry> => ({
  status: 'loaded',
  data,
  error: null,
  beforeHide: null,
});

export const literatureFeature = createFeature({
  name: 'literature',
  reducer: createReducer(
    initialLiteratureState,
    on(LiteratureActions.openResearch, (state, { rxcui }) =>
      state.entities[rxcui]
        ? patch(state, rxcui, () => ({ timedOut: false, hideError: null }))
        : adapter.addOne(emptyEntry(rxcui), state),
    ),
    on(LiteratureActions.loadSuccess, LiteratureActions.pollSuccess, (s, { rxcui, data }) =>
      patch(s, rxcui, () => loaded(data)),
    ),
    on(LiteratureActions.loadFailure, (s, { rxcui, error }) =>
      patch(s, rxcui, (e) => ({ status: e.data ? 'loaded' : 'error', error })),
    ),
    on(LiteratureActions.refresh, (s, { rxcui }) =>
      patch(s, rxcui, () => ({ refreshing: true, error: null })),
    ),
    on(LiteratureActions.refreshSuccess, (s, { rxcui, data }) =>
      patch(s, rxcui, () => ({ ...loaded(data), refreshing: false })),
    ),
    // The stored lists stay on screen; the error explains why nothing changed.
    on(LiteratureActions.refreshFailure, (s, { rxcui, error }) =>
      patch(s, rxcui, () => ({ refreshing: false, error })),
    ),
    on(LiteratureActions.startTakeaways, (s, { rxcui }) =>
      patch(s, rxcui, () => ({ starting: true, startError: null, timedOut: false })),
    ),
    on(LiteratureActions.startTakeawaysSuccess, (s, { rxcui, data }) =>
      patch(s, rxcui, () => ({ ...loaded(data), starting: false })),
    ),
    on(LiteratureActions.startTakeawaysFailure, (s, { rxcui, error }) =>
      patch(s, rxcui, () => ({ starting: false, startError: error })),
    ),
    on(LiteratureActions.pollTimeout, (s, { rxcui }) =>
      patch(s, rxcui, () => ({ timedOut: true })),
    ),
    on(LiteratureActions.hidePaper, LiteratureActions.unhidePaper, (s, action) =>
      patch(s, action.rxcui, (e) =>
        e.data
          ? {
              beforeHide: e.beforeHide ?? e.data,
              hideError: null,
              data: movePaper(
                e.data,
                action.ingredient,
                action.pmid,
                action.type === LiteratureActions.hidePaper.type,
              ),
            }
          : {},
      ),
    ),
    on(LiteratureActions.hideFailure, (s, { rxcui, error }) =>
      patch(s, rxcui, (e) => ({
        data: e.beforeHide ?? e.data,
        beforeHide: null,
        hideError: error,
      })),
    ),
    on(AuthActions.logoutSuccess, () => initialLiteratureState),
  ),
});

export const selectLiterature = (rxcui: string) =>
  createSelector(literatureFeature.selectEntities, (entities) => entities[rxcui] ?? null);
