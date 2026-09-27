import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface RxProduct {
  rxcui: string;
  name: string;
  tty: 'SCD' | 'SBD';
  brandName: string | null;
}

/** Server proxy for RxNorm lookups (the browser never calls RxNav directly). */
@Injectable({ providedIn: 'root' })
export class RxNormApi {
  private readonly http = inject(HttpClient);

  search(query: string): Observable<string[]> {
    return this.http.get<string[]>('/api/rxnorm/search', { params: { q: query } });
  }

  products(name: string): Observable<RxProduct[]> {
    return this.http.get<RxProduct[]>('/api/rxnorm/products', { params: { name } });
  }
}

const firstNumber = (name: string) => Number(/\d+(\.\d+)?/.exec(name)?.[0] ?? Infinity);

/** Single-ingredient before combinations, generics before brands, then by strength and name. */
export function sortProducts(products: RxProduct[]): RxProduct[] {
  const key = (p: RxProduct) => [Number(p.name.includes(' / ')), Number(p.tty === 'SBD')];
  return [...products].sort((a, b) => {
    const [ac, ab] = key(a);
    const [bc, bb] = key(b);
    return (
      ac - bc ||
      ab - bb ||
      firstNumber(a.name) - firstNumber(b.name) ||
      a.name.localeCompare(b.name)
    );
  });
}

export function lookupErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && (error.status === 503 || error.status === 0)) {
    return 'Drug lookup is unavailable right now.';
  }
  return 'Drug lookup failed. Please try again.';
}
