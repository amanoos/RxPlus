export interface HealthResult {
  statusCode: 200 | 503;
  body: { status: 'ok'; db: 'ok' } | { status: 'degraded'; db: 'down' };
}

/** Health of the app's dependencies. The ping error itself is never exposed. */
export async function checkHealth(pingDb: () => Promise<unknown>): Promise<HealthResult> {
  try {
    await pingDb();
    return { statusCode: 200, body: { status: 'ok', db: 'ok' } };
  } catch {
    return { statusCode: 503, body: { status: 'degraded', db: 'down' } };
  }
}
