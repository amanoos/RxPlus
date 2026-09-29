import { defineEventHandler } from 'h3';

import { digestService } from '../../../digest/service';
import { requireUser } from '../../../utils/auth-user';

/** Recent digests grouped by drug, the running one, and the next scheduled run. */
export default defineEventHandler((event) => digestService(requireUser(event).id).list());
