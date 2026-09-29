import { defineEventHandler } from 'h3';

import { requireUser } from '../../../utils/auth-user';

export default defineEventHandler((event) => ({ authenticated: true, user: requireUser(event) }));
