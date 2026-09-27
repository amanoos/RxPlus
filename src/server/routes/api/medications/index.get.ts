import { defineEventHandler } from 'h3';

import { medicationsService } from '../../../medications/service';

export default defineEventHandler(() => medicationsService().list());
