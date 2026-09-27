import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import type { Medication, MedicationChanges, NewMedication } from './medication';

@Injectable({ providedIn: 'root' })
export class MedicationsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<Medication[]> {
    return this.http.get<Medication[]>('/api/medications');
  }

  add(body: NewMedication): Observable<Medication> {
    return this.http.post<Medication>('/api/medications', body);
  }

  update(id: string, changes: MedicationChanges): Observable<Medication> {
    return this.http.patch<Medication>(`/api/medications/${id}`, changes);
  }

  remove(id: string): Observable<null> {
    return this.http.delete<null>(`/api/medications/${id}`);
  }
}
