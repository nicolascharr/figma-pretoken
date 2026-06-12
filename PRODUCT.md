# Product

Pretoken — Figma plugin (formerly "Design Cleaner & Token Prepper").

## Register

product

## Users

Product and brand designers cleaning up free-form Figma mockups before building a
design system. They are mid-task inside Figma: the plugin window sits next to the
canvas, and every minute spent in it is a minute not spent designing. They know
Figma's native UI intimately and expect the plugin to behave like a built-in panel.

## Product Purpose

Find every hard-coded value in a mockup (solid colors, gradients, orphan text
styles), cluster the near-duplicates perceptually, and merge them in bulk so the
file is ready for tokens and styles. Success: a designer scans, reviews clusters,
merges, and trusts that the canvas now matches what the plugin reports.

## Brand Personality

Precise, quiet, trustworthy. The plugin should feel like a native Figma panel:
Inter at 11px, Figma theme variables, standard form controls. Zero decoration;
the data (swatches, gradients, style rows) is the visual interest.

## Anti-references

- Marketing-flavored plugin UIs with hero illustrations, gradients-on-buttons, onboarding carousels.
- Dashboards that bury actions under tabs of settings.
- Anything that diverges from Figma's own control vocabulary (custom scrollbars, exotic checkboxes).

## Design Principles

- Native or nothing: every control matches Figma's own panels so the tool disappears into the task.
- Truthful state: the UI always reflects what is actually on the canvas; every mutation gives immediate, in-place feedback.
- Bulk-first: the common path (scan, review, merge all) takes the fewest clicks; per-item control stays one click away.
- Data is the decoration: swatches, gradient bars, and counts carry the visual hierarchy; chrome stays neutral.

## Accessibility & Inclusion

- Respect Figma light/dark theme via themeColors variables.
- All actions keyboard-reachable; visible focus states; buttons are real buttons.
- Color information always paired with text (hex values), never color alone.
