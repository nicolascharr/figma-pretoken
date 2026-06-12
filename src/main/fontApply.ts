// Applies a single target text style to every checked orphan text range.

import { getNodeById, loadFontsForNode, type TextRangeRef } from './model';
import type { FontTarget, LetterSpacingDTO, LineHeightDTO } from '../shared/types';

interface ApplyResult {
  applied: number;
  failed: number;
}

function toFigmaLineHeight(lh: LineHeightDTO): LineHeight {
  return lh.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: lh.unit, value: lh.value };
}

function toFigmaLetterSpacing(ls: LetterSpacingDTO): LetterSpacing {
  return { unit: ls.unit, value: ls.value };
}

export async function applyFont(refs: TextRangeRef[], target: FontTarget): Promise<ApplyResult> {
  let applied = 0;
  let failed = 0;

  const targetFont: FontName = { family: target.fontFamily, style: target.fontStyle };
  try {
    await figma.loadFontAsync(targetFont);
  } catch {
    // Target font isn't available in this document — nothing can be applied.
    return { applied: 0, failed: refs.length };
  }

  const lineHeight = toFigmaLineHeight(target.lineHeight);
  const letterSpacing = toFigmaLetterSpacing(target.letterSpacing);
  const loadedNodes = new Set<string>();

  for (const ref of refs) {
    try {
      const node = await getNodeById(ref.nodeId);
      if (!node || node.type !== 'TEXT') {
        failed++;
        continue;
      }
      // The existing fonts of the range must be loaded before we can edit it.
      if (!loadedNodes.has(node.id)) {
        await loadFontsForNode(node);
        loadedNodes.add(node.id);
      }
      const start = Math.max(0, ref.start);
      const end = Math.min(node.characters.length, ref.end);
      if (end <= start) {
        failed++;
        continue;
      }
      // Order matters: set the font first so size/line-height edits are valid.
      node.setRangeFontName(start, end, targetFont);
      node.setRangeFontSize(start, end, target.fontSize);
      node.setRangeLineHeight(start, end, lineHeight);
      node.setRangeLetterSpacing(start, end, letterSpacing);
      applied++;
    } catch {
      failed++;
    }
  }

  return { applied, failed };
}
