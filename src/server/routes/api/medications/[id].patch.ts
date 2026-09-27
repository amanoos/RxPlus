import { defineEventHandler, getValidatedRouterParams, readValidatedBody } from 'h3';

import {
  medicationsService,
  MedicationIdParams,
  UpdateMedicationBody,
} from '../../../medications/service';

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, MedicationIdParams.parse);
  const patch = await readValidatedBody(event, UpdateMedicationBody.parse);
  return medicationsService().update(id, patch);
});
