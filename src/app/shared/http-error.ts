import { HttpErrorResponse } from '@angular/common/http';

export interface HttpErrorInfo {
  /** HTTP status, or 0 when unknown (network error, unexpected throw). */
  status: number;
  /** h3's statusMessage from the error body, if any. */
  statusMessage?: string;
  /** Machine-readable code from the error body's `data.code`, if any. */
  code?: string;
}

interface H3ErrorBody {
  statusMessage?: string;
  data?: { code?: string };
}

/**
 * Status and h3 error body from a failed API call. In the browser that's an
 * HttpErrorResponse; during SSR, Analog calls the API through Nitro's $fetch,
 * which rejects with an ofetch FetchError (status + parsed body in `data`).
 */
export function httpErrorInfo(error: unknown): HttpErrorInfo {
  let status = 0;
  let body: H3ErrorBody | null | undefined;
  if (error instanceof HttpErrorResponse) {
    status = error.status;
    body = error.error as H3ErrorBody | null;
  } else if (error && typeof error === 'object') {
    const e = error as { status?: unknown; statusCode?: unknown; data?: unknown };
    const s = e.status ?? e.statusCode;
    if (typeof s === 'number') {
      status = s;
      body = e.data as H3ErrorBody | undefined;
    }
  }
  return {
    status,
    statusMessage: typeof body?.statusMessage === 'string' ? body.statusMessage : undefined,
    code: typeof body?.data?.code === 'string' ? body.data.code : undefined,
  };
}
