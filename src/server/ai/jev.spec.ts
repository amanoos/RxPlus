// @vitest-environment node
import {
  jevBody,
  jevHeaders,
  jevUrl,
  readSubjects,
  readSupport,
  SUBJECT_CRITERIA,
  subjectQuestions,
  SUPPORT_REQUEST,
  supportQuestions,
} from './jev';

const items = [
  { pmid: '111', takeaway: 'In this trial, pain fell.', quote: 'Pain scores decreased.' },
  { pmid: '222', takeaway: 'In rats, drug A beat drug B.', quote: 'Drug B outperformed drug A.' },
];

describe('jev request shape', () => {
  it('asks one yes/no per takeaway, named for the backend', () => {
    const typesafe = supportQuestions('typesafe', items);
    expect(Object.keys(typesafe)).toEqual(['supported::111', 'supported::222']);
    expect(typesafe['supported::111']).toMatchObject({ type: 'noul' });
    expect(typesafe['supported::222']?.['instructions']).toContain(
      'QUOTE: Drug B outperformed drug A.',
    );
    expect(supportQuestions('gateway', items)['supported::111']).toMatchObject({ type: 'boolean' });
  });

  it('asks one choice per paper over the study subjects', () => {
    const q = subjectQuestions([{ pmid: '9', title: 'T', abstract: 'A' }]);
    expect(q['subject::9']).toMatchObject({ type: 'choice', criteria: SUBJECT_CRITERIA });
  });

  it('carries the model in the body on TypeSafe and in a header on the Gateway', () => {
    const q = supportQuestions('typesafe', items);
    expect(JSON.parse(jevBody('typesafe', SUPPORT_REQUEST, q))).toMatchObject({
      model: 'jev-latest',
      state: { request: SUPPORT_REQUEST, recent_context: '' },
    });
    expect(JSON.parse(jevBody('gateway', SUPPORT_REQUEST, q)).model).toBeUndefined();
    expect(jevHeaders('gateway', 'k')['ai-model-id']).toBe('typesafe-ai/jev');
    expect(jevHeaders('typesafe', 'k')['ai-model-id']).toBeUndefined();
    expect(jevUrl('typesafe')).toBe('https://api.typesafe.ai/v1/systemone');
  });
});

describe('jev answers', () => {
  it('reads support from noul or probability, leaving close calls out', () => {
    const body = JSON.stringify({
      answers: {
        'supported::111': { noul: 0.92, confidence: 0.8 },
        'supported::222': { probability: 0.1 },
        'supported::333': { noul: 0.5 },
        'subject::111': { choice: 'human' },
      },
    });
    expect(readSupport(body)).toEqual(
      new Map([
        ['111', true],
        ['222', false],
      ]),
    );
  });

  it('reads subjects, with unclear and unknown labels as null', () => {
    const body = JSON.stringify({
      answers: {
        'subject::1': { choice: 'animal' },
        'subject::2': { choice: 'unclear' },
        'subject::3': { choice: 'plants' },
      },
    });
    expect(readSubjects(body)).toEqual(
      new Map([
        ['1', 'animal'],
        ['2', null],
        ['3', null],
      ]),
    );
  });

  it('tells a malformed body (null) from one with no support answers', () => {
    expect(readSupport('not json')).toBeNull();
    expect(readSupport('{"answers":{}}')?.size).toBe(0);
    expect(readSubjects('{"error":"timeout"}').size).toBe(0);
  });
});
