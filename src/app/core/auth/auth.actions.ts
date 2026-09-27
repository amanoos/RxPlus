import { createActionGroup, emptyProps, props } from '@ngrx/store';

export const AuthActions = createActionGroup({
  source: 'Auth',
  events: {
    Login: props<{ password: string; redirectTo: string }>(),
    'Login Success': props<{ redirectTo: string }>(),
    'Login Failure': props<{ error: string }>(),
    Logout: emptyProps(),
    'Logout Success': emptyProps(),
    'Session Checked': props<{ authenticated: boolean }>(),
  },
});
