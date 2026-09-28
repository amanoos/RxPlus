import { createEntityAdapter, type EntityState } from '@ngrx/entity';
import { createFeature, createReducer, createSelector, on } from '@ngrx/store';

import { AuthActions } from '../../../core/auth/auth.actions';
import type { AlternativesResponse, Condition } from '../alternatives';
import { AlternativesActions } from './alternatives.actions';

export interface AlternativesEntry {
  rxcui: string;
  status: 'loading' | 'loaded' | 'error';
  data: AlternativesResponse | null;
  error: string | null;
  /** A condition chosen for this visit only (product not on the medication list). */
  visitCondition: Condition | null;
  /** A choice is being saved on the medication. */
  choosing: boolean;
  refreshing: boolean;
  timedOut: boolean;
  /** The lists before an optimistic hide/unhide, restored if it fails. */
  beforeHide: AlternativesResponse | null;
  hideError: string | null;
}

export type AlternativesState = EntityState<AlternativesEntry>;

const adapter = createEntityAdapter<AlternativesEntry>({ selectId: (e) => e.rxcui });

export const initialAlternativesState: AlternativesState = adapter.getInitialState();

const emptyEntry = (rxcui: string): AlternativesEntry => ({
  rxcui,
  status: 'loading',
  data: null,
  error: null,
  visitCondition: null,
  choosing: false,
  refreshing: false,
  timedOut: false,
  beforeHide: null,
  hideError: null,
});

type Changes = (entry: AlternativesEntry) => Partial<AlternativesEntry>;

const patch = (state: AlternativesState, rxcui: string, changes: Changes): AlternativesState => {
  const entry = state.entities[rxcui];
  return entry ? adapter.updateOne({ id: rxcui, changes: changes(entry) }, state) : state;
};

/** Moves an alternative out of the groups into `hidden`, or just out of `hidden`. */
function moveAlternative(
  data: AlternativesResponse,
  ingredient: string,
  target: string,
  hide: boolean,
): AlternativesResponse {
  return {
    ...data,
    ingredients: data.ingredients.map((lit) => {
      if (lit.rxcui !== ingredient) return lit;
      const g = lit.groups;
      if (!hide) {
        return {
          ...lit,
          groups: { ...g, hidden: g.hidden.filter((d) => d.ingredientRxcui !== target) },
        };
      }
      const all = [...g.newForCondition, ...g.sameClass, ...g.otherClasses.flatMap((c) => c.drugs)];
      const drug = all.find((d) => d.ingredientRxcui === target);
      const keep = <T extends { ingredientRxcui: string }>(list: T[]) =>
        list.filter((d) => d.ingredientRxcui !== target);
      return {
        ...lit,
        groups: {
          newForCondition: keep(g.newForCondition),
          sameClass: keep(g.sameClass),
          otherClasses: g.otherClasses
            .map((c) => ({ ...c, drugs: keep(c.drugs) }))
            .filter((c) => c.drugs.length),
          hidden: drug ? [...g.hidden, drug] : g.hidden,
        },
      };
    }),
  };
}

const loaded = (data: AlternativesResponse): Partial<AlternativesEntry> => ({
  status: 'loaded',
  data,
  error: null,
  beforeHide: null,
  choosing: false,
  refreshing: false,
});

export const alternativesFeature = createFeature({
  name: 'alternatives',
  reducer: createReducer(
    initialAlternativesState,
    on(AlternativesActions.open, (state, { rxcui }) =>
      state.entities[rxcui]
        ? patch(state, rxcui, () => ({ timedOut: false, hideError: null }))
        : adapter.addOne(emptyEntry(rxcui), state),
    ),
    on(AlternativesActions.loadSuccess, AlternativesActions.pollSuccess, (s, { rxcui, data }) =>
      patch(s, rxcui, () => loaded(data)),
    ),
    on(AlternativesActions.loadFailure, (s, { rxcui, error }) =>
      patch(s, rxcui, (e) => ({
        status: e.data ? 'loaded' : 'error',
        error,
        choosing: false,
        refreshing: false,
      })),
    ),
    on(AlternativesActions.chooseCondition, (s, { rxcui, condition, medicationId }) =>
      patch(s, rxcui, () =>
        medicationId
          ? { choosing: true, error: null }
          : { visitCondition: condition, choosing: true, error: null },
      ),
    ),
    on(AlternativesActions.clearCondition, (s, { rxcui, medicationId }) =>
      patch(s, rxcui, () =>
        medicationId ? { choosing: true, error: null } : { visitCondition: null, choosing: true },
      ),
    ),
    on(AlternativesActions.refresh, (s, { rxcui }) =>
      patch(s, rxcui, () => ({ refreshing: true, error: null, timedOut: false })),
    ),
    on(AlternativesActions.pollTimeout, (s, { rxcui }) =>
      patch(s, rxcui, () => ({ timedOut: true })),
    ),
    on(AlternativesActions.hide, AlternativesActions.unhide, (s, action) =>
      patch(s, action.rxcui, (e) =>
        e.data
          ? {
              beforeHide: e.beforeHide ?? e.data,
              hideError: null,
              data: moveAlternative(
                e.data,
                action.ingredient,
                action.target,
                action.type === AlternativesActions.hide.type,
              ),
            }
          : {},
      ),
    ),
    on(AlternativesActions.hideFailure, (s, { rxcui, error }) =>
      patch(s, rxcui, (e) => ({
        data: e.beforeHide ?? e.data,
        beforeHide: null,
        hideError: error,
      })),
    ),
    on(AuthActions.logoutSuccess, () => initialAlternativesState),
  ),
});

export const selectAlternatives = (rxcui: string) =>
  createSelector(alternativesFeature.selectEntities, (entities) => entities[rxcui] ?? null);
