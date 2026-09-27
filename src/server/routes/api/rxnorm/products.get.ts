import { defineEventHandler, getValidatedQuery } from 'h3';
import { z } from 'zod';

import { rxnav } from '../../../rxnorm';
import { toHttpError } from '../../../rxnorm/errors';

const Query = z.object({ name: z.string().trim().min(1).max(200) });

export default defineEventHandler(async (event) => {
  const { name } = await getValidatedQuery(event, Query.parse);
  try {
    return await rxnav().products(name);
  } catch (error) {
    throw toHttpError(error);
  }
});
