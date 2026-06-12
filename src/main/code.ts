// Sandbox entry point. Owns the message router, turns scan aggregates into the
// display DTOs the UI renders, and keeps the authoritative node usages keyed by
// stable ids so merges can be applied without round-tripping heavy data.

import { clusterFonts } from '../shared/fontCluster';
import { clusterGradients, clusterSolids } from '../shared/colorCluster';
import { postToUI, type ScanResultDTO, type UIToCode } from '../shared/types';
import type {
  ColorGroupDTO,
  FontGroupDTO,
  FontTarget,
  GradientStopDTO,
  ScanOptions,
} from '../shared/types';
import { scan } from './scan';
import { applyGradient, applySolid } from './colorApply';
import { applyFont } from './fontApply';
import { getNodeById, type PaintHost, type TextRangeRef } from './model';

type UsageKind = 'solid' | 'gradient' | 'font';

// In-memory index built on each scan; the UI references these ids on apply.
const index = {
  solid: new Map<string, PaintHost[]>(),
  gradient: new Map<string, { hosts: PaintHost[]; stops: GradientStopDTO[] }>(),
  font: new Map<string, TextRangeRef[]>(),
};

figma.showUI(__html__, { width: 440, height: 660, themeColors: true });

figma.ui.onmessage = (msg: UIToCode) => {
  switch (msg.type) {
    case 'scan':
      void handleScan(msg.options);
      break;
    case 'apply-solid':
      void handleApplySolid(msg.groupId, msg.checkedSwatchIds, msg.targetHex);
      break;
    case 'apply-gradient':
      void handleApplyGradient(msg.groupId, msg.checkedVariantIds, msg.canonicalVariantId);
      break;
    case 'apply-font':
      void handleApplyFont(msg.groupId, msg.checkedVariantIds, msg.target);
      break;
    case 'select-usages':
      void handleSelectUsages(msg.kind, msg.refId);
      break;
    case 'resize':
      figma.ui.resize(Math.max(360, msg.width), Math.max(420, msg.height));
      break;
    case 'notify':
      figma.notify(msg.message);
      break;
  }
};

function postScope(): void {
  const count = figma.currentPage.selection.length;
  postToUI({ type: 'scope', scope: count > 0 ? 'selection' : 'page', count });
}

figma.on('selectionchange', postScope);
figma.on('currentpagechange', postScope);
postScope();

async function handleScan(options: ScanOptions): Promise<void> {
  index.solid.clear();
  index.gradient.clear();
  index.font.clear();

  try {
    // dynamic-page: pages must be loaded before traversal. loadAsync() is a
    // no-op on already-loaded pages.
    if (options.scope === 'file') await figma.loadAllPagesAsync();
    else await figma.currentPage.loadAsync();
    postScope();

    const selection = figma.currentPage.selection;
    const scope =
      options.scope === 'file' ? 'file' : selection.length > 0 ? 'selection' : 'page';
    postToUI({ type: 'scan-started', scope });

    const data = await scan(options, (processed) => {
      postToUI({ type: 'scan-progress', processed, total: processed });
    });

    // ---- Solid color groups ----
    const solidClusters = clusterSolids(data.solidAggs, options.colorThreshold, options.metric);
    const colorGroups: ColorGroupDTO[] = [];
    solidClusters.forEach((cluster, gi) => {
      const groupId = `csolid_${gi}`;
      const swatches = cluster.swatches.map((sw, si) => {
        const id = `${groupId}_s${si}`;
        index.solid.set(id, sw.usages);
        return { id, hex: sw.hex, opacity: sw.opacity, count: sw.usages.length };
      });
      if (swatches.length === 0) return;
      colorGroups.push({ id: groupId, kind: 'solid', swatches, suggestedHex: swatches[0].hex });
    });

    // ---- Gradient groups ----
    const gradientClusters = clusterGradients(
      data.gradientAggs,
      options.colorThreshold,
      options.metric,
    );
    gradientClusters.forEach((cluster, gi) => {
      const groupId = `cgrad_${gi}`;
      const variants = cluster.variants.map((v, vi) => {
        const id = `${groupId}_v${vi}`;
        index.gradient.set(id, { hosts: v.usages, stops: v.stops });
        return { id, stops: v.stops, representativeHex: v.representativeHex, count: v.usages.length };
      });
      if (variants.length === 0) return;
      colorGroups.push({
        id: groupId,
        kind: 'gradient',
        gradientType: cluster.type,
        variants,
        canonicalId: variants[0].id,
      });
    });

    // ---- Font groups ----
    const fontClusters = clusterFonts(data.fontAggs, options.fontSizeTolerance);
    const fontGroups: FontGroupDTO[] = [];
    fontClusters.forEach((cluster, gi) => {
      const groupId = `cfont_${gi}`;
      const variants = cluster.variants.map((v, vi) => {
        const id = `${groupId}_v${vi}`;
        index.font.set(id, v.usages);
        return {
          id,
          fontFamily: v.fontFamily,
          fontStyle: v.fontStyle,
          fontSize: v.fontSize,
          lineHeight: v.lineHeight,
          letterSpacing: v.letterSpacing,
          count: v.usages.length,
        };
      });
      if (variants.length === 0) return;
      const top = variants[0];
      const suggested: FontTarget = {
        fontFamily: top.fontFamily,
        fontStyle: top.fontStyle,
        fontSize: top.fontSize,
        lineHeight: top.lineHeight,
        letterSpacing: top.letterSpacing,
      };
      fontGroups.push({ id: groupId, fontFamily: cluster.fontFamily, variants, suggested });
    });

    const result: ScanResultDTO = {
      scope: data.scope,
      colorGroups,
      fontGroups,
      stats: data.stats,
    };
    postToUI({ type: 'scan-result', result });
  } catch (err) {
    postToUI({ type: 'error', message: errorMessage(err) });
  }
}

