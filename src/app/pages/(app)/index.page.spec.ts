import { TestBed } from '@angular/core/testing';

import DashboardPage from './index.page';

describe('DashboardPage', () => {
  it('renders the dashboard heading', async () => {
    await TestBed.configureTestingModule({ imports: [DashboardPage] }).compileComponents();
    const fixture = TestBed.createComponent(DashboardPage);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(
      'Dashboard',
    );
  });
});
