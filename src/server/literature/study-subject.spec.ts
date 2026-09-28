// @vitest-environment node
import { studySubject } from './study-subject';

describe('studySubject', () => {
  it('recognizes reviews, from the study type or the abstract', () => {
    expect(studySubject('Lisinopril and cough', '', 'meta-analysis')).toBe('review');
    expect(
      studySubject(
        'Retatrutide in schizophrenia',
        'This narrative review examines the rationale for investigating retatrutide.',
      ),
    ).toBe('review');
  });

  it('recognizes animal studies, even when patients are mentioned as motivation', () => {
    expect(
      studySubject(
        'Metformin in osteoarthritis',
        'Osteoarthritis affects many patients. Male Wistar rats received metformin for 8 weeks.',
      ),
    ).toBe('animal');
    expect(studySubject('Losartan and seizures in SE rats', 'Seizure frequency fell.')).toBe(
      'animal',
    );
  });

  it('recognizes lab studies', () => {
    expect(
      studySubject('Rosuvastatin polymorphs', 'Cell lines were exposed to rosuvastatin in vitro.'),
    ).toBe('lab');
    expect(studySubject('PBPK modeling of coproporphyrin I', 'We built a model.')).toBe('lab');
  });

  it('recognizes studies in people, and says nothing when the words don’t say', () => {
    expect(
      studySubject(
        'Empagliflozin and metformin FDC',
        'In this real-world study, 12,000 adults with type 2 diabetes were followed.',
      ),
    ).toBe('human');
    expect(
      studySubject('Polyamorphism of rosuvastatin', 'Relaxation behaviour was measured.'),
    ).toBe(null);
  });
});
