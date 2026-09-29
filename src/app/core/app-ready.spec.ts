import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AppReady } from './app-ready';

@Component({ template: '' })
class Host {
  readonly ready = inject(AppReady).isReady;
}

describe('AppReady', () => {
  it('becomes ready after the first browser render, and marks the page', async () => {
    document.documentElement.removeAttribute('data-hydrated');
    const fixture = TestBed.createComponent(Host);
    const ready = fixture.componentInstance.ready;
    expect(ready()).toBe(false);
    await fixture.whenStable();
    expect(ready()).toBe(true);
    expect(document.documentElement.hasAttribute('data-hydrated')).toBe(true);
  });
});
