import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import sharp from "sharp";
import { buildKhubIconSvg, buildKhubSvg } from "../../src/shared/brand/khubMark.ts";

const root = join(import.meta.dirname, "..", "..");
const asset = (relativePath: string) => join(root, relativePath);

const alphaChannel = async (svg: string, size: number) => {
  const { data } = await sharp(Buffer.from(svg), { density: (72 * size) / 64 })
    .resize(size, size, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = Buffer.alloc(size * size);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = data[pixel * 4 + 3];
  return alpha;
};

const transparentSvg = (size: number) =>
  buildKhubIconSvg(size, { canvasFill: null, markFill: "#FFFFFF", accentFill: "#FFFFFF" });

test("brand generator is deterministic and fails closed on drift", () => {
  const result = spawnSync(
    process.execPath,
    [asset("scripts/build/generate-brand-icons.mjs"), "--check"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
    }
  );
  assert.equal(result.status, 0, `generator --check failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /OK: \d+ KHUB brand assets match the generated output/);
});

test("all manifest and app icons exist at their declared dimensions", async () => {
  const dimensions: Array<[string, number]> = [
    ["public/icon-16.png", 16],
    ["public/icon-32.png", 32],
    ["public/icon-48.png", 48],
    ["public/icon-192.png", 192],
    ["public/icon-512.png", 512],
    ["public/apple-touch-icon.png", 180],
    ["electron/assets/icon.png", 512],
    ["electron/assets/tray-icon.png", 32],
    ["bin/cli/tray/icon.png", 32],
  ];
  for (const [relativePath, size] of dimensions) {
    const metadata = await sharp(readFileSync(asset(relativePath))).metadata();
    assert.equal(metadata.width, size, `${relativePath} width`);
    assert.equal(metadata.height, size, `${relativePath} height`);
  }
});

test("ICO and ICNS containers carry the expected PNG frames", () => {
  const readIcoSizes = (relativePath: string) => {
    const buffer = readFileSync(asset(relativePath));
    assert.equal(buffer.readUInt16LE(0), 0, "ICO reserved word");
    assert.equal(buffer.readUInt16LE(2), 1, "ICO type");
    const count = buffer.readUInt16LE(4);
    return Array.from({ length: count }, (_, index) => {
      const stored = buffer.readUInt8(6 + index * 16);
      return stored === 0 ? 256 : stored;
    });
  };
  assert.deepEqual(readIcoSizes("public/favicon.ico"), [16, 32, 48, 64, 96, 128, 256]);
  assert.deepEqual(readIcoSizes("electron/assets/icon.ico"), [16, 32, 48, 64, 96, 128, 256]);
  assert.deepEqual(readIcoSizes("bin/cli/tray/icon.ico"), [16, 24, 32, 48]);

  const icns = readFileSync(asset("electron/assets/icon.icns"));
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length, "ICNS header must declare the full file length");
});

test("16px is a solid K silhouette; 32px adds the orbit arc and satellite", async () => {
  const sixteen = await alphaChannel(transparentSvg(16), 16);
  const sixteenFullColor = await alphaChannel(buildKhubIconSvg(16, { canvasFill: null }), 16);
  assert.deepEqual(sixteen, sixteenFullColor, "16px must not include the orbit or satellite");
  assert.ok(sixteen.filter((value) => value > 128).length >= 40, "K silhouette must be legible");

  const silhouette32 = await alphaChannel(
    buildKhubSvg("silhouette", {
      canvasFill: null,
      markFill: "#FFFFFF",
      accentFill: "#FFFFFF",
    }),
    32
  );
  const full32 = await alphaChannel(transparentSvg(32), 32);
  const addedPixels = full32.reduce(
    (count, value, index) => count + (value !== silhouette32[index] ? 1 : 0),
    0
  );
  assert.ok(
    addedPixels >= 40,
    `orbit/satellite must be visibly rendered at 32px (got ${addedPixels})`
  );

  const satellitePixel = 10 * 32 + 27;
  assert.ok(full32[satellitePixel] > 200, "satellite must be opaque at 32px");
  assert.equal(
    silhouette32[satellitePixel],
    0,
    "satellite must be absent from the 16px silhouette"
  );
});

test("color and monochrome variants share the same alpha mask", async () => {
  for (const size of [16, 32, 48]) {
    const white = await alphaChannel(
      buildKhubIconSvg(size, {
        canvasFill: null,
        markFill: "#FFFFFF",
        accentFill: "#FFFFFF",
      }),
      size
    );
    const branded = await alphaChannel(
      buildKhubIconSvg(size, {
        canvasFill: null,
        markFill: "#F4F7FA",
        accentFill: "#E8563F",
      }),
      size
    );
    assert.deepEqual(white, branded, `alpha mask must not depend on fill colors at ${size}px`);
  }
});
