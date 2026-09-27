import { defineEventHandler, setResponseStatus } from 'h3';

import { db, pingDb } from '../../db/client';
import { checkHealth } from '../../utils/health';

export default defineEventHandler(async (event) => {
  const { statusCode, body } = await checkHealth(() => pingDb(db()));
  setResponseStatus(event, statusCode);
  return body;
});
