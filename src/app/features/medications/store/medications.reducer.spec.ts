import { AuthActions } from '../../../core/auth/auth.actions';
import { medicationFixture } from '../medication.fixture';
import { MedicationsActions } from './medications.actions';
import { initialMedicationsState, medicationsFeature } from './medications.reducer';

const { reducer } = medicationsFeature;
const state = (...actions: Parameters<typeof reducer>[1][]) =>
  actions.reduce(reducer, initialMedicationsState);

const older = medicationFixture({ id: 'a', createdAt: '2026-01-01T00:00:00Z' });
const newer = medicationFixture({ id: 'b', rxcui: '2', createdAt: '2026-02-01T00:00:00Z' });
const stopped = medicationFixture({
  id: 'c',
  rxcui: '3',
  createdAt: '2026-03-01T00:00:00Z',
  stoppedOn: '2026-04-01',
});

describe('medications reducer', () => {
  it('starts empty and not loaded', () => {
    expect(initialMedicationsState).toMatchObject({
      ids: [],
      loaded: false,
      saving: false,
      error: null,
    });
  });

  it('stores loaded medications active first, newest first', () => {
    const s = state(MedicationsActions.loadSuccess({ medications: [older, stopped, newer] }));
    expect(s.ids).toEqual(['b', 'a', 'c']);
    expect(s.loaded).toBe(true);
  });

  it('tracks saving and errors for writes', () => {
    let s = state(MedicationsActions.add({ rxcui: '314076' }));
    expect(s.saving).toBe(true);
    s = reducer(s, MedicationsActions.addFailure({ error: 'Nope.' }));
    expect(s).toMatchObject({ saving: false, error: 'Nope.' });
    s = reducer(s, MedicationsActions.clearError());
    expect(s.error).toBeNull();
  });

  it('adds, updates and removes entities', () => {
    let s = state(
      MedicationsActions.loadSuccess({ medications: [older] }),
      MedicationsActions.addSuccess({ medication: newer }),
    );
    expect(s.ids).toEqual(['b', 'a']);

    s = reducer(
      s,
      MedicationsActions.updateSuccess({ medication: { ...newer, stoppedOn: '2026-05-01' } }),
    );
    expect(s.ids).toEqual(['a', 'b']);
    expect(s.entities['b']?.stoppedOn).toBe('2026-05-01');

    s = reducer(s, MedicationsActions.removeSuccess({ id: 'a' }));
    expect(s.ids).toEqual(['b']);
  });

  it('resets on logout', () => {
    const s = state(
      MedicationsActions.loadSuccess({ medications: [older] }),
      AuthActions.logoutSuccess(),
    );
    expect(s).toEqual(initialMedicationsState);
  });

  it('selects active and stopped medications', () => {
    const root = {
      medications: state(MedicationsActions.loadSuccess({ medications: [older, stopped, newer] })),
    };
    expect(medicationsFeature.selectActive(root).map((m) => m.id)).toEqual(['b', 'a']);
    expect(medicationsFeature.selectStopped(root).map((m) => m.id)).toEqual(['c']);
  });
});
