import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  buildPreserveRegex,
  collectLeafPaths,
  extractInterpolationTokens,
  findForbiddenTokens,
  findProtectedTokenDrift,
  loadAllowlist,
  planCatalogs,
  serializeCatalog,
  transformCatalog,
} from "../../scripts/i18n/rebrand-display-catalogs.mjs";

const ALLOWLIST_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "i18n",
  "rebrand-display-allowlist.json"
);

type Allowlist = Awaited<ReturnType<typeof loadAllowlist>>;

function collectStrings(
  node: unknown,
  prefix = "",
  out = new Map<string, string>()
): Map<string, string> {
  if (typeof node === "string") {
    out.set(prefix, node);
  } else if (Array.isArray(node)) {
    node.forEach((value, index) => collectStrings(value, `${prefix}[${index}]`, out));
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      collectStrings(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

function preservedSpans(value: string, regex: RegExp): string[] {
  regex.lastIndex = 0;
  return [...value.matchAll(regex)].map((match) => match[0]);
}

function preservedByPath(catalog: unknown, regex: RegExp): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [nodePath, value] of collectStrings(catalog)) {
    result[nodePath] = preservedSpans(value, regex);
  }
  return result;
}

function interpolationByPath(catalog: unknown, allowlist: Allowlist): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [nodePath, value] of collectStrings(catalog)) {
    result[nodePath] = extractInterpolationTokens(value, allowlist);
  }
  return result;
}

function displaySegments(value: string, regex: RegExp): string {
  regex.lastIndex = 0;
  return value.replace(regex, "");
}

const SYNTHETIC = {
  common: {
    title: "OmniRoute Setup",
    offline: "OmniRoute is offline; run omniroute setup with OMNIROUTE_API_KEY",
    wire:
      "Key sk_omniroute; header X-OmniRoute-No-Cache; prefix omniroute:semcache:; " +
      "tool omniroute_get_health; path ~/.omniroute; model omniroute/best",
    placeholders: "Hello {name}, retry in {seconds}s, %s, {{count}}",
    OmniRouteKeyLabel: "OmniRoute API key",
    interim: "Khub interim",
    list: ["OmniRoute one", "omniroute keep"],
    count: 3,
  },
};

describe("khub controlled display-catalog generator", () => {
  it("changes display tokens without touching keys, placeholders, wire tokens or scalars", async () => {
    const allowlist = await loadAllowlist(ALLOWLIST_FILE);
    const preserveRegex = buildPreserveRegex(allowlist);
    const beforePaths = collectLeafPaths(SYNTHETIC);
    const { catalog, changedValues } = transformCatalog(SYNTHETIC, allowlist);
    const after = catalog as typeof SYNTHETIC;

    assert.equal(allowlist.displayBrand, "KHUB");
    assert.ok(allowlist.forbiddenTokens.includes("X-KHUB"));
    assert.deepEqual(collectLeafPaths(after), beforePaths);
    assert.ok(changedValues > 0);
    assert.equal(after.common.title, "KHUB Setup");
    assert.equal(
      after.common.offline,
      "KHUB is offline; run omniroute setup with OMNIROUTE_API_KEY"
    );
    assert.equal(after.common.wire, SYNTHETIC.common.wire);
    assert.equal(after.common.placeholders, SYNTHETIC.common.placeholders);
    assert.equal(after.common.OmniRouteKeyLabel, "KHUB API key");
    assert.equal(after.common.interim, "KHUB interim");
    assert.deepEqual(after.common.list, ["KHUB one", "omniroute keep"]);
    assert.equal(after.common.count, 3);
    assert.deepEqual(
      extractInterpolationTokens(after.common.placeholders, allowlist),
      extractInterpolationTokens(SYNTHETIC.common.placeholders, allowlist)
    );
    assert.deepEqual(
      preservedByPath(after, preserveRegex),
      preservedByPath(SYNTHETIC, preserveRegex)
    );
    for (const value of collectStrings(after).values()) {
      assert.equal(displaySegments(value, preserveRegex).includes("Khub"), false);
    }
    assert.deepEqual(findForbiddenTokens(after, allowlist), []);
    assert.deepEqual(findProtectedTokenDrift(SYNTHETIC, after, allowlist), []);

    const replay = transformCatalog(after, allowlist);
    assert.equal(replay.changedValues, 0);
    assert.deepEqual(replay.catalog, after);
  });

  it("detects rebranded wire tokens as unsafe", async () => {
    const allowlist = await loadAllowlist(ALLOWLIST_FILE);
    const { catalog } = transformCatalog(SYNTHETIC, allowlist);
    const tampered = structuredClone(catalog) as typeof SYNTHETIC;
    tampered.common.wire = tampered.common.wire.replace("sk_omniroute", "sk_khub");

    assert.ok(findForbiddenTokens(tampered, allowlist).some((hit) => hit.includes("sk_khub")));
    assert.ok(
      findProtectedTokenDrift(SYNTHETIC, tampered, allowlist).some((hit) =>
        hit.startsWith("sk_omniroute")
      )
    );
  });

  it("governs exactly 134 catalogs with KHUB display values and byte-identical preserved tokens", async () => {
    const allowlist = await loadAllowlist(ALLOWLIST_FILE);
    const preserveRegex = buildPreserveRegex(allowlist);
    const plans = await planCatalogs(allowlist, ROOT);

    assert.equal(plans.length, 134);
    let khubDisplayValues = 0;
    for (const plan of plans) {
      assert.match(plan.relative, /^(src\/i18n\/messages|bin\/cli\/locales)\/[^/]+\.json$/);

      const headRaw = execFileSync("git", ["show", `HEAD:${plan.relative}`], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
      const head = JSON.parse(headRaw);
      assert.deepEqual(collectLeafPaths(head), collectLeafPaths(plan.after));
      assert.deepEqual(
        preservedByPath(head, preserveRegex),
        preservedByPath(plan.after, preserveRegex)
      );
      assert.deepEqual(
        interpolationByPath(head, allowlist),
        interpolationByPath(plan.after, allowlist)
      );
      assert.deepEqual(plan.forbidden, []);
      assert.deepEqual(plan.drift, []);

      for (const value of collectStrings(plan.after).values()) {
        const display = displaySegments(value, preserveRegex);
        assert.equal(
          display.includes("Khub"),
          false,
          `${plan.relative}: bare Khub in display value`
        );
        if (display.includes("KHUB")) khubDisplayValues += 1;
      }

      const replay = transformCatalog(plan.after, allowlist);
      assert.equal(replay.changedValues, 0);
      assert.equal(serializeCatalog(replay.catalog, allowlist), plan.afterRaw);
    }
    assert.ok(khubDisplayValues > 0, "no KHUB display values found");
  });

  it("runs the non-mutating check mode successfully on the governed catalogs", async () => {
    const allowlist = await loadAllowlist(ALLOWLIST_FILE);
    const before = await planCatalogs(allowlist, ROOT);
    const output = execFileSync(
      "node",
      [path.join(ROOT, "scripts", "i18n", "rebrand-display-catalogs.mjs"), "--check"],
      { cwd: ROOT, encoding: "utf8" }
    );
    const after = await planCatalogs(allowlist, ROOT);

    assert.match(output, /PASS — 134 allowlisted catalogs are current/);
    assert.deepEqual(
      after.map((item) => [item.relative, item.afterRaw]),
      before.map((item) => [item.relative, item.afterRaw])
    );
  });
});
