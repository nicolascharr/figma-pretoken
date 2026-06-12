// Sandbox-side scanning: performant tree traversal + extraction of hard-coded
// colors (solids & gradients) and orphan text styles, with on-the-fly
// aggregation into deduped "variants" ready for clustering.

import { rgbToHex, rgbToLab, type RGB } from '../shared/color';
import type { SolidAgg, GradientAgg } from '../shared/colorCluster';
import type { FontAgg } from '../shared/fontCluster';
import type {
  GradientPaintType,
  GradientStopDTO,
  LetterSpacingDTO,
  LineHeightDTO,
  ScanOptions,
  ScanScope,
  ScanStats,
} from '../shared/types';
import type { PaintHost, TextRangeRef } from './model';

export interface ScanData {
  scope: ScanScope;
  stats: ScanStats;
  solidAggs: SolidAgg<PaintHost>[];
  gradientAggs: GradientAgg<PaintHost>[];
  fontAggs: FontAgg<TextRangeRef>[];
}

const GRADIENT_TYPES: GradientPaintType[] = [
  'GRADIENT_LINEAR',
  'GRADIENT_RADIAL',
  'GRADIENT_ANGULAR',
  'GRADIENT_DIAMOND',
];

function isGradientType(t: string): t is GradientPaintType {
  return (GRADIENT_TYPES as string[]).indexOf(t) !== -1;
}

const round = (n: number, p = 4) => Math.round(n * 10 ** p) / 10 ** p;

