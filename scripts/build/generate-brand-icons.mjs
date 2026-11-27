#!/usr/bin/env node
/**
 * Deterministic KHUB brand asset generator.
 *
 * All artwork comes from src/shared/brand/khubMark.ts; every SVG is validated
 * against the path-only allowlist before anything is written. Rasters are
 * rendered from the SVG source with sharp (already a project dependency), and
 * ICO/ICNS containers are assembled here so no icon tooling is required.
 *
 * Usage:
 *   node scripts/build/generate-brand-icons.mjs          # write all assets
 *   node scripts/build/generate-brand-icons.mjs --check  # verify byte-for-byte, no writes
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeKhubSvg,
  buildKhubIconSvg,
  buildKhubSvg,
  KHUB_ACCENT_FILL,
  KHUB_CANVAS_FILL,
  KHUB_MARK_FILL,
  KHUB_MONO_FILL,
} from "../../src/shared/brand/khubMark.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const checkOnly = process.argv.includes("--check");

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("sharp is required to generate KHUB icons; install the project dependencies.");
  process.exit(1);
}

const outputs = [];
const addSvg = (relativePath, svg) => {
  assertSafeKhubSvg(svg, relativePath);
  outputs.push({ relativePath, buffer: Buffer.from(svg, "utf8") });
  return svg;
};

const renderPng = async (svg, size) => {
  const buffer = await sharp(Buffer.from(svg), { density: (72 * size) / 64 })
    .resize(size, size, { fit: "fill" })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
  const metadata = await sharp(buffer).metadata();
  if (metadata.width !== size || metadata.height !== size) {
    throw new Error(
      `rendered PNG is ${metadata.width}x${metadata.height}, expected ${size}x${size}`
    );
  }
  return buffer;
};

const addPng = async (relativePath, svg, size) => {
  outputs.push({ relativePath, buffer: await renderPng(svg, size) });
};

/** ICO container with PNG-compressed frames (width byte 0 means 256). */
const buildIco = (frames) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  let offset = 6 + 16 * frames.length;
  const entries = frames.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.png)]);
};

/** ICNS container with PNG frames; macOS accepts these entries directly. */
const buildIcns = (frames) => {
  const entries = frames.map(({ type, png }) => {
    const entry = Buffer.alloc(8);
    entry.write(type, 0, 4, "ascii");
    entry.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([entry, png]);
  });
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(8 + entries.reduce((sum, entry) => sum + entry.length, 0), 4);
  return Buffer.concat([header, ...entries]);
};

const iconSvg = (size, options = {}) =>
  buildKhubIconSvg(size, {
    canvasFill: KHUB_CANVAS_FILL,
    markFill: KHUB_MARK_FILL,
    accentFill: KHUB_ACCENT_FILL,
    ...options,
  });

const traySvg = (size) =>
  buildKhubIconSvg(size, {
    canvasFill: null,
    markFill: KHUB_MONO_FILL,
    accentFill: KHUB_MONO_FILL,
  });

// On-disk SVG sources of truth. The 16px sources deliberately use the
// silhouette-only variant; the legacy SVG names are regenerated so no old
// gradient artwork survives anywhere in the icon set.
addSvg("public/favicon.svg", iconSvg(32));
addSvg("public/icon-192.svg", iconSvg(192));
addSvg("public/apple-touch-icon.svg", iconSvg(180));

// Original abstract companions (no third-party marks, no copied artwork).
addSvg(
  "public/brand/creative/khub-orbit-gate.svg",
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
    `<path fill="${KHUB_CANVAS_FILL}" d="M14 0 H50 A14 14 0 0 1 64 14 V50 A14 14 0 0 1 50 64 H14 A14 14 0 0 1 0 50 V14 A14 14 0 0 1 14 0 Z"/>` +
    `<path fill="none" stroke="${KHUB_ACCENT_FILL}" stroke-width="3" d="M8 32 A24 24 0 1 1 56 32"/>` +
    `<path fill="${KHUB_MARK_FILL}" d="M25 18 H39 V46 H25 Z M18 29 H46 V35 H18 Z"/>` +
    "</svg>"
);
addSvg(
  "public/brand/parody/khub-latency-comet.svg",
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
    `<path fill="${KHUB_CANVAS_FILL}" d="M14 0 H50 A14 14 0 0 1 64 14 V50 A14 14 0 0 1 50 64 H14 A14 14 0 0 1 0 50 V14 A14 14 0 0 1 14 0 Z"/>` +
    `<path fill="${KHUB_ACCENT_FILL}" d="M12 48 C20 30 34 18 52 12 L56 20 C40 26 28 36 22 52 Z"/>` +
    `<path fill="${KHUB_MARK_FILL}" d="M44 8 A8 8 0 1 0 44 24 A8 8 0 1 0 44 8 Z"/>` +
    "</svg>"
);

// Standalone PNG icons. Every raster is generated from the same SVG source.
await addPng("public/icon-16.png", iconSvg(16), 16);
await addPng("public/icon-32.png", iconSvg(32), 32);
await addPng("public/icon-48.png", iconSvg(48), 48);
await addPng("public/icon-192.png", iconSvg(192), 192);
await addPng("public/icon-512.png", iconSvg(512), 512);
await addPng("public/apple-touch-icon.png", iconSvg(180), 180);
await addPng("electron/assets/icon.png", iconSvg(512), 512);
await addPng("electron/assets/tray-icon.png", traySvg(32), 32);
await addPng("bin/cli/tray/icon.png", traySvg(32), 32);

const faviconSizes = [16, 32, 48, 64, 96, 128, 256];
const faviconFrames = [];
for (const size of faviconSizes) {
  faviconFrames.push({ size, png: await renderPng(iconSvg(size), size) });
}
outputs.push({ relativePath: "public/favicon.ico", buffer: buildIco(faviconFrames) });
outputs.push({
  relativePath: "electron/assets/icon.ico",
  buffer: buildIco(faviconFrames),
});

const traySizes = [16, 24, 32, 48];
outputs.push({
  relativePath: "bin/cli/tray/icon.ico",
  buffer: buildIco(
    await Promise.all(
      traySizes.map(async (size) => ({ size, png: await renderPng(traySvg(size), size) }))
    )
  ),
});

const icnsTypes = [
  [32, "ic11"],
  [64, "ic12"],
  [128, "ic07"],
  [256, "ic08"],
  [512, "ic09"],
];
const icnsFrames = [];
for (const [size, type] of icnsTypes) {
  icnsFrames.push({ type, png: await renderPng(iconSvg(size), size) });
}
outputs.push({ relativePath: "electron/assets/icon.icns", buffer: buildIcns(icnsFrames) });

if (checkOnly) {
  const mismatches = [];
  for (const { relativePath, buffer } of outputs) {
    let current;
    try {
      current = readFileSync(join(root, relativePath));
    } catch {
      mismatches.push(`${relativePath}: missing`);
      continue;
    }
    if (!current.equals(buffer)) {
      mismatches.push(
        `${relativePath}: differs (on disk ${current.length} bytes, generated ${buffer.length} bytes)`
      );
    }
  }
  if (mismatches.length > 0) {
    console.error(
      `KHUB icon check failed for ${mismatches.length} asset(s):\n${mismatches.join("\n")}`
    );
    process.exit(1);
  }
  console.log(`OK: ${outputs.length} KHUB brand assets match the generated output`);
} else {
  for (const { relativePath, buffer } of outputs) {
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, buffer);
  }
  console.log(`Generated ${outputs.length} KHUB brand assets from src/shared/brand/khubMark.ts`);
}
