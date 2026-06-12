"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // src/shared/fontCluster.ts
  function usageCount(a) {
    return a.usages.length;
  }
  var WEIGHT_NAMES = [
    ["extralight", 200],
    ["ultralight", 200],
    ["extrabold", 800],
    ["ultrabold", 800],
    ["semibold", 600],
    ["demibold", 600],
    ["hairline", 100],
    ["regular", 400],
    ["medium", 500],
    ["normal", 400],
    ["light", 300],
    ["heavy", 900],
    ["black", 900],
    ["roman", 400],
    ["thin", 100],
    ["bold", 700],
    ["demi", 600],
    ["book", 400]
  ];
  function styleWeight(fontStyle) {
    const s = fontStyle.toLowerCase().replace(/[\s_-]/g, "");
    for (const [name, w] of WEIGHT_NAMES) if (s.indexOf(name) !== -1) return w;
    return 400;
  }
  var MAX_WEIGHT_SPAN = 100;
  function clusterFonts(aggs, fontSizeTol = 1) {
    var _a;
    const byFamily = /* @__PURE__ */ new Map();
    for (const agg of aggs) {
      const list = (_a = byFamily.get(agg.fontFamily)) != null ? _a : [];
      list.push(agg);
      byFamily.set(agg.fontFamily, list);
    }
    const out = [];
    for (const [fontFamily, list] of byFamily) {
      const sorted = [...list].sort((a, b) => usageCount(b) - usageCount(a));
      const clusters = [];
      for (const agg of sorted) {
        const weight = styleWeight(agg.fontStyle);
        let best = null;
        let bestDist = Infinity;
        for (const c of clusters) {
          const sizeSpan = Math.max(c.maxSize, agg.fontSize) - Math.min(c.minSize, agg.fontSize);
          if (sizeSpan > fontSizeTol) continue;
          const weightSpan = Math.max(c.maxWeight, weight) - Math.min(c.minWeight, weight);
          if (weightSpan > MAX_WEIGHT_SPAN) continue;
          const d = Math.abs(agg.fontSize - (c.minSize + c.maxSize) / 2) + Math.abs(weight - (c.minWeight + c.maxWeight) / 2) / 1e3;
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
            variants: [agg]
          });
        }
      }
      for (const c of clusters) {
        out.push({ fontFamily, variants: c.variants.sort((a, b) => usageCount(b) - usageCount(a)) });
      }
    }
    return out.sort(
      (a, b) => b.variants.reduce((s, v) => s + usageCount(v), 0) - a.variants.reduce((s, v) => s + usageCount(v), 0)
    );
  }

  // src/shared/color.ts
  function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }
  function rgbToHex({ r, g, b }) {
    const to = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
  }
  function hexToRgb(hex) {
    let h = hex.trim().replace(/^#/, "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255
    };
  }
  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function rgbToLab({ r, g, b }) {
    const R = srgbToLinear(r);
    const G = srgbToLinear(g);
    const B = srgbToLinear(b);
    let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
    let Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
    let Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
    X /= 0.95047;
    Y /= 1;
    Z /= 1.08883;
    const f = (t) => t > 8856e-6 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    const fx = f(X);
    const fy = f(Y);
    const fz = f(Z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }
  function deltaE76(a, b) {
    return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
  }
  function deltaE2000(lab1, lab2) {
    const { L: L1, a: a1, b: b1 } = lab1;
    const { L: L2, a: a2, b: b2 } = lab2;
    const kL = 1, kC = 1, kH = 1;
    const C1 = Math.sqrt(a1 * a1 + b1 * b1);
    const C2 = Math.sqrt(a2 * a2 + b2 * b2);
    const Cbar = (C1 + C2) / 2;
    const Cbar7 = Math.pow(Cbar, 7);
    const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;
    const C1p = Math.sqrt(a1p * a1p + b1 * b1);
    const C2p = Math.sqrt(a2p * a2p + b2 * b2);
    const h1p = hpf(b1, a1p);
    const h2p = hpf(b2, a2p);
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    const dhp = dhpf(C1p, C2p, h1p, h2p);
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);
    const Lbarp = (L1 + L2) / 2;
    const Cbarp = (C1p + C2p) / 2;
    const hbarp = ahpf(C1p, C2p, h1p, h2p);
    const T = 1 - 0.17 * Math.cos(rad(hbarp - 30)) + 0.24 * Math.cos(rad(2 * hbarp)) + 0.32 * Math.cos(rad(3 * hbarp + 6)) - 0.2 * Math.cos(rad(4 * hbarp - 63));
    const dtheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    const Cbarp7 = Math.pow(Cbarp, 7);
    const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
    const Sl = 1 + 0.015 * Math.pow(Lbarp - 50, 2) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
    const Sc = 1 + 0.045 * Cbarp;
    const Sh = 1 + 0.015 * Cbarp * T;
    const Rt = -Math.sin(rad(2 * dtheta)) * Rc;
    return Math.sqrt(
      Math.pow(dLp / (kL * Sl), 2) + Math.pow(dCp / (kC * Sc), 2) + Math.pow(dHp / (kH * Sh), 2) + Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh))
    );
  }
  function rad(deg) {
    return deg * Math.PI / 180;
  }
  function hpf(b, ap) {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) * 180 / Math.PI;
    return h >= 0 ? h : h + 360;
  }
  function dhpf(C1p, C2p, h1p, h2p) {
    if (C1p * C2p === 0) return 0;
    let d = h2p - h1p;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    return d;
  }
  function ahpf(C1p, C2p, h1p, h2p) {
    if (C1p * C2p === 0) return h1p + h2p;
    let s = h1p + h2p;
    if (Math.abs(h1p - h2p) > 180) {
      if (s < 360) s += 360;
      else s -= 360;
    }
    return s / 2;
  }
  function deltaE(a, b, metric = "ciede2000") {
    return metric === "cie76" ? deltaE76(a, b) : deltaE2000(a, b);
  }

  // src/shared/colorCluster.ts
  function usageCount2(a) {
    return a.usages.length;
  }
  var NEUTRAL_CHROMA = 6;
  var CLEARLY_TINTED = 10;
  var MAX_HUE_DIFF = 40;
  function chroma(lab) {
    return Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  }
  function hueDiff(x, y) {
    const hx = Math.atan2(x.b, x.a) * 180 / Math.PI;
    const hy = Math.atan2(y.b, y.a) * 180 / Math.PI;
    const d = Math.abs(hx - hy) % 360;
    return d > 180 ? 360 - d : d;
  }
  function compatible(x, y) {
    const cx = chroma(x);
    const cy = chroma(y);
    const lo = Math.min(cx, cy);
    const hi = Math.max(cx, cy);
    if (lo <= NEUTRAL_CHROMA && hi >= CLEARLY_TINTED) return false;
    if (lo >= CLEARLY_TINTED && hueDiff(x, y) > MAX_HUE_DIFF) return false;
    return true;
  }
  function clusterSolids(aggs, threshold, metric) {
    const sorted = [...aggs].sort((a, b) => usageCount2(b) - usageCount2(a));
    const clusters = [];
    for (const agg of sorted) {
      let best = null;
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
      swatches: c.swatches.sort((a, b) => usageCount2(b) - usageCount2(a))
    }));
  }
  function clusterGradients(aggs, threshold, metric) {
    var _a;
    const byType = /* @__PURE__ */ new Map();
    for (const agg of aggs) {
      const list = (_a = byType.get(agg.type)) != null ? _a : [];
      list.push(agg);
      byType.set(agg.type, list);
    }
    const out = [];
    for (const [type, list] of byType) {
      const sorted = [...list].sort((a, b) => usageCount2(b) - usageCount2(a));
      const clusters = [];
      for (const agg of sorted) {
        let best = null;
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
        out.push({ type, variants: c.variants.sort((a, b) => usageCount2(b) - usageCount2(a)) });
      }
    }
    return out;
  }

  // src/shared/types.ts
  function postToUI(msg) {
    figma.ui.postMessage(msg);
  }

  // src/main/scan.ts
  var GRADIENT_TYPES = [
    "GRADIENT_LINEAR",
    "GRADIENT_RADIAL",
    "GRADIENT_ANGULAR",
    "GRADIENT_DIAMOND"
  ];
  function isGradientType(t) {
    return GRADIENT_TYPES.indexOf(t) !== -1;
  }
  var round = (n, p = 4) => Math.round(n * 10 ** p) / 10 ** p;
  async function scan(options, onProgress) {
    figma.skipInvisibleInstanceChildren = !options.includeHidden;
    const selection = figma.currentPage.selection;
    let scope;
    let roots;
    if (options.scope === "file") {
      scope = "file";
      const all = [];
      for (const page of figma.root.children) all.push(...page.children);
      roots = all;
    } else if (selection.length > 0) {
      scope = "selection";
      roots = selection;
    } else {
      scope = "page";
      roots = figma.currentPage.children;
    }
    const stats = {
      nodesScanned: 0,
      solidUsages: 0,
      gradientUsages: 0,
      textRanges: 0,
      skippedLinked: 0,
      skippedLockedHidden: 0
    };
    const solids = /* @__PURE__ */ new Map();
    const gradients = /* @__PURE__ */ new Map();
    const fonts = /* @__PURE__ */ new Map();
    const solidOpacityVotes = /* @__PURE__ */ new Map();
    const addSolid = (rgb, opacity, host) => {
      var _a;
      const hex = rgbToHex(rgb);
      let agg = solids.get(hex);
      if (!agg) {
        agg = { hex, rgb, lab: rgbToLab(rgb), opacity, usages: [] };
        solids.set(hex, agg);
        solidOpacityVotes.set(hex, /* @__PURE__ */ new Map());
      }
      agg.usages.push(host);
      const votes = solidOpacityVotes.get(hex);
      const key = round(opacity, 2);
      votes.set(key, ((_a = votes.get(key)) != null ? _a : 0) + 1);
      stats.solidUsages++;
    };
    const addGradient = (type, stops, host) => {
      const stopDtos = stops.map((s) => {
        var _a;
        return {
          hex: rgbToHex(s.color),
          opacity: round((_a = s.color.a) != null ? _a : 1, 3),
          position: round(s.position, 3)
        };
      });
      const signature = type + "|" + stopDtos.map((s) => `${s.hex}@${s.position}x${s.opacity}`).join(",");
      let agg = gradients.get(signature);
      if (!agg) {
        const rep = representativeColor(stops);
        agg = {
          signature,
          type,
          stops: stopDtos,
          representativeHex: rgbToHex(rep),
          representativeLab: rgbToLab(rep),
          usages: []
        };
        gradients.set(signature, agg);
      }
      agg.usages.push(host);
      stats.gradientUsages++;
    };
    const extractPaints = (paints, makeHost) => {
      var _a;
      for (let i = 0; i < paints.length; i++) {
        const p = paints[i];
        if (p.visible === false) continue;
        if (p.type === "SOLID") {
          if (p.boundVariables && p.boundVariables.color) {
            stats.skippedLinked++;
            continue;
          }
          addSolid(p.color, (_a = p.opacity) != null ? _a : 1, makeHost(i));
        } else if (isGradientType(p.type)) {
          const grad = p;
          const anyBound = grad.gradientStops.some((s) => s.boundVariables && s.boundVariables.color);
          if (anyBound) {
            stats.skippedLinked++;
            continue;
          }
          addGradient(p.type, grad.gradientStops, makeHost(i));
        }
      }
    };
    const extractText = (node) => {
      const segments = node.getStyledTextSegments([
        "fontName",
        "fontSize",
        "lineHeight",
        "letterSpacing",
        "textStyleId",
        "fills",
        "fillStyleId"
      ]);
      for (const seg of segments) {
        if (seg.fillStyleId && seg.fillStyleId !== "") {
          stats.skippedLinked++;
        } else {
          extractPaints(seg.fills, (i) => ({
            kind: "textRangeFill",
            nodeId: node.id,
            start: seg.start,
            end: seg.end,
            index: i
          }));
        }
        if (seg.textStyleId && seg.textStyleId !== "") {
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
          `${letterSpacing.unit}:${round(letterSpacing.value, 2)}`
        ].join("|");
        let agg = fonts.get(signature);
        if (!agg) {
          agg = {
            signature,
            fontFamily: seg.fontName.family,
            fontStyle: seg.fontName.style,
            fontSize: seg.fontSize,
            lineHeight,
            letterSpacing,
            usages: []
          };
          fonts.set(signature, agg);
        }
        agg.usages.push({ nodeId: node.id, start: seg.start, end: seg.end });
        stats.textRanges++;
      }
    };
    const stack = [...roots].reverse();
    let sinceYield = 0;
    while (stack.length > 0) {
      const node = stack.pop();
      if (!options.includeHidden && node.visible === false) {
        stats.skippedLockedHidden++;
        continue;
      }
      if (!options.includeLocked && node.locked) {
        stats.skippedLockedHidden++;
        continue;
      }
      if (!options.includeInstances && node.type === "INSTANCE") {
        continue;
      }
      stats.nodesScanned++;
      if (node.type === "TEXT") {
        try {
          extractText(node);
        } catch (e) {
        }
      } else {
        if ("fills" in node && hasUnlinkedFills(node)) {
          const fills = node.fills;
          if (fills !== figma.mixed) {
            extractPaints(fills, (i) => ({ kind: "fill", nodeId: node.id, index: i }));
          }
        }
      }
      if ("strokes" in node && hasUnlinkedStrokes(node)) {
        extractPaints(node.strokes, (i) => ({ kind: "stroke", nodeId: node.id, index: i }));
      }
      if ("children" in node) {
        const children = node.children;
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
      if (++sinceYield >= 800) {
        sinceYield = 0;
        onProgress(stats.nodesScanned);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress(stats.nodesScanned);
    for (const [hex, agg] of solids) {
      const votes = solidOpacityVotes.get(hex);
      if (votes) {
        let bestOp = agg.opacity;
        let bestN = -1;
        for (const [op, n] of votes) if (n > bestN) bestN = n, bestOp = op;
        agg.opacity = bestOp;
      }
    }
    return {
      scope,
      stats,
      solidAggs: [...solids.values()],
      gradientAggs: [...gradients.values()],
      fontAggs: [...fonts.values()]
    };
  }
  function hasUnlinkedFills(node) {
    const id = node.fillStyleId;
    if (typeof id === "string" && id !== "") return false;
    return true;
  }
  function hasUnlinkedStrokes(node) {
    const id = node.strokeStyleId;
    if (typeof id === "string" && id !== "") return false;
    return true;
  }
  function representativeColor(stops) {
    var _a;
    if (stops.length === 0) return { r: 0, g: 0, b: 0 };
    const sorted = [...stops].sort((a, b2) => a.position - b2.position);
    let r = 0, g = 0, b = 0, wsum = 0;
    for (let i = 0; i < sorted.length; i++) {
      const prev = i === 0 ? 0 : (sorted[i - 1].position + sorted[i].position) / 2;
      const next = i === sorted.length - 1 ? 1 : (sorted[i].position + sorted[i + 1].position) / 2;
      const w = Math.max(next - prev, 1e-4) * ((_a = sorted[i].color.a) != null ? _a : 1);
      r += sorted[i].color.r * w;
      g += sorted[i].color.g * w;
      b += sorted[i].color.b * w;
      wsum += w;
    }
    if (wsum === 0) return { r: sorted[0].color.r, g: sorted[0].color.g, b: sorted[0].color.b };
    return { r: r / wsum, g: g / wsum, b: b / wsum };
  }
  function toLineHeightDTO(lh) {
    if (lh.unit === "AUTO") return { unit: "AUTO", value: 0 };
    return { unit: lh.unit, value: lh.value };
  }
  function toLetterSpacingDTO(ls) {
    return { unit: ls.unit, value: ls.value };
  }

  // src/main/model.ts
  async function getNodeById(id) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || !("type" in node)) return null;
    if (node.type === "PAGE" || node.type === "DOCUMENT") return null;
    return node;
  }
  async function loadFontsForNode(node) {
    if (node.characters.length === 0) {
      if (node.fontName !== figma.mixed) await figma.loadFontAsync(node.fontName);
      return;
    }
    const segments = node.getStyledTextSegments(["fontName"]);
    const seen = /* @__PURE__ */ new Set();
    const loads = [];
    for (const seg of segments) {
      const fn = seg.fontName;
      const key = `${fn.family}\0${fn.style}`;
      if (seen.has(key)) continue;
      seen.add(key);
      loads.push(figma.loadFontAsync(fn));
    }
    await Promise.all(loads);
  }
  async function readHostPaints(host) {
    const node = await getNodeById(host.nodeId);
    if (!node) return null;
    if (host.kind === "fill") {
      if (!("fills" in node)) return null;
      const fills = node.fills;
      if (fills === figma.mixed) return null;
      return fills.map((p) => clonePaint(p));
    }
    if (host.kind === "stroke") {
      if (!("strokes" in node)) return null;
      return node.strokes.map((p) => clonePaint(p));
    }
    if (node.type !== "TEXT") return null;
    const ranged = node.getRangeFills(host.start, host.end);
    if (ranged === figma.mixed) return null;
    return ranged.map((p) => clonePaint(p));
  }
  async function writeHostPaints(host, paints) {
    const node = await getNodeById(host.nodeId);
    if (!node) return false;
    if (host.kind === "fill") {
      if (!("fills" in node)) return false;
      node.fills = paints;
      return true;
    }
    if (host.kind === "stroke") {
      if (!("strokes" in node)) return false;
      node.strokes = paints;
      return true;
    }
    if (node.type !== "TEXT") return false;
    await loadFontsForNode(node);
    node.setRangeFills(host.start, host.end, paints);
    return true;
  }
  function clonePaint(p) {
    return JSON.parse(JSON.stringify(p));
  }
  function makeSolid(hex, opacity) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    return { type: "SOLID", color: { r: rgb.r, g: rgb.g, b: rgb.b }, opacity };
  }
  function dtoStopsToFigma(stops) {
    return stops.map((s) => {
      var _a;
      const rgb = (_a = hexToRgb(s.hex)) != null ? _a : { r: 0, g: 0, b: 0 };
      return { position: s.position, color: { r: rgb.r, g: rgb.g, b: rgb.b, a: s.opacity } };
    });
  }

  // src/main/colorApply.ts
  function arrayKey(h) {
    if (h.kind === "fill") return `fill:${h.nodeId}`;
    if (h.kind === "stroke") return `stroke:${h.nodeId}`;
    return `trf:${h.nodeId}:${h.start}:${h.end}`;
  }
  function groupByArray(hosts) {
    var _a;
    const map = /* @__PURE__ */ new Map();
    for (const h of hosts) {
      const k = arrayKey(h);
      const list = (_a = map.get(k)) != null ? _a : [];
      list.push(h);
      map.set(k, list);
    }
    return map;
  }
  async function applyToHosts(hosts, mutate) {
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
      } catch (e) {
        failed += group.length;
      }
    }
    return { applied, failed };
  }
  async function applySolid(hosts, targetHex) {
    return applyToHosts(hosts, (paints, index2) => {
      var _a;
      const current = paints[index2];
      const opacity = current.type === "SOLID" ? (_a = current.opacity) != null ? _a : 1 : 1;
      const solid = makeSolid(targetHex, opacity);
      if (!solid) return false;
      paints[index2] = solid;
      return true;
    });
  }
  async function applyGradient(hosts, canonicalStops) {
    const stops = dtoStopsToFigma(canonicalStops);
    return applyToHosts(hosts, (paints, index2) => {
      const current = paints[index2];
      if (current.type !== "GRADIENT_LINEAR" && current.type !== "GRADIENT_RADIAL" && current.type !== "GRADIENT_ANGULAR" && current.type !== "GRADIENT_DIAMOND") {
        return false;
      }
      const grad = current;
      paints[index2] = __spreadProps(__spreadValues({}, grad), { gradientStops: stops.map((s) => __spreadValues({}, s)) });
      return true;
    });
  }

  // src/main/fontApply.ts
  function toFigmaLineHeight(lh) {
    return lh.unit === "AUTO" ? { unit: "AUTO" } : { unit: lh.unit, value: lh.value };
  }
  function toFigmaLetterSpacing(ls) {
    return { unit: ls.unit, value: ls.value };
  }
  async function applyFont(refs, target) {
    let applied = 0;
    let failed = 0;
    const targetFont = { family: target.fontFamily, style: target.fontStyle };
    try {
      await figma.loadFontAsync(targetFont);
    } catch (e) {
      return { applied: 0, failed: refs.length };
    }
    const lineHeight = toFigmaLineHeight(target.lineHeight);
    const letterSpacing = toFigmaLetterSpacing(target.letterSpacing);
    const loadedNodes = /* @__PURE__ */ new Set();
    for (const ref of refs) {
      try {
        const node = await getNodeById(ref.nodeId);
        if (!node || node.type !== "TEXT") {
          failed++;
          continue;
        }
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
        node.setRangeFontName(start, end, targetFont);
        node.setRangeFontSize(start, end, target.fontSize);
        node.setRangeLineHeight(start, end, lineHeight);
        node.setRangeLetterSpacing(start, end, letterSpacing);
        applied++;
      } catch (e) {
        failed++;
      }
    }
    return { applied, failed };
  }

  // src/main/code.ts
  var index = {
    solid: /* @__PURE__ */ new Map(),
    gradient: /* @__PURE__ */ new Map(),
    font: /* @__PURE__ */ new Map()
  };
  figma.showUI(__html__, { width: 440, height: 660, themeColors: true });
  figma.ui.onmessage = (msg) => {
    switch (msg.type) {
      case "scan":
        void handleScan(msg.options);
        break;
      case "apply-solid":
        void handleApplySolid(msg.groupId, msg.checkedSwatchIds, msg.targetHex);
        break;
      case "apply-gradient":
        void handleApplyGradient(msg.groupId, msg.checkedVariantIds, msg.canonicalVariantId);
        break;
      case "apply-font":
        void handleApplyFont(msg.groupId, msg.checkedVariantIds, msg.target);
        break;
      case "select-usages":
        void handleSelectUsages(msg.kind, msg.refId);
        break;
      case "resize":
        figma.ui.resize(Math.max(360, msg.width), Math.max(420, msg.height));
        break;
      case "notify":
        figma.notify(msg.message);
        break;
    }
  };
  function postScope() {
    const count = figma.currentPage.selection.length;
    postToUI({ type: "scope", scope: count > 0 ? "selection" : "page", count });
  }
  figma.on("selectionchange", postScope);
  figma.on("currentpagechange", postScope);
  postScope();
  async function handleScan(options) {
    index.solid.clear();
    index.gradient.clear();
    index.font.clear();
    try {
      if (options.scope === "file") await figma.loadAllPagesAsync();
      else await figma.currentPage.loadAsync();
      postScope();
      const selection = figma.currentPage.selection;
      const scope = options.scope === "file" ? "file" : selection.length > 0 ? "selection" : "page";
      postToUI({ type: "scan-started", scope });
      const data = await scan(options, (processed) => {
        postToUI({ type: "scan-progress", processed, total: processed });
      });
      const solidClusters = clusterSolids(data.solidAggs, options.colorThreshold, options.metric);
      const colorGroups = [];
      solidClusters.forEach((cluster, gi) => {
        const groupId = `csolid_${gi}`;
        const swatches = cluster.swatches.map((sw, si) => {
          const id = `${groupId}_s${si}`;
          index.solid.set(id, sw.usages);
          return { id, hex: sw.hex, opacity: sw.opacity, count: sw.usages.length };
        });
        if (swatches.length === 0) return;
        colorGroups.push({ id: groupId, kind: "solid", swatches, suggestedHex: swatches[0].hex });
      });
      const gradientClusters = clusterGradients(
        data.gradientAggs,
        options.colorThreshold,
        options.metric
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
          kind: "gradient",
          gradientType: cluster.type,
          variants,
          canonicalId: variants[0].id
        });
      });
      const fontClusters = clusterFonts(data.fontAggs, options.fontSizeTolerance);
      const fontGroups = [];
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
            count: v.usages.length
          };
        });
        if (variants.length === 0) return;
        const top = variants[0];
        const suggested = {
          fontFamily: top.fontFamily,
          fontStyle: top.fontStyle,
          fontSize: top.fontSize,
          lineHeight: top.lineHeight,
          letterSpacing: top.letterSpacing
        };
        fontGroups.push({ id: groupId, fontFamily: cluster.fontFamily, variants, suggested });
      });
      const result = {
        scope: data.scope,
        colorGroups,
        fontGroups,
        stats: data.stats
      };
      postToUI({ type: "scan-result", result });
    } catch (err) {
      postToUI({ type: "error", message: errorMessage(err) });
    }
  }
  async function handleApplySolid(groupId, checkedSwatchIds, targetHex) {
    try {
      const hosts = [];
      for (const id of checkedSwatchIds) {
        const u = index.solid.get(id);
        if (u) hosts.push(...u);
      }
      const res = await applySolid(hosts, targetHex);
      postToUI({ type: "apply-done", kind: "solid", groupId, applied: res.applied, failed: res.failed });
      figma.notify(`Merged ${res.applied} color usage(s)${res.failed ? `, ${res.failed} skipped` : ""}.`);
    } catch (err) {
      postToUI({ type: "error", message: errorMessage(err) });
    }
  }
  async function handleApplyGradient(groupId, checkedVariantIds, canonicalVariantId) {
    try {
      const canonical = index.gradient.get(canonicalVariantId);
      if (!canonical) {
        postToUI({ type: "error", message: "Canonical gradient no longer available \u2014 re-scan." });
        return;
      }
      const hosts = [];
      for (const id of checkedVariantIds) {
        const v = index.gradient.get(id);
        if (v) hosts.push(...v.hosts);
      }
      const res = await applyGradient(hosts, canonical.stops);
      postToUI({ type: "apply-done", kind: "gradient", groupId, applied: res.applied, failed: res.failed });
      figma.notify(
        `Unified ${res.applied} gradient usage(s)${res.failed ? `, ${res.failed} skipped` : ""}.`
      );
    } catch (err) {
      postToUI({ type: "error", message: errorMessage(err) });
    }
  }
  async function handleApplyFont(groupId, checkedVariantIds, target) {
    try {
      const refs = [];
      for (const id of checkedVariantIds) {
        const u = index.font.get(id);
        if (u) refs.push(...u);
      }
      const res = await applyFont(refs, target);
      postToUI({ type: "apply-done", kind: "font", groupId, applied: res.applied, failed: res.failed });
      figma.notify(
        `Merged ${res.applied} text range(s)${res.failed ? `, ${res.failed} skipped` : ""}.`
      );
    } catch (err) {
      postToUI({ type: "error", message: errorMessage(err) });
    }
  }
  async function handleSelectUsages(kind, refId) {
    var _a, _b, _c, _d;
    const nodeIds = /* @__PURE__ */ new Set();
    if (kind === "solid") {
      for (const h of (_a = index.solid.get(refId)) != null ? _a : []) nodeIds.add(h.nodeId);
    } else if (kind === "gradient") {
      for (const h of (_c = (_b = index.gradient.get(refId)) == null ? void 0 : _b.hosts) != null ? _c : []) nodeIds.add(h.nodeId);
    } else {
      for (const r of (_d = index.font.get(refId)) != null ? _d : []) nodeIds.add(r.nodeId);
    }
    if (nodeIds.size === 0) {
      figma.notify("No layers found for this entry \u2014 re-scan.");
      return;
    }
    const nodes = [];
    for (const id of nodeIds) {
      const node = await getNodeById(id);
      if (node) nodes.push(node);
    }
    if (nodes.length === 0) {
      figma.notify("These layers no longer exist \u2014 re-scan.");
      return;
    }
    let targets = nodes.filter((n) => pageOf(n) === figma.currentPage);
    let jumped = null;
    if (targets.length === 0) {
      jumped = pageOf(nodes[0]);
      if (!jumped) {
        figma.notify("These layers no longer exist \u2014 re-scan.");
        return;
      }
      await figma.setCurrentPageAsync(jumped);
      targets = nodes.filter((n) => pageOf(n) === jumped);
    }
    figma.currentPage.selection = targets;
    figma.viewport.scrollAndZoomIntoView(targets);
    figma.notify(
      jumped ? `Selected ${targets.length} layer(s) on page \u201C${jumped.name}\u201D.` : `Selected ${targets.length} layer(s).`
    );
  }
  function pageOf(node) {
    let p = node.parent;
    while (p && p.type !== "PAGE") p = p.parent;
    return p && p.type === "PAGE" ? p : null;
  }
  function errorMessage(err) {
    if (err instanceof Error) return err.message;
    return String(err);
  }
})();
