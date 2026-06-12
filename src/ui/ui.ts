// UI controller. Renders scan results, manages per-row checkboxes and target
// editors, and posts typed apply requests back to the sandbox.

import { postToCode } from '../shared/types';
import type {
  CodeToUI,
  ColorGroupDTO,
  FontGroupDTO,
  FontTarget,
  GradientStopDTO,
  GradientVariantDTO,
  ScanOptions,
  ScanResultDTO,
  SolidSwatchDTO,
} from '../shared/types';
import { hexToRgb, rgbToHex } from '../shared/color';
import { styleWeight, weightName } from '../shared/fontCluster';

/* ------------------------------- helpers ------------------------------- */

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v as EventListener);
    } else if (typeof v === 'boolean') {
      if (v) node.setAttribute(k, '');
    } else {
      node.setAttribute(k, String(v));
    }
  }
  if (tag === 'button' && !node.hasAttribute('type')) node.setAttribute('type', 'button');
  for (const c of children) node.append(c);
  return node;
}

function $(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e;
}

function hexWithAlpha(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  return `rgba(${Math.round(rgb.r * 255)}, ${Math.round(rgb.g * 255)}, ${Math.round(
    rgb.b * 255,
  )}, ${opacity})`;
}

function gradientCss(type: string, stops: GradientStopDTO[]): string {
  const list = [...stops]
    .sort((a, b) => a.position - b.position)
    .map((s) => `${hexWithAlpha(s.hex, s.opacity)} ${Math.round(s.position * 100)}%`)
    .join(', ');
  switch (type) {
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_DIAMOND':
      return `radial-gradient(circle at 50% 50%, ${list})`;
    case 'GRADIENT_ANGULAR':
      return `conic-gradient(from 0deg at 50% 50%, ${list})`;
    default:
      return `linear-gradient(90deg, ${list})`;
  }
}

function gradientTypeLabel(t: string): string {
  return (
    {
      GRADIENT_LINEAR: 'Linear',
      GRADIENT_RADIAL: 'Radial',
      GRADIENT_ANGULAR: 'Angular',
      GRADIENT_DIAMOND: 'Diamond',
    } as Record<string, string>
  )[t] ?? t;
}

function fontTargetLabel(v: FontTarget): string {
  const parts = [`${v.fontFamily} ${v.fontStyle}`, `${round(v.fontSize)}px`];
  if (v.lineHeight.unit === 'AUTO') parts.push('Auto LH');
  else if (v.lineHeight.unit === 'PIXELS') parts.push(`${round(v.lineHeight.value)}px LH`);
  else parts.push(`${round(v.lineHeight.value)}% LH`);
  if (v.letterSpacing.unit === 'PIXELS') parts.push(`${round(v.letterSpacing.value)}px LS`);
  else parts.push(`${round(v.letterSpacing.value)}% LS`);
  return parts.join('  ·  ');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function copyText(text: string): void {
  const done = () => postToCode({ type: 'notify', message: `Copied ${text}` });
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text: string, done: () => void): void {
  const ta = el('textarea', {});
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    /* ignore */
  }
  ta.remove();
  done();
}

/* --------------------------- apply lifecycle --------------------------- */

// Per-group callbacks registered when an apply is posted, resolved when the
// sandbox echoes apply-done (success path) or error (reset path). Cleared on
// every fresh scan render.
const applyDoneHandlers = new Map<string, (applied: number, failed: number) => void>();
const applyResetHandlers = new Map<string, () => void>();
let inflightGroupId: string | null = null;

function beginApply(groupId: string, btn: HTMLButtonElement, busyLabel: string): void {
  inflightGroupId = groupId;
  btn.disabled = true;
  btn.textContent = busyLabel;
}

function mergeResultLine(failed: number, text: string, chipColor?: string): HTMLElement {
  const children: (Node | string)[] = [el('span', { class: 'merge-check' }, ['✓'])];
  if (chipColor) {
    const chip = el('span', { class: 'chip mini' });
    chip.style.background = chipColor;
    children.push(chip);
  }
  children.push(el('span', {}, [text]));
  if (failed > 0) children.push(el('span', { class: 'warn' }, [`${failed} skipped`]));
  return el('div', { class: 'merge-result' }, children);
}

/* ------------------------------ rendering ------------------------------ */

