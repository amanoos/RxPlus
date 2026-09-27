import { defineEventHandler } from 'h3';

import { interactionsService } from '../../../interactions/service';

export default defineEventHandler(() => interactionsService().current());
