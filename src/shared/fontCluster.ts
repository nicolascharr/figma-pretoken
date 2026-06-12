// Pure clustering logic for text styles. Generic over the usage payload U.

import type { LetterSpacingDTO, LineHeightDTO } from './types';

export interface FontAgg<U> {
  signature: string; // identical styles share a signature (deduped variant)
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeight: LineHeightDTO;
  letterSpacing: LetterSpacingDTO;
  usages: U[];
}

export interface FontCluster<U> {
  fontFamily: string;
  variants: FontAgg<U>[]; // sorted by usage count desc
}

function usageCount<U>(a: FontAgg<U>): number {
  return a.usages.length;
}

/* ----------------------------- font weights ---------------------------- */

// Longest names first so "extralight" wins over "light", "semibold" over "bold".
const WEIGHT_NAMES: [string, number][] = [
  ['extralight', 200],
  ['ultralight', 200],
  ['extrabold', 800],
  ['ultrabold', 800],
  ['semibold', 600],
  ['demibold', 600],
  ['hairline', 100],
  ['regular', 400],
  ['medium', 500],
  ['normal', 400],
  ['light', 300],
  ['heavy', 900],
  ['black', 900],
  ['roman', 400],
  ['thin', 100],
  ['bold', 700],
  ['demi', 600],
  ['book', 400],
];

/** Numeric weight (100–900) parsed from a Figma style name; 400 when unknown. */
export function styleWeight(fontStyle: string): number {
  const s = fontStyle.toLowerCase().replace(/[\s_-]/g, '');
  for (const [name, w] of WEIGHT_NAMES) if (s.indexOf(name) !== -1) return w;
  return 400; // plain "Italic" or unrecognized styles read as Regular weight
}

const CANONICAL_WEIGHT: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

export function weightName(w: number): string {
  return CANONICAL_WEIGHT[w] ?? 'Regular';
}

// One step on the standard weight scale: a group may span at most two adjacent
// weights (Semi Bold + Bold yes, Regular + Bold no).
const MAX_WEIGHT_SPAN = 100;

/**
 * Groups orphan text styles. The font family must match exactly; within a
 * family, variants are clustered when the cluster's total size span (max - min)
 * stays within `fontSizeTol` px — so a running mean can't drift and pull 10.5px
 * and 14px into one group — AND its weight span stays within one step of the
 * standard scale (Semi Bold can sit with Medium or Bold, never with Regular).
 * In a design system 12px microcopy and 14px body are distinct styles, hence
 * the tight 1px default. Differences in line-height / letter-spacing do NOT
 * split a cluster — those are precisely the "aberrant" variations the designer
 * wants to reconcile to a single target.
 */
export function clusterFonts<U>(aggs: FontAgg<U>[], fontSizeTol = 1): FontCluster<U>[] {
  const byFamily = new Map<string, FontAgg<U>[]>();
  for (const agg of aggs) {
    const list = byFamily.get(agg.fontFamily) ?? [];
    list.push(agg);
    byFamily.set(agg.fontFamily, list);
  }

  const out: FontCluster<U>[] = [];
  for (const [fontFamily, list] of byFamily) {
    const sorted = [...list].sort((a, b) => usageCount(b) - usageCount(a));
    const clusters: {
      minSize: number;
      maxSize: number;
      minWeight: number;
      maxWeight: number;
      variants: FontAgg<U>[];
    }[] = [];

    for (const agg of sorted) {
      const weight = styleWeight(agg.fontStyle);
      let best: (typeof clusters)[number] | null = null;
      let bestDist = Infinity;
      for (const c of clusters) {
        const sizeSpan =
          Math.max(c.maxSize, agg.fontSize) - Math.min(c.minSize, agg.fontSize);
        if (sizeSpan > fontSizeTol) continue;
        const weightSpan =
          Math.max(c.maxWeight, weight) - Math.min(c.minWeight, weight);
        if (weightSpan > MAX_WEIGHT_SPAN) continue;
        // Prefer the closest cluster: size distance first, weight as tiebreak.
        const d =
          Math.abs(agg.fontSize - (c.minSize + c.maxSize) / 2) +
          Math.abs(weight - (c.minWeight + c.maxWeight) / 2) / 1000;
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (best) {
        best.minSize = Math.min(best.minSize, agg.fontSize);
        best.maxSize = Math.max(best.maxSize, agg.fontSize);
        best.minWeight = Math.min(best.minWeight, weight);
        best.maxWeight = Math.max(best.maxWeight, weight);
        best.variants.push(agg);
      } else {
        clusters.push({
          minSize: agg.fontSize,
          maxSize: agg.fontSize,
          minWeight: weight,
          maxWeight: weight,
          variants: [agg],
        });
      }
    }

    for (const c of clusters) {
      out.push({ fontFamily, variants: c.variants.sort((a, b) => usageCount(b) - usageCount(a)) });
    }
  }

  // Larger / busier groups first.
  return out.sort(
    (a, b) =>
      b.variants.reduce((s, v) => s + usageCount(v), 0) -
      a.variants.reduce((s, v) => s + usageCount(v), 0),
  );
}
