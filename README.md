# Pretoken

A Figma plugin that finds the **hard-coded values** scattered across a free-form
mockup — solid colors, gradients and orphan text styles that aren't linked to any
style or variable — clusters them by perceptual / structural similarity, and lets
you **merge and replace them in bulk** before building a design system.

Two tabs:

- **Color Merger** — solid colors *and* gradients. Colors are converted to CIELAB
  and clustered with the **CIEDE2000** Delta E formula (CIE76 also available),
  complete-linkage (every pair in a group must be within the threshold, so groups
  can't drift), with perceptual guards: neutrals never merge with tinted colors,
  and clearly tinted colors of different hue families stay apart.
  Each cluster shows every shade with a checkbox (on by default) and a 1-click
  **Copy** for its hex; a single **Replace by** field defines the final color and
  applies it to every checked shade. Gradients are grouped by their representative
  color and unified to a canonical stop set (★).
- **Font Merger** — orphan text styles grouped by font family + size proximity
  (default: 1px max size span per group, adjustable in ⚙ — 12px microcopy and
  14px body text are distinct styles in a design system) + weight proximity
  (at most two adjacent weights of the standard scale per group: Semi Bold can
  sit with Medium or Bold, never with Regular).
  Each row reads e.g. `Inter Semibold · 13px · 18px LH · 0% LS` with its own
  checkbox; a target editor (family / style / size / line-height / letter-spacing)
  applies one clean style to every checked range.

## Architecture

```
manifest.json            Figma plugin manifest (documentAccess: dynamic-page)
build.mjs                esbuild build: bundles code.ts, inlines UI into one HTML
tsconfig.json            Strict TypeScript config (@figma/plugin-typings)
src/
  shared/                Pure, framework-free logic (no Figma API)
    color.ts             RGB <-> HEX, RGB -> CIELAB, Delta E (CIE76 + CIEDE2000)
    colorCluster.ts      Greedy Delta-E clustering of solids & gradients
    fontCluster.ts       Structural clustering of text styles
    types.ts             Typed UI <-> sandbox message protocol + DTOs
  main/                  Sandbox side (Figma API)
    code.ts              Entry point, message router, DTO + id-map builder
    scan.ts              Performant tree traversal + extraction + aggregation
    model.ts             Node references, safe paint read/write, font loading
    colorApply.ts        Apply solid replacement / gradient unification
    fontApply.ts         Apply a target text style to checked ranges
  ui/                    Plugin window
    ui.html              Template (CSS/JS injected at build time)
    ui.css               Figma-native styling (theme variables, light/dark)
    ui.ts                Render groups, checkboxes, copy, post apply requests
dist/                    Build output referenced by manifest.json
```

The heavy data (the exact node usages behind each swatch / variant) never leaves
the sandbox. The UI only receives display DTOs keyed by stable ids and sends those
ids back when applying a merge — so the bridge stays light even on huge files.

## Build

```bash
npm install
npm run build      # writes dist/code.js and dist/ui.html
npm run watch      # rebuild on change
npm run typecheck  # tsc --noEmit
```

## Load & test in Figma

1. `npm install && npm run build`
2. Figma desktop → **Plugins → Development → Import plugin from manifest…**
3. Select this folder's `manifest.json`.
4. Open a file with hard-coded colors / text and run the plugin. **Scan page**
   covers the current page (narrowed to the selection if there is one); **Scan
   file** walks every page of the document — handy to exclude playground /
   experimentation pages by simply scanning the page you care about.
5. Adjust the **Delta E threshold** and the **font size grouping range** in ⚙ if
   clusters are too loose / too tight, tweak checkboxes, set targets, and apply.
   Each merge confirms in place
   (✓ banner + merged rows grayed out); click a row's `N×` count to select the
   matching layers on the canvas.

## Reliability notes

- Paints already bound to a **style** (`fillStyleId` / `strokeStyleId` /
  `textStyleId`) or a **variable** (`boundVariables`) are ignored — they're
  already tokenized.
- Hidden and locked layers are skipped by default (toggle in ⚙). Component
  instances are included by default; merging inside one creates a normal override.
  `figma.skipInvisibleInstanceChildren` is enabled for speed.
- Fonts are loaded with `loadFontAsync` before any text edit; mixed-font ranges
  are handled per styled segment via `getStyledTextSegments`.
- Scanning yields to the event loop periodically so the canvas/UI stay responsive
  on documents with tens of thousands of nodes.

## Performance & correctness

- `npm run typecheck` passes under `strict`.
- The CIEDE2000 implementation is verified against the Sharma et al. reference
  test data (all sample pairs match to 4 decimals).
