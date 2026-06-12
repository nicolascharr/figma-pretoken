// Pure clustering logic for colors. Generic over the "usage" payload type so it
// stays decoupled from the Figma API (the sandbox attaches node references as U).

import { LAB, RGB, deltaE } from './color';
import type { GradientPaintType, GradientStopDTO } from './types';

export interface SolidAgg<U> {
  hex: string;
  rgb: RGB;
  lab: LAB;
  opacity: number;
  usages: U[];
}

export interface GradientAgg<U> {
  signature: string; // identical gradients share a signature (deduped variant)
  type: GradientPaintType;
  stops: GradientStopDTO[];
  representativeHex: string;
  representativeLab: LAB;
  usages: U[];
}

export interface SolidCluster<U> {
  swatches: SolidAgg<U>[]; // sorted by usage count desc
}

export interface GradientCluster<U> {
  type: GradientPaintType;
  variants: GradientAgg<U>[]; // sorted by usage count desc
}

function usageCount<U>(a: { usages: U[] }): number {
  return a.usages.length;
}

/* ---------------------- perceptual merge guards ----------------------- */

// Chroma below this is "neutral" (gray family); clearly above is "tinted".
const NEUTRAL_CHROMA = 6;
const CLEARLY_TINTED = 10;
const MAX_HUE_DIFF = 40; // degrees, for two clearly tinted colors

function chroma(lab: LAB): number {
  return Math.sqrt(lab.a * lab.a + lab.b * lab.b);
}

function hueDiff(x: LAB, y: LAB): number {
  const hx = (Math.atan2(x.b, x.a) * 180) / Math.PI;
  const hy = (Math.atan2(y.b, y.a) * 180) / Math.PI;
  const d = Math.abs(hx - hy) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Delta E alone under-separates light colors: a light gray and a pastel blue
 * can sit within a few units of each other yet read as different colors. Block
 * merges across the neutral/tinted boundary, and between clearly tinted colors
 * of different hue families.
 */
function compatible(x: LAB, y: LAB): boolean {
  const cx = chroma(x);
  const cy = chroma(y);
  const lo = Math.min(cx, cy);
  const hi = Math.max(cx, cy);
  if (lo <= NEUTRAL_CHROMA && hi >= CLEARLY_TINTED) return false; // gray vs tinted
  if (lo >= CLEARLY_TINTED && hueDiff(x, y) > MAX_HUE_DIFF) return false; // hue families
  return true;
}

/**
 * Greedy single-pass, complete-linkage clustering. Aggregates are processed
 * from most-used to least-used; each one joins the cluster where its WORST
 * distance to any existing member stays within `threshold` Delta E (so groups
 * can't drift swatch by swatch), otherwise it seeds a new cluster.
 */
export function clusterSolids<U>(
  aggs: SolidAgg<U>[],
  threshold: number,
  metric: 'cie76' | 'ciede2000',
): SolidCluster<U>[] {
  const sorted = [...aggs].sort((a, b) => usageCount(b) - usageCount(a));
  const clusters: { swatches: SolidAgg<U>[] }[] = [];

  for (const agg of sorted) {
    let best: (typeof clusters)[number] | null = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      let worst = 0;
      for (const s of c.swatches) {
        if (!compatible(agg.lab, s.lab)) {
          worst = Infinity;
          break;
        }
        const d = deltaE(agg.lab, s.lab, metric);
        if (d > worst) worst = d;
        if (worst > threshold) break;
      }
      if (worst <= threshold && worst < bestDist) {
        bestDist = worst;
        best = c;
      }
    }
    if (best) best.swatches.push(agg);
    else clusters.push({ swatches: [agg] });
  }

  return clusters.map((c) => ({
    swatches: c.swatches.sort((a, b) => usageCount(b) - usageCount(a)),
  }));
}

/**
 * Clusters gradient variants. Variants are only ever merged with others of the
 * same gradient type (merging a radial into a linear would change the look),
 * then grouped complete-linkage by the Delta E distance of their representative
 * colors, with the same neutral/hue guards as solids.
 */
export function clusterGradients<U>(
  aggs: GradientAgg<U>[],
  threshold: number,
  metric: 'cie76' | 'ciede2000',
): GradientCluster<U>[] {
  const byType = new Map<GradientPaintType, GradientAgg<U>[]>();
  for (const agg of aggs) {
    const list = byType.get(agg.type) ?? [];
    list.push(agg);
    byType.set(agg.type, list);
  }

  const out: GradientCluster<U>[] = [];
  for (const [type, list] of byType) {
    const sorted = [...list].sort((a, b) => usageCount(b) - usageCount(a));
    const clusters: { variants: GradientAgg<U>[] }[] = [];
    for (const agg of sorted) {
      let best: (typeof clusters)[number] | null = null;
      let bestDist = Infinity;
      for (const c of clusters) {
        let worst = 0;
        for (const v of c.variants) {
          if (!compatible(agg.representativeLab, v.representativeLab)) {
            worst = Infinity;
            break;
          }
          const d = deltaE(agg.representativeLab, v.representativeLab, metric);
          if (d > worst) worst = d;
          if (worst > threshold) break;
        }
        if (worst <= threshold && worst < bestDist) {
          bestDist = worst;
          best = c;
        }
      }
      if (best) best.variants.push(agg);
      else clusters.push({ variants: [agg] });
    }
    for (const c of clusters) {
      out.push({ type, variants: c.variants.sort((a, b) => usageCount(b) - usageCount(a)) });
    }
  }
  return out;
}
