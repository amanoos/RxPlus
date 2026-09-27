import { defineEventHandler, getValidatedQuery } from 'h3';
import { z } from 'zod';

import { rxnav } from '../../../rxnorm';
import { toHttpError } from '../../../rxnorm/errors';

const Query = z.object({ q: z.string().trim().min(2).max(100) });

export default defineEventHandler(async (event) => {
  const { q } = await getValidatedQuery(event, Query.parse);
  try {
    return await rxnav().search(q);
  } catch (error) {
    throw toHttpError(error);
  }
});
