import { defineEventHandler, getValidatedRouterParams, sendNoContent } from 'h3';

import { medicationsService, MedicationIdParams } from '../../../medications/service';
import { requireUser } from '../../../utils/auth-user';

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, MedicationIdParams.parse);
  await medicationsService(requireUser(event).id).remove(id);
  return sendNoContent(event);
});
