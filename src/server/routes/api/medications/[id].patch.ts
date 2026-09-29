import { defineEventHandler, getValidatedRouterParams, readValidatedBody } from 'h3';

import {
  medicationsService,
  MedicationIdParams,
  UpdateMedicationBody,
} from '../../../medications/service';
import { requireUser } from '../../../utils/auth-user';

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, MedicationIdParams.parse);
  const patch = await readValidatedBody(event, UpdateMedicationBody.parse);
  return medicationsService(requireUser(event).id).update(id, patch);
});
