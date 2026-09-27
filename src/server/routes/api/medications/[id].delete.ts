import { defineEventHandler, getValidatedRouterParams, sendNoContent } from 'h3';

import { medicationsService, MedicationIdParams } from '../../../medications/service';

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, MedicationIdParams.parse);
  await medicationsService().remove(id);
  return sendNoContent(event);
});
