import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { REQUEST } from '@analogjs/router/tokens';

/**
 * During SSR, forward the browser's cookie to our own API so server-rendered
 * pages see the user's session. Analog's requestContextInterceptor only makes
 * the URL absolute; it doesn't carry cookies. Runs before it, while URLs are
 * still relative, and never touches requests to other hosts.
 */
export const forwardCookieInterceptor: HttpInterceptorFn = (req, next) => {
  const cookie = inject(REQUEST, { optional: true })?.headers?.cookie;
  const isSameOrigin = req.url.startsWith('/') && !req.url.startsWith('//');
  if (!cookie || !isSameOrigin) return next(req);
  return next(req.clone({ setHeaders: { cookie } }));
};