function renderColorGroups(groups: ColorGroupDTO[]): void {
  const host = $('colorGroups');
  host.replaceChildren();
  $('colorEmpty').classList.toggle('hidden', groups.length > 0);
  groups.forEach((g, i) => {
    host.append(g.kind === 'solid' ? renderSolidGroup(g, i) : renderGradientGroup(g, i));
  });
}

// Master "select all" checkbox for a group head; returns a sync function so
// merge code can refresh its state after disabling rows.
function wireMaster(master: HTMLInputElement, checks: Map<string, HTMLInputElement>): () => void {
  const sync = () => {
    const boxes = [...checks.values()].filter((c) => !c.disabled);
    const n = boxes.filter((c) => c.checked).length;
    master.checked = boxes.length > 0 && n === boxes.length;
    master.indeterminate = n > 0 && n < boxes.length;
    master.disabled = boxes.length === 0;
  };
  master.addEventListener('change', () => {
    for (const c of checks.values()) if (!c.disabled) c.checked = master.checked;
    sync();
  });
  for (const c of checks.values()) c.addEventListener('change', sync);
  sync();
  return sync;
}

function countBtn(kind: 'solid' | 'gradient' | 'font', refId: string, count: number): HTMLElement {
  const b = el(
    'button',
    { class: 'count-btn', title: 'Select these layers on canvas' },
    [`${count}×`],
  );
  b.addEventListener('click', (e) => {
    e.preventDefault();
    postToCode({ type: 'select-usages', kind, refId });
  });
  return b;
}

function markRowMerged(cb: HTMLInputElement): void {
  cb.checked = false;
  cb.disabled = true;
  cb.closest('.row')?.classList.add('merged');
}

function renderSolidGroup(
  group: Extract<ColorGroupDTO, { kind: 'solid' }>,
  i: number,
): HTMLElement {
  const checks = new Map<string, HTMLInputElement>();
  const rowHex = new Map<string, string>();

  const rows = group.swatches.map((sw) => {
    rowHex.set(sw.id, sw.hex.toUpperCase());
    return renderSolidRow(sw, checks);
  });

  const preview = el('div', { class: 'preview-chip' });
  const hexInput = el('input', {
    type: 'text',
    class: 'hex-input',
    value: group.suggestedHex,
    spellcheck: false,
    'aria-label': 'Replacement hex color',
  }) as HTMLInputElement;
  const syncPreview = () => {
    const rgb = hexToRgb(hexInput.value);
    hexInput.classList.toggle('invalid', !rgb);
    preview.style.background = rgb ? rgbToHex(rgb) : 'transparent';
  };
  hexInput.addEventListener('input', syncPreview);
  syncPreview();

  const banner = el('div', { class: 'merge-host' });
  const applyBtn = el('button', { class: 'apply-btn' }, ['Apply merge']) as HTMLButtonElement;
  const target = el('div', { class: 'target' }, [
    el('span', { class: 'replace-label' }, ['Replace by']),
    preview,
    hexInput,
    applyBtn,
  ]);

  const masterCb = el('input', { type: 'checkbox', title: 'Select all shades' }) as HTMLInputElement;
  const syncMaster = wireMaster(masterCb, checks);

  applyBtn.addEventListener('click', () => {
    const rgb = hexToRgb(hexInput.value);
    if (!rgb) {
      hexInput.classList.add('invalid');
      return;
    }
    const targetHex = rgbToHex(rgb);
    const checked = [...checks.entries()]
      .filter(([, c]) => c.checked && !c.disabled)
      .map(([id]) => id);
    if (checked.length === 0) {
      postToCode({ type: 'notify', message: 'No shades selected.' });
      return;
    }
    beginApply(group.id, applyBtn, 'Merging…');
    applyDoneHandlers.set(group.id, (applied, failed) => {
      for (const id of checked) {
        // The shade equal to the target color still exists on canvas: keep it.
        if (rowHex.get(id) === targetHex) continue;
        const cb = checks.get(id);
        if (cb) markRowMerged(cb);
      }
      banner.replaceChildren(
        mergeResultLine(failed, `Merged ${applied} usage(s) into ${targetHex}`, targetHex),
      );
      syncMaster();
      const mergeable = [...checks.entries()].filter(
        ([id, c]) => !c.disabled && rowHex.get(id) !== targetHex,
      );
      if (mergeable.length === 0) {
        target.classList.add('hidden');
      } else {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply merge';
      }
    });
    applyResetHandlers.set(group.id, () => {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply merge';
    });
    postToCode({
      type: 'apply-solid',
      groupId: group.id,
      checkedSwatchIds: checked,
      targetHex,
    });
  });

  return el('section', { class: 'group' }, [
    groupHead(`Solid group ${i + 1}`, `${group.swatches.length} shade(s)`, masterCb),
    el('div', { class: 'group-body' }, [...rows, banner, target]),
  ]);
}

