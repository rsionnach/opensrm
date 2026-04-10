#!/usr/bin/env node

// Converts .excalidraw JSON files to SVG (light + dark themes)
// No external dependencies required.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "..", "src");
const svgDir = join(__dirname, "..", "svg");

mkdirSync(svgDir, { recursive: true });

const DARK_COLOR_MAP = {
  "#ffffff": "#1e1e1e",
  "#1e1e1e": "#e0e0e0",
  "#a5d8ff": "#1a5276",
  "#b2f2bb": "#1a5632",
  "#ffec99": "#6b5b00",
  "#ffd8a8": "#6b4000",
  "#d0bfff": "#3d2d6b",
  "#e9ecef": "#2d2d2d",
};

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mapColor(color, theme) {
  if (theme === "light") return color;
  const lower = (color || "").toLowerCase();
  return DARK_COLOR_MAP[lower] || color;
}

function computeBounds(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    if (el.isDeleted) continue;
    const x = el.x || 0;
    const y = el.y || 0;
    const w = el.width || 0;
    const h = el.height || 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    if (el.type === "arrow" || el.type === "line") {
      for (const pt of el.points || []) {
        maxX = Math.max(maxX, x + pt[0]);
        maxY = Math.max(maxY, y + pt[1]);
      }
    } else {
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
  }
  return { minX, minY, maxX, maxY };
}

function renderArrowHead(x, y, angle, color, sw) {
  const size = 10 + sw;
  const x1 = x - size * Math.cos(angle - 0.4);
  const y1 = y - size * Math.sin(angle - 0.4);
  const x2 = x - size * Math.cos(angle + 0.4);
  const y2 = y - size * Math.sin(angle + 0.4);
  return `<polygon points="${x},${y} ${x1},${y1} ${x2},${y2}" fill="${color}" stroke="none"/>`;
}

function renderElement(el, theme, allElements) {
  if (el.isDeleted) return "";
  const stroke = mapColor(el.strokeColor || "#1e1e1e", theme);
  const bg = el.backgroundColor === "transparent"
    ? "none"
    : mapColor(el.backgroundColor || "transparent", theme);
  const sw = el.strokeWidth || 2;
  const opacity = (el.opacity ?? 100) / 100;
  const opacityAttr = opacity < 1 ? ` opacity="${opacity}"` : "";

  switch (el.type) {
    case "rectangle": {
      const rx = el.roundness ? 8 : 0;
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="${rx}" ry="${rx}" fill="${bg === "none" ? "none" : bg}" stroke="${stroke}" stroke-width="${sw}"${opacityAttr}/>`;
    }

    case "text": {
      const fontSize = el.fontSize || 16;
      const color = mapColor(el.strokeColor || "#1e1e1e", theme);
      const align = el.textAlign || "left";
      let tx = el.x;
      let ty = el.y;
      const lines = (el.text || "").split("\n");
      const lineHeight = fontSize * 1.25;

      // If bound to a container, center within it
      if (el.containerId) {
        const container = allElements.find((e) => e.id === el.containerId);
        if (container) {
          tx = container.x + container.width / 2;
          ty = container.y + container.height / 2 - ((lines.length - 1) * lineHeight) / 2;
          return lines
            .map(
              (line, i) =>
                `<text x="${tx}" y="${ty + i * lineHeight}" font-family="monospace, 'Courier New'" font-size="${fontSize}" fill="${color}" text-anchor="middle" dominant-baseline="central"${opacityAttr}>${escapeXml(line)}</text>`
            )
            .join("\n");
        }
      }

      // Standalone text
      const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
      if (align === "center") tx += (el.width || 0) / 2;
      else if (align === "right") tx += el.width || 0;
      ty += fontSize;

      return lines
        .map(
          (line, i) =>
            `<text x="${tx}" y="${ty + i * lineHeight}" font-family="monospace, 'Courier New'" font-size="${fontSize}" fill="${color}" text-anchor="${anchor}"${opacityAttr}>${escapeXml(line)}</text>`
        )
        .join("\n");
    }

    case "arrow":
    case "line": {
      const points = el.points || [];
      if (points.length < 2) return "";
      const dashAttr =
        el.strokeStyle === "dashed"
          ? ' stroke-dasharray="8 4"'
          : el.strokeStyle === "dotted"
          ? ' stroke-dasharray="2 4"'
          : "";

      const pathParts = points.map((pt, i) => {
        const cmd = i === 0 ? "M" : "L";
        return `${cmd}${el.x + pt[0]},${el.y + pt[1]}`;
      });

      let svg = `<path d="${pathParts.join(" ")}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dashAttr}${opacityAttr}/>`;

      // Arrowhead for arrow type
      if (el.type === "arrow" && points.length >= 2) {
        const last = points[points.length - 1];
        const prev = points[points.length - 2];
        const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
        svg += renderArrowHead(el.x + last[0], el.y + last[1], angle, stroke, sw);
      }
      return svg;
    }

    default:
      return "";
  }
}

function toSvg(data, theme) {
  const elements = data.elements || [];
  const bounds = computeBounds(elements);
  const pad = 40;
  const vbX = bounds.minX - pad;
  const vbY = bounds.minY - pad;
  const vbW = bounds.maxX - bounds.minX + pad * 2;
  const vbH = bounds.maxY - bounds.minY + pad * 2;
  const bgColor = theme === "dark" ? "#1e1e1e" : "#ffffff";

  const rendered = elements
    .filter((el) => !el.isDeleted)
    // render rectangles first, then lines/arrows, then text on top
    .sort((a, b) => {
      const order = { rectangle: 0, line: 1, arrow: 1, text: 2 };
      return (order[a.type] ?? 1) - (order[b.type] ?? 1);
    })
    .map((el) => renderElement(el, theme, elements))
    .filter(Boolean)
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}">
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${bgColor}"/>
  ${rendered}
</svg>`;
}

// Process all .excalidraw files
const files = readdirSync(srcDir).filter((f) => f.endsWith(".excalidraw"));

for (const file of files) {
  const name = basename(file, ".excalidraw");
  const data = JSON.parse(readFileSync(join(srcDir, file), "utf-8"));

  const lightSvg = toSvg(data, "light");
  const darkSvg = toSvg(data, "dark");

  writeFileSync(join(svgDir, `${name}-light.svg`), lightSvg);
  writeFileSync(join(svgDir, `${name}-dark.svg`), darkSvg);

  console.log(`  ${name}: light + dark`);
}

console.log(`\nDone. ${files.length * 2} SVGs written to ${svgDir}/`);
