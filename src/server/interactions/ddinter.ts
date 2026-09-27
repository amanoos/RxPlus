/**
 * DDInter 2.0 CSV handling (https://ddinter2.scbdd.com, CC BY-NC-SA 4.0).
 * Pure functions: parsing, route suffixes, pair normalization.
 */

export const LEVELS = ['Major', 'Moderate', 'Minor', 'Unknown'] as const;
export type Level = (typeof LEVELS)[number];

/** Higher = more severe. */
export const SEVERITY: Record<Level, number> = { Major: 3, Moderate: 2, Minor: 1, Unknown: 0 };

export interface DdinterRow {
  idA: string;
  nameA: string;
  idB: string;
  nameB: string;
  level: Level;
}

export interface DdiPair {
  drugA: string;
  drugB: string;
  level: Level;
}

export class DdinterFormatError extends Error {
  override readonly name = 'DdinterFormatError';
}

const HEADER = ['DDInterID_A', 'Drug_A', 'DDInterID_B', 'Drug_B', 'Level'];

/** Splits one CSV line, honouring double-quoted fields and "" escapes. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

export function parseDdinterCsv(text: string): DdinterRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? '');
  if (header.join(',') !== HEADER.join(',')) {
    throw new DdinterFormatError(`Unexpected DDInter header: ${lines[0]?.slice(0, 80)}`);
  }
  return lines.slice(1).flatMap((line, index) => {
    if (!line.trim()) return [];
    const [idA, nameA, idB, nameB, level] = splitCsvLine(line);
    if (!LEVELS.includes(level as Level)) {
      throw new DdinterFormatError(`Line ${index + 2}: unknown level "${level}"`);
    }
    return [{ idA, nameA, idB, nameB, level: level as Level }];
  });
}

/** Qualifier → route for non-systemic forms (seen in DDInter 2.0 names, typos included). */
const ROUTES: Record<string, string> = {
  topical: 'topical',
  topiclal: 'topical',
  ophthalmic: 'ophthalmic',
  'topical ophthalmic': 'ophthalmic',
  otic: 'otic',
  nasal: 'nasal',
  inhalation: 'inhalation',
  'inhalation, rapid acting': 'inhalation',
  vaginal: 'vaginal',
  rectal: 'rectal',
  transdermal: 'transdermal',
};
/** Formulation or systemic-route qualifiers: dropped from the base name, route stays null. */
const FORMULATIONS = [
  'liposomal',
  'liposome',
  'lipid complex',
  'protein-bound',
  'cholesteryl sulfate',
  'intravenous',
  'intramuscular',
  'subcutaneous',
  'intravenous and subcutaneous',
];

/**
 * "Hydrocortisone (topical)" → { base: "Hydrocortisone", route: "topical" }.
 * Formulation qualifiers are dropped from `base`; other parentheticals, such as
 * "(18F)", are part of the name.
 */
export function splitRoute(name: string): { base: string; route: string | null } {
  const match = /^(.*?)\s*\(([^)]+)\)$/.exec(name.trim());
  const qualifier = match?.[2].toLowerCase();
  if (match && qualifier && qualifier in ROUTES) {
    return { base: match[1], route: ROUTES[qualifier] };
  }
  if (match && qualifier && FORMULATIONS.includes(qualifier)) {
    return { base: match[1], route: null };
  }
  return { base: name.trim(), route: null };
}

/** Pairs ordered drugA < drugB, one per pair at its most severe level; plus id → name. */
export function normalizeDdinter(rows: DdinterRow[]): {
  drugs: Map<string, string>;
  pairs: DdiPair[];
} {
  const drugs = new Map<string, string>();
  const pairs = new Map<string, DdiPair>();
  for (const row of rows) {
    drugs.set(row.idA, row.nameA);
    drugs.set(row.idB, row.nameB);
    if (row.idA === row.idB) continue;
    const [drugA, drugB] = row.idA < row.idB ? [row.idA, row.idB] : [row.idB, row.idA];
    const key = `${drugA}|${drugB}`;
    const existing = pairs.get(key);
    if (!existing || SEVERITY[row.level] > SEVERITY[existing.level]) {
      pairs.set(key, { drugA, drugB, level: row.level });
    }
  }
  return {
    drugs,
    pairs: [...pairs.values()].sort((a, b) =>
      a.drugA === b.drugA ? a.drugB.localeCompare(b.drugB) : a.drugA.localeCompare(b.drugA),
    ),
  };
}
