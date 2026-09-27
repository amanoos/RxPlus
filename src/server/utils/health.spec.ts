// @vitest-environment node
import { checkHealth } from './health';

describe('checkHealth', () => {
  it('reports ok when the database answers', async () => {
    expect(await checkHealth(async () => undefined)).toEqual({
      statusCode: 200,
      body: { status: 'ok', db: 'ok' },
    });
  });

  it('reports degraded when the database ping fails', async () => {
    const ping = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    expect(await checkHealth(ping)).toEqual({
      statusCode: 503,
      body: { status: 'degraded', db: 'down' },
    });
  });
});
