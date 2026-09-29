import { defineEventHandler } from 'h3';

import { interactionsService } from '../../../interactions/service';
import { requireUser } from '../../../utils/auth-user';

export default defineEventHandler((event) => interactionsService(requireUser(event).id).current());
