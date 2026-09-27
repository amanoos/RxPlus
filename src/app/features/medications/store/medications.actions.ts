import { createActionGroup, emptyProps, props } from '@ngrx/store';

import type { Medication, MedicationChanges, NewMedication } from '../medication';

export const MedicationsActions = createActionGroup({
  source: 'Medications',
  events: {
    Load: emptyProps(),
    'Load Success': props<{ medications: Medication[] }>(),
    'Load Failure': props<{ error: string }>(),
    Add: props<NewMedication>(),
    'Add Success': props<{ medication: Medication }>(),
    'Add Failure': props<{ error: string }>(),
    Update: props<{ id: string; changes: MedicationChanges }>(),
    'Update Success': props<{ medication: Medication }>(),
    'Update Failure': props<{ error: string }>(),
    Remove: props<{ id: string }>(),
    'Remove Success': props<{ id: string }>(),
    'Remove Failure': props<{ error: string }>(),
    'Clear Error': emptyProps(),
  },
});
