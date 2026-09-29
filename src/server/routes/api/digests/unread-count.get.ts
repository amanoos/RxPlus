import { defineEventHandler } from 'h3';

import { digestService } from '../../../digest/service';
import { requireUser } from '../../../utils/auth-user';

/** For the navigation badge. */
export default defineEventHandler((event) => digestService(requireUser(event).id).unreadCount());
