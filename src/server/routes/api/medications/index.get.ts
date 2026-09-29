import { defineEventHandler } from 'h3';

import { medicationsService } from '../../../medications/service';
import { requireUser } from '../../../utils/auth-user';

export default defineEventHandler((event) => medicationsService(requireUser(event).id).list());