async function handleApplySolid(
  groupId: string,
  checkedSwatchIds: string[],
  targetHex: string,
): Promise<void> {
  try {
    const hosts: PaintHost[] = [];
    for (const id of checkedSwatchIds) {
      const u = index.solid.get(id);
      if (u) hosts.push(...u);
    }
    const res = await applySolid(hosts, targetHex);
    postToUI({ type: 'apply-done', kind: 'solid', groupId, applied: res.applied, failed: res.failed });
    figma.notify(`Merged ${res.applied} color usage(s)${res.failed ? `, ${res.failed} skipped` : ''}.`);
  } catch (err) {
    postToUI({ type: 'error', message: errorMessage(err) });
  }
}

async function handleApplyGradient(
  groupId: string,
  checkedVariantIds: string[],
  canonicalVariantId: string,
): Promise<void> {
  try {
    const canonical = index.gradient.get(canonicalVariantId);
    if (!canonical) {
      postToUI({ type: 'error', message: 'Canonical gradient no longer available — re-scan.' });
      return;
    }
    const hosts: PaintHost[] = [];
    for (const id of checkedVariantIds) {
      const v = index.gradient.get(id);
      if (v) hosts.push(...v.hosts);
    }
    const res = await applyGradient(hosts, canonical.stops);
    postToUI({ type: 'apply-done', kind: 'gradient', groupId, applied: res.applied, failed: res.failed });
    figma.notify(
      `Unified ${res.applied} gradient usage(s)${res.failed ? `, ${res.failed} skipped` : ''}.`,
    );
  } catch (err) {
    postToUI({ type: 'error', message: errorMessage(err) });
  }
}

async function handleApplyFont(
  groupId: string,
  checkedVariantIds: string[],
  target: FontTarget,
): Promise<void> {
  try {
    const refs: TextRangeRef[] = [];
    for (const id of checkedVariantIds) {
      const u = index.font.get(id);
      if (u) refs.push(...u);
    }
    const res = await applyFont(refs, target);
    postToUI({ type: 'apply-done', kind: 'font', groupId, applied: res.applied, failed: res.failed });
    figma.notify(
      `Merged ${res.applied} text range(s)${res.failed ? `, ${res.failed} skipped` : ''}.`,
    );
  } catch (err) {
    postToUI({ type: 'error', message: errorMessage(err) });
  }
}

async function handleSelectUsages(kind: UsageKind, refId: string): Promise<void> {
  const nodeIds = new Set<string>();
  if (kind === 'solid') {
    for (const h of index.solid.get(refId) ?? []) nodeIds.add(h.nodeId);
  } else if (kind === 'gradient') {
    for (const h of index.gradient.get(refId)?.hosts ?? []) nodeIds.add(h.nodeId);
  } else {
    for (const r of index.font.get(refId) ?? []) nodeIds.add(r.nodeId);
  }
  if (nodeIds.size === 0) {
    figma.notify('No layers found for this entry — re-scan.');
    return;
  }
  const nodes: SceneNode[] = [];
  for (const id of nodeIds) {
    const node = await getNodeById(id);
    if (node) nodes.push(node);
  }
  if (nodes.length === 0) {
    figma.notify('These layers no longer exist — re-scan.');
    return;
  }

  // File scans can reference layers on other pages: select what lives on the
  // current page, or jump to the first usage's page.
  let targets = nodes.filter((n) => pageOf(n) === figma.currentPage);
  let jumped: PageNode | null = null;
  if (targets.length === 0) {
    jumped = pageOf(nodes[0]);
    if (!jumped) {
      figma.notify('These layers no longer exist — re-scan.');
      return;
    }
    await figma.setCurrentPageAsync(jumped);
    targets = nodes.filter((n) => pageOf(n) === jumped);
  }
  figma.currentPage.selection = targets;
  figma.viewport.scrollAndZoomIntoView(targets);
  figma.notify(
    jumped
      ? `Selected ${targets.length} layer(s) on page “${jumped.name}”.`
      : `Selected ${targets.length} layer(s).`,
  );
}

function pageOf(node: BaseNode): PageNode | null {
  let p = node.parent;
  while (p && p.type !== 'PAGE') p = p.parent;
  return p && p.type === 'PAGE' ? p : null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