export async function scan(
  options: ScanOptions,
  onProgress: (processed: number) => void,
): Promise<ScanData> {
  figma.skipInvisibleInstanceChildren = !options.includeHidden;

  // File scope walks every page (the caller has loaded them); page scope walks
  // the current page, narrowed to the selection when there is one.
  const selection = figma.currentPage.selection;
  let scope: ScanScope;
  let roots: readonly SceneNode[];
  if (options.scope === 'file') {
    scope = 'file';
    const all: SceneNode[] = [];
    for (const page of figma.root.children) all.push(...page.children);
    roots = all;
  } else if (selection.length > 0) {
    scope = 'selection';
    roots = selection;
  } else {
    scope = 'page';
    roots = figma.currentPage.children;
  }

  const stats: ScanStats = {
    nodesScanned: 0,
    solidUsages: 0,
    gradientUsages: 0,
    textRanges: 0,
    skippedLinked: 0,
    skippedLockedHidden: 0,
  };

  const solids = new Map<string, SolidAgg<PaintHost>>();
  const gradients = new Map<string, GradientAgg<PaintHost>>();
  const fonts = new Map<string, FontAgg<TextRangeRef>>();
  const solidOpacityVotes = new Map<string, Map<number, number>>();

  /* ----------------------------- extraction ---------------------------- */

  const addSolid = (rgb: RGB, opacity: number, host: PaintHost) => {
    const hex = rgbToHex(rgb);
    let agg = solids.get(hex);
    if (!agg) {
      agg = { hex, rgb, lab: rgbToLab(rgb), opacity, usages: [] };
      solids.set(hex, agg);
      solidOpacityVotes.set(hex, new Map());
    }
    agg.usages.push(host);
    const votes = solidOpacityVotes.get(hex)!;
    const key = round(opacity, 2);
    votes.set(key, (votes.get(key) ?? 0) + 1);
    stats.solidUsages++;
  };

  const addGradient = (type: GradientPaintType, stops: readonly ColorStop[], host: PaintHost) => {
    const stopDtos: GradientStopDTO[] = stops.map((s) => ({
      hex: rgbToHex(s.color),
      opacity: round(s.color.a ?? 1, 3),
      position: round(s.position, 3),
    }));
    const signature =
      type + '|' + stopDtos.map((s) => `${s.hex}@${s.position}x${s.opacity}`).join(',');

    let agg = gradients.get(signature);
    if (!agg) {
      const rep = representativeColor(stops);
      agg = {
        signature,
        type,
        stops: stopDtos,
        representativeHex: rgbToHex(rep),
        representativeLab: rgbToLab(rep),
        usages: [],
      };
      gradients.set(signature, agg);
    }
    agg.usages.push(host);
    stats.gradientUsages++;
  };

  const extractPaints = (paints: readonly Paint[], makeHost: (i: number) => PaintHost) => {
    for (let i = 0; i < paints.length; i++) {
      const p = paints[i];
      if (p.visible === false) continue;
      if (p.type === 'SOLID') {
        if (p.boundVariables && p.boundVariables.color) {
          stats.skippedLinked++;
          continue; // already bound to a variable
        }
        addSolid(p.color, p.opacity ?? 1, makeHost(i));
      } else if (isGradientType(p.type)) {
        const grad = p as GradientPaint;
        const anyBound = grad.gradientStops.some((s) => s.boundVariables && s.boundVariables.color);
        if (anyBound) {
          stats.skippedLinked++;
          continue;
        }
        addGradient(p.type, grad.gradientStops, makeHost(i));
      }
    }
  };

  const extractText = (node: TextNode) => {
    const segments = node.getStyledTextSegments([
      'fontName',
      'fontSize',
      'lineHeight',
      'letterSpacing',
      'textStyleId',
      'fills',
      'fillStyleId',
    ]);
    for (const seg of segments) {
      // ---- text color (fills on this range) ----
      if (seg.fillStyleId && seg.fillStyleId !== '') {
        stats.skippedLinked++;
      } else {
        extractPaints(seg.fills, (i) => ({
          kind: 'textRangeFill',
          nodeId: node.id,
          start: seg.start,
          end: seg.end,
          index: i,
        }));
      }
      // ---- orphan text style ----
      if (seg.textStyleId && seg.textStyleId !== '') {
        stats.skippedLinked++;
        continue;
      }
      const lineHeight = toLineHeightDTO(seg.lineHeight);
      const letterSpacing = toLetterSpacingDTO(seg.letterSpacing);
      const signature = [
        seg.fontName.family,
        seg.fontName.style,
        round(seg.fontSize, 2),
        `${lineHeight.unit}:${round(lineHeight.value, 2)}`,
        `${letterSpacing.unit}:${round(letterSpacing.value, 2)}`,
      ].join('|');

      let agg = fonts.get(signature);
      if (!agg) {
        agg = {
          signature,
          fontFamily: seg.fontName.family,
          fontStyle: seg.fontName.style,
          fontSize: seg.fontSize,
          lineHeight,
          letterSpacing,
          usages: [],
        };
        fonts.set(signature, agg);
      }
      agg.usages.push({ nodeId: node.id, start: seg.start, end: seg.end });
      stats.textRanges++;
    }
  };

  /* ----------------------------- traversal ----------------------------- */

  const stack: SceneNode[] = [...roots].reverse();
  let sinceYield = 0;

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (!options.includeHidden && node.visible === false) {
      stats.skippedLockedHidden++;
      continue;
    }
    if (!options.includeLocked && node.locked) {
      stats.skippedLockedHidden++;
      continue;
    }
    if (!options.includeInstances && node.type === 'INSTANCE') {
      continue;
    }

    stats.nodesScanned++;

    // Colors on non-text nodes.
    if (node.type === 'TEXT') {
      try {
        extractText(node);
      } catch {
        /* unreadable text node, skip */
      }
    } else {
      if ('fills' in node && hasUnlinkedFills(node)) {
        const fills = node.fills;
        if (fills !== figma.mixed) {
          extractPaints(fills, (i) => ({ kind: 'fill', nodeId: node.id, index: i }));
        }
      }
    }
    // Strokes (all node kinds, including text).
    if ('strokes' in node && hasUnlinkedStrokes(node)) {
      extractPaints(node.strokes, (i) => ({ kind: 'stroke', nodeId: node.id, index: i }));
    }

    // Recurse.
    if ('children' in node) {
      const children = node.children;
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }

    if (++sinceYield >= 800) {
      sinceYield = 0;
      onProgress(stats.nodesScanned);
      // Yield so the Figma canvas/UI stays responsive on huge documents.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  onProgress(stats.nodesScanned);

  // Apply most-common opacity to each solid swatch.
  for (const [hex, agg] of solids) {
    const votes = solidOpacityVotes.get(hex);
    if (votes) {
      let bestOp = agg.opacity;
      let bestN = -1;
      for (const [op, n] of votes) if (n > bestN) ((bestN = n), (bestOp = op));
      agg.opacity = bestOp;
    }
  }

  return {
    scope,
    stats,
    solidAggs: [...solids.values()],
    gradientAggs: [...gradients.values()],
    fontAggs: [...fonts.values()],
  };
}

/* ------------------------------- helpers ------------------------------- */

function hasUnlinkedFills(node: SceneNode & { fills: readonly Paint[] | symbol }): boolean {
  const id = (node as GeometryMixin & { fillStyleId?: string | symbol }).fillStyleId;
  if (typeof id === 'string' && id !== '') return false; // bound to a fill style
  return true;
}

function hasUnlinkedStrokes(node: SceneNode): boolean {
  const id = (node as unknown as { strokeStyleId?: string | symbol }).strokeStyleId;
  if (typeof id === 'string' && id !== '') return false;
  return true;
}

// Weighted average color of a gradient, used as its clustering representative.
function representativeColor(stops: readonly ColorStop[]): RGB {
  if (stops.length === 0) return { r: 0, g: 0, b: 0 };
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  let r = 0,
    g = 0,
    b = 0,
    wsum = 0;
  for (let i = 0; i < sorted.length; i++) {
    const prev = i === 0 ? 0 : (sorted[i - 1].position + sorted[i].position) / 2;
    const next =
      i === sorted.length - 1 ? 1 : (sorted[i].position + sorted[i + 1].position) / 2;
    const w = Math.max(next - prev, 0.0001) * (sorted[i].color.a ?? 1);
    r += sorted[i].color.r * w;
    g += sorted[i].color.g * w;
    b += sorted[i].color.b * w;
    wsum += w;
  }
  if (wsum === 0) return { r: sorted[0].color.r, g: sorted[0].color.g, b: sorted[0].color.b };
  return { r: r / wsum, g: g / wsum, b: b / wsum };
}

function toLineHeightDTO(lh: LineHeight): LineHeightDTO {
  if (lh.unit === 'AUTO') return { unit: 'AUTO', value: 0 };
  return { unit: lh.unit, value: lh.value };
}

function toLetterSpacingDTO(ls: LetterSpacing): LetterSpacingDTO {
  return { unit: ls.unit, value: ls.value };
}
