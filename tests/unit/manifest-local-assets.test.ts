import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import manifest from "../../src/app/manifest.ts";

const root = join(import.meta.dirname, "..", "..");
const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(join(root, relativePath), "utf8")) as Record<string, unknown>;

test("web manifest is KHUB-branded and references only local generated icons", async () => {
  const webManifest = manifest();
  assert.match(webManifest.name ?? "", /KHUB/);
  assert.equal(webManifest.short_name, "KHUB");
  assert.match(webManifest.description ?? "", /KHUB/);
  assert.doesNotMatch(JSON.stringify(webManifest), /OmniRoute AI 网关|https?:\/\//);

  const expectedSizes: Record<string, [number, number] | undefined> = {
    "/icon-192.png": [192, 192],
    "/icon-512.png": [512, 512],
    "/apple-touch-icon.png": [180, 180],
  };
  assert.ok(webManifest.icons?.length);
  for (const icon of webManifest.icons ?? []) {
    assert.ok(icon.src.startsWith("/"), `remote icon: ${icon.src}`);
    const localPath = join(root, "public", icon.src);
    assert.ok(existsSync(localPath), `missing local icon: ${icon.src}`);
    const expected = expectedSizes[icon.src];
    if (expected) {
      const metadata = await sharp(readFileSync(localPath)).metadata();
      assert.deepEqual([metadata.width, metadata.height], expected, icon.src);
    }
  }
});

test("layout metadata is KHUB-branded and all default icons are generated", () => {
  const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
  // instanceName defaults to "KHUB"; the title template must not repeat the
  // brand, or the default reads "KHUB — KHUB AI Gateway...".
  assert.match(layout, /\$\{instanceName\} — AI Gateway for Multi-Provider LLMs/);
  assert.match(layout, /KHUB is an AI gateway for multi-provider LLMs/);
  const iconUrls = [...layout.matchAll(/url:\s*"(\/[^"]+)"/g)].map((match) => match[1]);
  for (const url of iconUrls) {
    assert.ok(url.startsWith("/"), `remote layout icon: ${url}`);
    if (url === "/api/settings/favicon") continue; // operator-supplied white-label override
    assert.ok(existsSync(join(root, "public", url)), `missing local layout icon: ${url}`);
  }
  assert.ok(iconUrls.includes("/icon-192.png"));
  assert.ok(iconUrls.includes("/favicon.svg"));
  assert.ok(iconUrls.includes("/apple-touch-icon.png"));
});

test("package and CLI display labels say KHUB while compatibility identifiers stay frozen", () => {
  const pkg = readJson("package.json");
  assert.match(String(pkg.description), /^KHUB —/);
  const bin = pkg.bin as Record<string, string>;
  assert.equal(bin.khub, "bin/omniroute.mjs");
  assert.equal(bin.omniroute, "bin/omniroute.mjs", "legacy omniroute shim must remain");
  assert.equal(pkg.name, "omniroute", "npm package identity is a wire compatibility contract");

  const program = readFileSync(join(root, "bin/cli/program.mjs"), "utf8");
  assert.match(program, /\.name\("khub"\)/);
  assert.match(program, /KHUB — smart AI router/);
  assert.match(program, /compatibility alias/);
});

test("desktop product name is KHUB but appId is unchanged", () => {
  const electronPackage = readJson("electron/package.json") as {
    build: { appId: string; productName: string };
  };
  assert.equal(electronPackage.build.productName, "KHUB");
  assert.equal(electronPackage.build.appId, "online.omniroute.desktop");
});