function renderSolidRow(sw: SolidSwatchDTO, checks: Map<string, HTMLInputElement>): HTMLElement {
  const cb = el('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  checks.set(sw.id, cb);
  const chip = el('div', { class: sw.opacity < 1 ? 'chip checker' : 'chip' });
  chip.style.background = hexWithAlpha(sw.hex, sw.opacity);
  const copy = el('button', { class: 'copy-btn', title: 'Copy hex' }, ['Copy']);
  copy.addEventListener('click', (e) => {
    e.preventDefault();
    copyText(sw.hex);
  });
  return el('label', { class: 'row' }, [
    cb,
    chip,
    el('span', { class: 'meta hex' }, [sw.opacity < 1 ? `${sw.hex} · ${Math.round(sw.opacity * 100)}%` : sw.hex]),
    copy,
    countBtn('solid', sw.id, sw.count),
  ]);
}

function renderGradientGroup(
  group: Extract<ColorGroupDTO, { kind: 'gradient' }>,
  i: number,
): HTMLElement {
  const checks = new Map<string, HTMLInputElement>();
  let canonicalId = group.canonicalId;
  const canonButtons = new Map<string, HTMLElement>();

  const setCanonical = (id: string) => {
    canonicalId = id;
    for (const [vid, btn] of canonButtons) btn.classList.toggle('active', vid === id);
  };

  const rows = group.variants.map((v) =>
    renderGradientRow(v, group.gradientType, checks, canonButtons, setCanonical),
  );

  const banner = el('div', { class: 'merge-host' });
  const applyBtn = el('button', { class: 'apply-btn' }, ['Unify gradients']) as HTMLButtonElement;
  const target = el('div', { class: 'target' }, [
    el('span', { class: 'replace-label' }, ['Unify to ★ canonical']),
    el('span', { class: 'grow muted' }, ['Pick a target with ★, then unify the checked variants.']),
    applyBtn,
  ]);

  const masterCb = el('input', { type: 'checkbox', title: 'Select all variants' }) as HTMLInputElement;
  const syncMaster = wireMaster(masterCb, checks);

  applyBtn.addEventListener('click', () => {
    const checked = [...checks.entries()]
      .filter(([, c]) => c.checked && !c.disabled)
      .map(([id]) => id);
    if (checked.length === 0) {
      postToCode({ type: 'notify', message: 'No gradients selected.' });
      return;
    }
    const canonical = canonicalId;
    beginApply(group.id, applyBtn, 'Unifying…');
    applyDoneHandlers.set(group.id, (applied, failed) => {
      for (const id of checked) {
        // The canonical variant remains on canvas: keep its row live.
        if (id === canonical) continue;
        const cb = checks.get(id);
        if (cb) markRowMerged(cb);
      }
      banner.replaceChildren(
        mergeResultLine(failed, `Unified ${applied} gradient usage(s)`),
      );
      syncMaster();
      const mergeable = [...checks.entries()].filter(
        ([id, c]) => !c.disabled && id !== canonical,
      );
      if (mergeable.length === 0) {
        target.classList.add('hidden');
      } else {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Unify gradients';
      }
    });
    applyResetHandlers.set(group.id, () => {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Unify gradients';
    });
    postToCode({
      type: 'apply-gradient',
      groupId: group.id,
      checkedVariantIds: checked,
      canonicalVariantId: canonical,
    });
  });

  setCanonical(canonicalId);

  return el('section', { class: 'group' }, [
    groupHead(
      `Gradient group ${i + 1}`,
      `${gradientTypeLabel(group.gradientType)} · ${group.variants.length} variant(s)`,
      masterCb,
    ),
    el('div', { class: 'group-body' }, [...rows, banner, target]),
  ]);
}

function renderGradientRow(
  v: GradientVariantDTO,
  type: string,
  checks: Map<string, HTMLInputElement>,
  canonButtons: Map<string, HTMLElement>,
  setCanonical: (id: string) => void,
): HTMLElement {
  const cb = el('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  checks.set(v.id, cb);
  const bar = el('div', { class: 'grad-bar' });
  bar.style.background = gradientCss(type, v.stops);
  const copy = el('button', { class: 'copy-btn', title: 'Copy representative hex' }, ['Copy']);
  copy.addEventListener('click', (e) => {
    e.preventDefault();
    copyText(v.representativeHex);
  });
  const canon = el('button', { class: 'canonical', title: 'Use as canonical target' }, ['★']);
  canon.addEventListener('click', (e) => {
    e.preventDefault();
    setCanonical(v.id);
  });
  canonButtons.set(v.id, canon);
  return el('label', { class: 'row' }, [
    cb,
    bar,
    el('span', { class: 'meta hex' }, [`~ ${v.representativeHex}`]),
    copy,
    countBtn('gradient', v.id, v.count),
    canon,
  ]);
}

function renderFontGroups(groups: FontGroupDTO[]): void {
  const host = $('fontGroups');
  host.replaceChildren();
  $('fontEmpty').classList.toggle('hidden', groups.length > 0);
  groups.forEach((g) => host.append(renderFontGroup(g)));
}

function renderFontGroup(group: FontGroupDTO): HTMLElement {
  const checks = new Map<string, HTMLInputElement>();
  const rowLabel = new Map<string, string>();

  const rows = group.variants.map((v) => {
    const cb = el('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
    checks.set(v.id, cb);
    rowLabel.set(v.id, fontTargetLabel(v));
    const copy = el('button', { class: 'copy-btn', title: 'Copy style' }, ['Copy']);
    copy.addEventListener('click', (e) => {
      e.preventDefault();
      copyText(fontTargetLabel(v));
    });
    return el('label', { class: 'row' }, [
      cb,
      el('span', { class: 'meta' }, [fontTargetLabel(v)]),
      copy,
      countBtn('font', v.id, v.count),
    ]);
  });

  // Target editor
  const s = group.suggested;
  const familyIn = el('input', { type: 'text', value: s.fontFamily, spellcheck: false, 'aria-label': 'Font family' }) as HTMLInputElement;
  familyIn.style.width = '110px';
  const styleIn = el('input', { type: 'text', value: s.fontStyle, spellcheck: false, 'aria-label': 'Font style' }) as HTMLInputElement;
  styleIn.style.width = '90px';
  const sizeIn = el('input', { type: 'number', min: '1', step: '0.5', value: String(round(s.fontSize)), 'aria-label': 'Font size' }) as HTMLInputElement;
  const lhValue = el('input', { type: 'number', step: '0.5', value: String(round(s.lineHeight.value)), 'aria-label': 'Line height value' }) as HTMLInputElement;
  const lhUnit = el('select', { 'aria-label': 'Line height unit' }, [
    optionEl('PIXELS', 'px'),
    optionEl('PERCENT', '%'),
    optionEl('AUTO', 'auto'),
  ]) as HTMLSelectElement;
  lhUnit.value = s.lineHeight.unit;
  const syncLh = () => (lhValue.disabled = lhUnit.value === 'AUTO');
  lhUnit.addEventListener('change', syncLh);
  syncLh();
  const lsValue = el('input', { type: 'number', step: '0.5', value: String(round(s.letterSpacing.value)), 'aria-label': 'Letter spacing value' }) as HTMLInputElement;
  const lsUnit = el('select', { 'aria-label': 'Letter spacing unit' }, [optionEl('PIXELS', 'px'), optionEl('PERCENT', '%')]) as HTMLSelectElement;
  lsUnit.value = s.letterSpacing.unit;

  const banner = el('div', { class: 'merge-host' });
  const applyBtn = el('button', { class: 'apply-btn' }, ['Apply style']) as HTMLButtonElement;

  const masterCb = el('input', { type: 'checkbox', title: 'Select all styles' }) as HTMLInputElement;
  const syncMaster = wireMaster(masterCb, checks);

  applyBtn.addEventListener('click', () => {
    const checked = [...checks.entries()]
      .filter(([, c]) => c.checked && !c.disabled)
      .map(([id]) => id);
    if (checked.length === 0) {
      postToCode({ type: 'notify', message: 'No styles selected.' });
      return;
    }
    const size = parseFloat(sizeIn.value);
    if (!isFinite(size) || size <= 0) {
      sizeIn.classList.add('invalid');
      return;
    }
    sizeIn.classList.remove('invalid');
    const targetStyle: FontTarget = {
      fontFamily: familyIn.value.trim(),
      fontStyle: styleIn.value.trim() || 'Regular',
      fontSize: size,
      lineHeight:
        lhUnit.value === 'AUTO'
          ? { unit: 'AUTO', value: 0 }
          : { unit: lhUnit.value as 'PIXELS' | 'PERCENT', value: parseFloat(lhValue.value) || 0 },
      letterSpacing: {
        unit: lsUnit.value as 'PIXELS' | 'PERCENT',
        value: parseFloat(lsValue.value) || 0,
      },
    };
    const targetLabel = fontTargetLabel(targetStyle);
    beginApply(group.id, applyBtn, 'Applying…');
    applyDoneHandlers.set(group.id, (applied, failed) => {
      for (const id of checked) {
        // A variant identical to the target style still exists on canvas.
        if (rowLabel.get(id) === targetLabel) continue;
        const cb = checks.get(id);
        if (cb) markRowMerged(cb);
      }
      banner.replaceChildren(
        mergeResultLine(failed, `Restyled ${applied} text range(s) to ${targetLabel}`),
      );
      syncMaster();
      const mergeable = [...checks.entries()].filter(
        ([id, c]) => !c.disabled && rowLabel.get(id) !== targetLabel,
      );
      if (mergeable.length === 0) {
        target.classList.add('hidden');
      } else {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply style';
      }
    });
    applyResetHandlers.set(group.id, () => {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply style';
    });
    postToCode({
      type: 'apply-font',
      groupId: group.id,
      checkedVariantIds: checked,
      target: targetStyle,
    });
  });

  const target = el('div', { class: 'target' }, [
    labeled('Family', familyIn),
    labeled('Style', styleIn),
    labeled('Size', sizeIn),
    labeled('Line height', el('span', { class: 'inline' }, [lhValue, lhUnit])),
    labeled('Letter spacing', el('span', { class: 'inline' }, [lsValue, lsUnit])),
    applyBtn,
  ]);

  const sizes = group.variants.map((v) => v.fontSize);
  const minSize = round(Math.min(...sizes));
  const maxSize = round(Math.max(...sizes));
  const sizeLabel = minSize === maxSize ? `${minSize}px` : `${minSize}–${maxSize}px`;
  const weights = group.variants.map((v) => styleWeight(v.fontStyle));
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const weightLabel = minW === maxW ? weightName(minW) : `${weightName(minW)}–${weightName(maxW)}`;

  return el('section', { class: 'group' }, [
    groupHead(
      group.fontFamily,
      `${weightLabel} · ${sizeLabel} · ${group.variants.length} style(s)`,
      masterCb,
    ),
    el('div', { class: 'group-body' }, [...rows, banner, target]),
  ]);
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  return el('label', {}, [el('span', {}, [label]), control]);
}

function optionEl(value: string, label: string): HTMLOptionElement {
  return el('option', { value }, [label]) as HTMLOptionElement;
}

function groupHead(title: string, sub: string, master?: HTMLInputElement): HTMLElement {
  const children: (Node | string)[] = [];
  if (master) children.push(master);
  children.push(
    el('span', { class: 'group-title' }, [title, ' ', el('span', { class: 'group-sub' }, [`· ${sub}`])]),
  );
  return el('div', { class: 'group-head' }, children);
}

/* -------------------------------- wiring ------------------------------- */

function getOptions(scope: 'page' | 'file'): ScanOptions {
  return {
    scope,
    includeLocked: ($('optLocked') as HTMLInputElement).checked,
    includeHidden: ($('optHidden') as HTMLInputElement).checked,
    includeInstances: ($('optInstances') as HTMLInputElement).checked,
    colorThreshold: parseFloat(($('optThreshold') as HTMLInputElement).value) || 5,
    metric: ($('optMetric') as HTMLSelectElement).value === 'cie76' ? 'cie76' : 'ciede2000',
    fontSizeTolerance: parseFloat(($('optFontTol') as HTMLInputElement).value) || 0,
  };
}

function setTab(tab: 'color' | 'font'): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
    const active = t.dataset.tab === tab;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  $('panel-color').classList.toggle('hidden', tab !== 'color');
  $('panel-font').classList.toggle('hidden', tab !== 'font');
}

function showProgress(text: string): void {
  $('progressText').textContent = text;
  $('progress').classList.remove('hidden');
}

function hideProgress(): void {
  $('progress').classList.add('hidden');
}

function renderStats(result: ScanResultDTO): void {
  const s = result.stats;
  const bar = $('statsBar');
  bar.classList.remove('hidden');
  const scopeLabel = { selection: 'Selection', page: 'Page', file: 'File' }[result.scope];
  bar.textContent =
    `${scopeLabel} · ${s.nodesScanned} nodes · ` +
    `${s.solidUsages} solid · ${s.gradientUsages} gradient · ${s.textRanges} text · ` +
    `${s.skippedLinked} already linked`;
}

/* ------------------------------ scan flow ------------------------------ */

let scanning = false;
let scanWatchdog = 0;

const SCAN_LABELS = { page: 'Scan page', file: 'Scan file' } as const;

function scanBtn(scope: 'page' | 'file'): HTMLButtonElement {
  return $(scope === 'page' ? 'scanPageBtn' : 'scanFileBtn') as HTMLButtonElement;
}

function startScan(scope: 'page' | 'file'): void {
  if (scanning) return;
  scanning = true;
  scanBtn('page').disabled = true;
  scanBtn('file').disabled = true;
  scanBtn(scope).textContent = 'Scanning…';
  $('content').scrollTop = 0;
  showProgress('Scanning…');
  // If the sandbox never acknowledges (message lost), recover instead of
  // leaving the buttons dead.
  scanWatchdog = window.setTimeout(endScan, 4000);
  postToCode({ type: 'scan', options: getOptions(scope) });
}

function endScan(): void {
  scanning = false;
  window.clearTimeout(scanWatchdog);
  hideProgress();
  for (const scope of ['page', 'file'] as const) {
    const btn = scanBtn(scope);
    btn.disabled = false;
    btn.textContent = SCAN_LABELS[scope];
  }
}

function init(): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
    t.addEventListener('click', () => setTab(t.dataset.tab === 'font' ? 'font' : 'color'));
  });

  const settingsBtn = $('settingsBtn');
  settingsBtn.addEventListener('click', () => {
    const hidden = $('settings').classList.toggle('hidden');
    settingsBtn.setAttribute('aria-expanded', String(!hidden));
    settingsBtn.classList.toggle('active', !hidden);
  });

  const thr = $('optThreshold') as HTMLInputElement;
  const thrOut = $('optThresholdOut');
  thr.addEventListener('input', () => (thrOut.textContent = thr.value));

  const fontTol = $('optFontTol') as HTMLInputElement;
  const fontTolOut = $('optFontTolOut');
  fontTol.addEventListener('input', () => (fontTolOut.textContent = fontTol.value));

  scanBtn('page').addEventListener('click', () => startScan('page'));
  scanBtn('file').addEventListener('click', () => startScan('file'));

  window.onmessage = (event: MessageEvent) => {
    const msg = event.data.pluginMessage as CodeToUI | undefined;
    if (!msg) return;
    switch (msg.type) {
      case 'scan-started':
        window.clearTimeout(scanWatchdog);
        showProgress(`Scanning ${msg.scope}…`);
        break;
      case 'scan-progress':
        showProgress(`Scanning… ${msg.processed} nodes`);
        break;
      case 'scan-result':
        endScan();
        applyDoneHandlers.clear();
        applyResetHandlers.clear();
        inflightGroupId = null;
        renderColorGroups(msg.result.colorGroups);
        renderFontGroups(msg.result.fontGroups);
        renderStats(msg.result);
        break;
      case 'apply-done':
        applyDoneHandlers.get(msg.groupId)?.(msg.applied, msg.failed);
        applyDoneHandlers.delete(msg.groupId);
        applyResetHandlers.delete(msg.groupId);
        if (inflightGroupId === msg.groupId) inflightGroupId = null;
        break;
      case 'scope': {
        const hint = $('scopeHint');
        hint.textContent =
          msg.scope === 'selection'
            ? `Scan page covers the selection · ${msg.count} layer${msg.count > 1 ? 's' : ''}`
            : 'Scan page covers the current page';
        break;
      }
      case 'error':
        if (scanning) endScan();
        if (inflightGroupId) {
          applyResetHandlers.get(inflightGroupId)?.();
          applyResetHandlers.delete(inflightGroupId);
          applyDoneHandlers.delete(inflightGroupId);
          inflightGroupId = null;
        }
        postToCode({ type: 'notify', message: `Error: ${msg.message}` });
        break;
    }
  };

  setTab('color');
  // Take focus right away so the desktop app's first-click-focuses-the-window
  // quirk can't swallow the first button press.
  window.focus();
}

init();
