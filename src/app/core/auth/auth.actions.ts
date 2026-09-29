import { createActionGroup, emptyProps, props } from '@ngrx/store';

import type { AuthUser } from './auth-api.service';

export const AuthActions = createActionGroup({
  source: 'Auth',
  events: {
    Login: props<{ username: string; password: string; redirectTo: string }>(),
    'Login Success': props<{ user: AuthUser; redirectTo: string }>(),
    'Login Failure': props<{ error: string }>(),
    Logout: emptyProps(),
    'Logout Success': emptyProps(),
    'Session Checked': props<{ user: AuthUser | null }>(),
  },
});
