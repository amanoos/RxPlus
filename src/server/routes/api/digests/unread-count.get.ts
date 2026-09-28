import { defineEventHandler } from 'h3';

import { digestService } from '../../../digest/service';

/** For the navigation badge. */
export default defineEventHandler(() => digestService().unreadCount());
