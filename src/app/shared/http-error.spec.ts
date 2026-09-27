import { HttpErrorResponse } from '@angular/common/http';

import { httpErrorInfo } from './http-error';

describe('httpErrorInfo', () => {
  it('reads Angular HttpErrorResponse (browser)', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { statusMessage: 'Nope.', data: { code: 'no-data' } },
    });
    expect(httpErrorInfo(error)).toEqual({
      status: 409,
      statusMessage: 'Nope.',
      code: 'no-data',
    });
  });

  it('reads Nitro/ofetch FetchError (server-side rendering)', () => {
    const error = Object.assign(new Error('[GET] "/api/interactions/current": 409'), {
      name: 'FetchError',
      status: 409,
      statusCode: 409,
      data: {
        statusMessage: 'Interaction data has not been imported yet.',
        data: { code: 'no-data' },
      },
    });
    expect(httpErrorInfo(error)).toEqual({
      status: 409,
      statusMessage: 'Interaction data has not been imported yet.',
      code: 'no-data',
    });
  });

  it('returns status 0 for anything else', () => {
    expect(httpErrorInfo(new Error('boom'))).toEqual({
      status: 0,
      statusMessage: undefined,
      code: undefined,
    });
    expect(httpErrorInfo('x')).toEqual({ status: 0, statusMessage: undefined, code: undefined });
  });
});
