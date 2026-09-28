/**
 * Who or what a paper studied, from its title and abstract (no AI): a review of
 * other studies, animals, cells or tissue in the lab, or people. Shown next to a
 * takeaway so a rat or cell result doesn't read like a finding in patients.
 * Null when the words don't say.
 */
export type StudySubject = 'review' | 'animal' | 'lab' | 'human';

const REVIEW =
  /\b(systematic review|meta-analys[ie]s|narrative review|scoping review|umbrella review|literature review|this review|we review|reviews? the (?:evidence|literature))\b/i;
const ANIMAL =
  /\b(rats?|mice|mouse|murine|rodents?|rabbits?|dogs?|canine|pigs?|porcine|swine|zebrafish|primates?|monkeys?|hamsters?|guinea pigs?|sheep|ovine|animal models?|in vivo experiments?)\b/i;
const LAB =
  /\b(in vitro|cell lines?|cultured (?:cells|neurons|cardiomyocytes)|organoids?|in silico|molecular docking|pharmacokinetic modeling|pbpk|cells? were (?:treated|exposed|incubated))\b/i;
const HUMAN =
  /\b(patients?|participants?|adults?|children|adolescents?|women|men|volunteers?|individuals|subjects|people|persons|cohort|randomi[sz]ed|trial|case report|residents|population-based|real-world)\b/i;

export function studySubject(
  title: string,
  abstract: string,
  studyType?: string,
): StudySubject | null {
  if (studyType === 'meta-analysis' || studyType === 'systematic-review') return 'review';
  const text = `${title}\n${abstract}`;
  if (REVIEW.test(text)) return 'review';
  // Animal and lab words win over "patients": such papers often mention patients as motivation.
  if (ANIMAL.test(text)) return 'animal';
  if (LAB.test(text)) return 'lab';
  if (HUMAN.test(text)) return 'human';
  return null;
}
