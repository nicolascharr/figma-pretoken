// Typed, bidirectional message protocol shared by the sandbox (code.ts) and the
// UI (ui.ts), plus the serializable data-transfer objects (DTOs) the UI renders.
//
// Heavy data (the exact node usages behind each swatch / variant) never leaves
// the sandbox. The UI only receives display DTOs keyed by stable ids and sends
// those ids back when the user applies a merge.

/* ----------------------------- Color DTOs ----------------------------- */

export interface GradientStopDTO {
  hex: string;
  opacity: number; // 0..1
  position: number; // 0..1
}

export interface SolidSwatchDTO {
  id: string;
  hex: string;
  opacity: number; // representative opacity (most common)
  count: number; // number of usages
}

export interface GradientVariantDTO {
  id: string;
  stops: GradientStopDTO[];
  representativeHex: string;
  count: number;
}

export type ColorGroupDTO =
  | {
      id: string;
      kind: 'solid';
      swatches: SolidSwatchDTO[];
      suggestedHex: string; // default "Replace by" value (most used shade)
    }
  | {
      id: string;
      kind: 'gradient';
      gradientType: GradientPaintType;
      variants: GradientVariantDTO[];
      canonicalId: string; // default unify target (most used variant)
    };

export type GradientPaintType =
  | 'GRADIENT_LINEAR'
  | 'GRADIENT_RADIAL'
  | 'GRADIENT_ANGULAR'
  | 'GRADIENT_DIAMOND';

/* ------------------------------ Font DTOs ----------------------------- */

export interface LineHeightDTO {
  unit: 'PIXELS' | 'PERCENT' | 'AUTO';
  value: number; // ignored when unit === 'AUTO'
}

export interface LetterSpacingDTO {
  unit: 'PIXELS' | 'PERCENT';
  value: number;
}

export interface FontTarget {
  fontFamily: string;
  fontStyle: string; // e.g. "Regular", "Semi Bold"
  fontSize: number;
  lineHeight: LineHeightDTO;
  letterSpacing: LetterSpacingDTO;
}

export interface FontVariantDTO extends FontTarget {
  id: string;
  count: number; // number of orphan text ranges with this exact style
}

export interface FontGroupDTO {
  id: string;
  fontFamily: string;
  variants: FontVariantDTO[];
  suggested: FontTarget; // default target style for the whole group
}

/* ---------------------------- Scan results ---------------------------- */

export interface ScanStats {
  nodesScanned: number;
  solidUsages: number;
  gradientUsages: number;
  textRanges: number;
  skippedLinked: number; // usages ignored because bound to a style or variable
  skippedLockedHidden: number;
}

export type ScanScope = 'selection' | 'page' | 'file';

export interface ScanResultDTO {
  scope: ScanScope;
  colorGroups: ColorGroupDTO[];
  fontGroups: FontGroupDTO[];
  stats: ScanStats;
}

/* ---------------------- Messages: UI -> sandbox ----------------------- */

export interface ScanOptions {
  scope: 'page' | 'file'; // page = current page (narrowed by selection), file = every page
  includeLocked: boolean;
  includeHidden: boolean;
  includeInstances: boolean;
  colorThreshold: number; // Delta E clustering threshold
  metric: 'cie76' | 'ciede2000';
  fontSizeTolerance: number; // max font-size span (px) inside one font group
}

export type UIToCode =
  | { type: 'scan'; options: ScanOptions }
  | {
      type: 'apply-solid';
      groupId: string;
      checkedSwatchIds: string[];
      targetHex: string;
    }
  | {
      type: 'apply-gradient';
      groupId: string;
      checkedVariantIds: string[];
      canonicalVariantId: string;
    }
  | {
      type: 'apply-font';
      groupId: string;
      checkedVariantIds: string[];
      target: FontTarget;
    }
  | { type: 'select-usages'; kind: 'solid' | 'gradient' | 'font'; refId: string }
  | { type: 'resize'; width: number; height: number }
  | { type: 'notify'; message: string };

/* ---------------------- Messages: sandbox -> UI ----------------------- */

export type CodeToUI =
  | { type: 'scan-started'; scope: ScanScope }
  | { type: 'scan-progress'; processed: number; total: number }
  | { type: 'scan-result'; result: ScanResultDTO }
  | {
      type: 'apply-done';
      kind: 'solid' | 'gradient' | 'font';
      groupId: string;
      applied: number;
      failed: number;
    }
  | { type: 'scope'; scope: 'selection' | 'page'; count: number }
  | { type: 'error'; message: string };

/* ------------------------------ Helpers ------------------------------- */

export function postToUI(msg: CodeToUI): void {
  figma.ui.postMessage(msg);
}

export function postToCode(msg: UIToCode): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}
