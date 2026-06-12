// Applies color merges back to the document: replacing solid paints with a
// target color, or unifying near-identical gradients to a canonical stop set.

import {
  dtoStopsToFigma,
  makeSolid,
  readHostPaints,
  writeHostPaints,
  type PaintHost,
} from './model';
import type { GradientStopDTO } from '../shared/types';

interface ApplyResult {
  applied: number;
  failed: number;
}

function arrayKey(h: PaintHost): string {
  if (h.kind === 'fill') return `fill:${h.nodeId}`;
  if (h.kind === 'stroke') return `stroke:${h.nodeId}`;
  return `trf:${h.nodeId}:${h.start}:${h.end}`;
}

// Group hosts that share the same paint array, so we read/clone/write each array
// once even when several merged swatches touch it at different indices.
function groupByArray(hosts: PaintHost[]): Map<string, PaintHost[]> {
  const map = new Map<string, PaintHost[]>();
  for (const h of hosts) {
    const k = arrayKey(h);
    const list = map.get(k) ?? [];
    list.push(h);
    map.set(k, list);
  }
  return map;
}

async function applyToHosts(
  hosts: PaintHost[],
  mutate: (paints: Paint[], index: number) => boolean,
): Promise<ApplyResult> {
  let applied = 0;
  let failed = 0;
  for (const [, group] of groupByArray(hosts)) {
    try {
      const paints = await readHostPaints(group[0]);
      if (!paints) {
        failed += group.length;
        continue;
      }
      let changed = 0;
      for (const h of group) {
        if (h.index < 0 || h.index >= paints.length) {
          failed++;
          continue;
        }
        if (mutate(paints, h.index)) changed++;
        else failed++;
      }
      if (changed > 0) {
        const ok = await writeHostPaints(group[0], paints);
        if (ok) applied += changed;
        else failed += changed;
      }
    } catch {
      failed += group.length;
    }
  }
  return { applied, failed };
}

/** Replace each checked solid usage with `targetHex`, preserving its opacity. */
export async function applySolid(hosts: PaintHost[], targetHex: string): Promise<ApplyResult> {
  return applyToHosts(hosts, (paints, index) => {
    const current = paints[index];
    const opacity = current.type === 'SOLID' ? current.opacity ?? 1 : 1;
    const solid = makeSolid(targetHex, opacity);
    if (!solid) return false;
    paints[index] = solid;
    return true;
  });
}

/**
 * Unify checked gradient usages to the canonical stop set, preserving each
 * element's own gradient transform (orientation) and overall paint opacity.
 */
export async function applyGradient(
  hosts: PaintHost[],
  canonicalStops: GradientStopDTO[],
): Promise<ApplyResult> {
  const stops = dtoStopsToFigma(canonicalStops);
  return applyToHosts(hosts, (paints, index) => {
    const current = paints[index];
    if (
      current.type !== 'GRADIENT_LINEAR' &&
      current.type !== 'GRADIENT_RADIAL' &&
      current.type !== 'GRADIENT_ANGULAR' &&
      current.type !== 'GRADIENT_DIAMOND'
    ) {
      return false;
    }
    const grad = current as GradientPaint;
    paints[index] = { ...grad, gradientStops: stops.map((s) => ({ ...s })) };
    return true;
  });
}
