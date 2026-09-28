import { defineEventHandler, setResponseStatus } from 'h3';

import { digestService } from '../../../digest/service';

/** "Run now": collects a digest in the background; 409 while one is running. */
export default defineEventHandler(async (event) => {
  const running = await digestService().run();
  setResponseStatus(event, 202);
  return running;
});
