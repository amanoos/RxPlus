import { defineEventHandler, readValidatedBody, setResponseStatus } from 'h3';

import { AddMedicationBody, medicationsService } from '../../../medications/service';
import { requireUser } from '../../../utils/auth-user';

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, AddMedicationBody.parse);
  const created = await medicationsService(requireUser(event).id).add(body);
  setResponseStatus(event, 201);
  return created;
});
