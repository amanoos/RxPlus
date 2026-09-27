import { createEntityAdapter, type EntityState } from '@ngrx/entity';
import { createFeature, createReducer, createSelector, on } from '@ngrx/store';

import { AuthActions } from '../../../core/auth/auth.actions';
import type { Medication } from '../medication';
import { MedicationsActions } from './medications.actions';

export interface MedicationsState extends EntityState<Medication> {
  loaded: boolean;
  saving: boolean;
  error: string | null;
}

/** Active before stopped, then newest first (same order as the API). */
function compare(a: Medication, b: Medication): number {
  const active = Number(b.stoppedOn === null) - Number(a.stoppedOn === null);
  return active || b.createdAt.localeCompare(a.createdAt);
}

const adapter = createEntityAdapter<Medication>({ sortComparer: compare });

export const initialMedicationsState: MedicationsState = adapter.getInitialState({
  loaded: false,
  saving: false,
  error: null,
});

const saving = (state: MedicationsState): MedicationsState => ({
  ...state,
  saving: true,
  error: null,
});
const failed = (state: MedicationsState, { error }: { error: string }): MedicationsState => ({
  ...state,
  saving: false,
  error,
});

export const medicationsFeature = createFeature({
  name: 'medications',
  reducer: createReducer(
    initialMedicationsState,
    on(MedicationsActions.loadSuccess, (state, { medications }) =>
      adapter.setAll(medications, { ...state, loaded: true, error: null }),
    ),
    on(MedicationsActions.loadFailure, (state, { error }) => ({ ...state, error })),
    on(MedicationsActions.add, MedicationsActions.update, MedicationsActions.remove, saving),
    on(MedicationsActions.addSuccess, (state, { medication }) =>
      adapter.addOne(medication, { ...state, saving: false }),
    ),
    on(MedicationsActions.updateSuccess, (state, { medication }) =>
      adapter.upsertOne(medication, { ...state, saving: false }),
    ),
    on(MedicationsActions.removeSuccess, (state, { id }) =>
      adapter.removeOne(id, { ...state, saving: false }),
    ),
    on(
      MedicationsActions.addFailure,
      MedicationsActions.updateFailure,
      MedicationsActions.removeFailure,
      failed,
    ),
    on(MedicationsActions.clearError, (state) => ({ ...state, error: null })),
    on(AuthActions.logoutSuccess, () => initialMedicationsState),
  ),
  extraSelectors: ({ selectMedicationsState }) => {
    const { selectAll } = adapter.getSelectors(selectMedicationsState);
    return {
      selectAll,
      selectActive: createSelector(selectAll, (all) => all.filter((m) => m.stoppedOn === null)),
      selectStopped: createSelector(selectAll, (all) => all.filter((m) => m.stoppedOn !== null)),
    };
  },
});

export const {
  selectAll: selectAllMedications,
  selectActive: selectActiveMedications,
  selectStopped: selectStoppedMedications,
  selectLoaded: selectMedicationsLoaded,
  selectSaving: selectMedicationsSaving,
  selectError: selectMedicationsError,
} = medicationsFeature;
