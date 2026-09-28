import { defineEventHandler } from 'h3';

import { digestService } from '../../../digest/service';

/** Recent digests grouped by drug, the running one, and the next scheduled run. */
export default defineEventHandler(() => digestService().list());
