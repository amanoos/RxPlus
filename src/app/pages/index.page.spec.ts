import { TestBed } from '@angular/core/testing';
import { providePrimeNG } from 'primeng/config';

import HomePage from './index.page';

describe('HomePage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [providePrimeNG()],
    }).compileComponents();
  });

  it('renders a PrimeNG button inside a Tailwind flex layout', async () => {
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;

    const button = el.querySelector('p-button button');
    expect(button?.textContent).toContain('Get started');
    expect(button?.closest('.flex')).not.toBeNull();
  });
});
