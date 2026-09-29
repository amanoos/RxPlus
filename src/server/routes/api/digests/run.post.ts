import { defineEventHandler, setResponseStatus } from 'h3';

import { digestService } from '../../../digest/service';
import { requireUser } from '../../../utils/auth-user';

/** "Run now": collects a digest in the background; 409 while one is running. */
export default defineEventHandler(async (event) => {
  const running = await digestService(requireUser(event).id).run();
  setResponseStatus(event, 202);
  return running;
});
