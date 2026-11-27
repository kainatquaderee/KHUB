import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Frozen wire snapshot. These are protocol literals, never credential values: no .env,
// database, account file or runtime secret is read by this test.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Family {
  id: string;
  pattern: string;
  anchors: string[];
  expected: string[];
}

const FAMILIES: Family[] = [
  {
    id: "X-OmniRoute-* headers",
    pattern: "X-OmniRoute-[A-Za-z-]+",
    anchors: [
      "src/sse/services/leaseContext.ts",
      "src/sse/handlers/chatHelpers.ts",
      "src/lib/api/modelTestRunner.ts",
    ],
    expected: [
      "X-OmniRoute-Compression",
      "X-OmniRoute-Connection",
      "X-OmniRoute-Lease-Generation",
      "X-OmniRoute-Lease-Owner",
      "X-OmniRoute-No-Cache",
      "X-OmniRoute-Session-Id",
    ],
  },
  {
    id: "x-omniroute-* CORS header",
    pattern: "x-omniroute-[a-z-]+",
    anchors: ["src/server/cors/origins.ts"],
    expected: ["x-omniroute-connection"],
  },
  {
    id: "sk_omniroute default key marker",
    pattern: "sk_omniroute",
    anchors: [
      "src/app/api/cli-tools/qwen-settings/route.ts",
      "src/lib/cliTools/checkToolConfigStatus.ts",
    ],
    expected: ["sk_omniroute"],
  },
  {
    id: "omniroute/* model prefixes",
    pattern: "(?<!@)omniroute\\/[A-Za-z0-9._-]*",
    anchors: ["config/cli-tools-manifest.json", "src/lib/usage/internalUsageCommand.ts"],
    expected: ["omniroute/", "omniroute/local-usage"],
  },
  {
    id: "omniroute: Redis/cache prefixes",
    pattern: "omniroute:[A-Za-z0-9:_-]+",
    anchors: [
      "src/types/databaseSettings.ts",
      "src/lib/quota/redisQuotaStore.ts",
      "src/lib/warmupScheduler/redisCircuitBreakerStore.ts",
      "src/lib/proxyLogger.ts",
    ],
    expected: ["omniroute:proxy_logs", "omniroute:quota:", "omniroute:semcache:"],
  },
  {
    id: "~/.omniroute data directory",
    pattern: "~\\/\\.omniroute",
    anchors: ["bin/cli/commands/env.mjs"],
    expected: ["~/.omniroute"],
  },
  {
    id: "omniroute_* MCP tools",
    pattern: "omniroute_[a-z_]+",
    anchors: ["open-sse/mcp-server/tools/opsTools.ts"],
    expected: [
      "omniroute_check_quota",
      "omniroute_create_combo",
      "omniroute_get_combo_metrics",
      "omniroute_get_health",
      "omniroute_list_combos",
      "omniroute_switch_combo",
    ],
  },
  {
    id: "MCP server id",
    pattern: 'name: "omniroute",',
    anchors: ["open-sse/mcp-server/server.ts"],
    expected: ['name: "omniroute",'],
  },
];

function observedTokens(family: Family): string[] {
  const tokens = new Set<string>();
  const regex = new RegExp(family.pattern, "g");
  for (const anchor of family.anchors) {
    const source = fs.readFileSync(path.join(ROOT, anchor), "utf8");
    for (const match of source.matchAll(regex)) tokens.add(match[0]);
  }
  return [...tokens].sort();
}

describe("khub frozen wire contracts", () => {
  it("matches the exact token snapshot for every frozen family (zero differences)", () => {
    for (const family of FAMILIES) {
      assert.deepEqual(observedTokens(family), [...family.expected].sort(), family.id);
    }
  });

  it("keeps the MCP server id at the frozen source line", () => {
    const lines = fs
      .readFileSync(path.join(ROOT, "open-sse/mcp-server/server.ts"), "utf8")
      .split("\n");
    assert.equal(lines[251]?.trim(), 'name: "omniroute",');
  });

  it("keeps the legacy omniroute CLI bin contract", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      bin: Record<string, string>;
    };
    assert.equal(pkg.bin.omniroute, "bin/omniroute.mjs");
    assert.equal(pkg.bin["omniroute-reset-password"], "bin/reset-password.mjs");
  });

  it("has zero working-tree diffs in the frozen wire-token anchors", () => {
    const anchors = [...new Set(FAMILIES.flatMap((family) => family.anchors))];
    const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--", ...anchors], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    assert.equal(changed, "");
  });
});
