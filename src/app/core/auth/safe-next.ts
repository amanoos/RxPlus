const ORIGIN = 'http://rxplus.invalid';

/**
 * The post-login redirect target from `?next=`, only if it is a same-origin
 * relative path (never protocol-relative, absolute, or back to /login). Else `/`.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/';
  }
  const url = new URL(next, ORIGIN);
  if (url.origin !== ORIGIN || url.pathname === '/login') return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
