/**
 * New FDA label versions for the active medication products. The first label
 * seen for a product is a baseline; a different set id or version is a change.
 */
import type { OpenFdaClient, SummaryLabel } from '../openfda/client';
import { errorMessage, type Collected, type Seen } from './collect';
import type { LabelVersion, NewDigestItem } from './repository';

export interface DigestProduct {
  /** RxNorm product. */
  rxcui: string;
  /** e.g. "lisinopril 10 MG Oral Tablet" */
  name: string;
  /** The ingredient names the digest groups by, e.g. "lisinopril". */
  subject: string;
}

export interface LabelsDeps {
  openFda: Pick<OpenFdaClient, 'summaryLabel'>;
  /** Versions recorded by earlier runs, by product. */
  recorded: Map<string, LabelVersion>;
  seen: Seen;
}

export interface CollectedLabels extends Collected {
  /** Versions to record when the run finishes. */
  labelVersions: LabelVersion[];
}

export async function collectLabels(
  products: DigestProduct[],
  { openFda, recorded, seen }: LabelsDeps,
): Promise<CollectedLabels> {
  const notes: string[] = [];
  const labelVersions: LabelVersion[] = [];
  const changed: { product: DigestProduct; label: SummaryLabel }[] = [];

  for (const product of products) {
    let label;
    try {
      label = await openFda.summaryLabel(product.rxcui, { refresh: true });
    } catch (error) {
      notes.push(`The FDA label for ${product.name} couldn't be checked: ${errorMessage(error)}`);
      continue;
    }
    if (!label) continue;
    const prior = recorded.get(product.rxcui);
    if (prior && prior.setId === label.setId && prior.version === label.version) continue;
    labelVersions.push({ productRxcui: product.rxcui, setId: label.setId, version: label.version });
    if (prior) changed.push({ product, label });
  }

  const externalId = (c: (typeof changed)[number]) => `${c.label.setId}:${c.label.version}`;
  const already = await seen('label', changed.map(externalId));
  const items = changed
    .filter((c) => !already.has(externalId(c)))
    .map((c): NewDigestItem => ({
      kind: 'label',
      productRxcui: c.product.rxcui,
      subject: c.product.subject,
      title: `New FDA label for ${c.product.name}`,
      url: `/drugs/${c.product.rxcui}`,
      details: { labelDate: c.label.effectiveDate, dailyMedUrl: c.label.dailyMedUrl },
      externalId: externalId(c),
    }));
  return { items, notes, labelVersions };
}
