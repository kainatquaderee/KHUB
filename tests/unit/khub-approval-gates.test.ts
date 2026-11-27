import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  classifyChangedPath,
  collectChangedPaths,
  evaluate,
  loadDeferredPolicy,
  validateApproval,
} from "../../scripts/check/check-khub-protected-paths.mjs";

const POLICY_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "i18n",
  "rebrand-deferred-allowlist.json"
);

describe("khub protected-path approval gate", () => {
  it("carries no approval marker and no current boundary diff", () => {
    const policy = loadDeferredPolicy(POLICY_FILE);
    assert.equal(fs.existsSync(path.join(ROOT, policy.approvalMarker)), false);

    const changed = collectChangedPaths({ root: ROOT });
    const result = evaluate(changed, policy, null);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(
      changed.filter((item) => classifyChangedPath(item, policy)?.category === "deferred-mirror"),
      []
    );

    const directDiff = execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        "HEAD",
        "--",
        "AGENTS.md",
        "CLAUDE.md",
        "GEMINI.md",
        "llm.txt",
        "docs/i18n",
      ],
      { cwd: ROOT, encoding: "utf8" }
    ).trim();
    assert.equal(directDiff, "");
  });

  it("fails on every protected category without an explicit approval", () => {
    const policy = loadDeferredPolicy(POLICY_FILE);
    const samples = [
      "AGENTS.md",
      "docs/i18n/pt/README.md",
      "open-sse/mcp-server/server.ts",
      ".i18n-state.json",
      "skills/example/SKILL.md",
    ];
    const result = evaluate(samples, policy, null);

    assert.deepEqual(
      result.violations.map((item) => item.path),
      samples
    );
    assert.deepEqual(
      result.violations.map((item) => item.category),
      [
        "protected-surface",
        "deferred-mirror",
        "wire-token-file",
        "out-of-scope-generated-mirror",
        "protected-surface",
      ]
    );
  });

  it("ignores concurrent WP-A/WP-B edits outside the boundary", () => {
    const policy = loadDeferredPolicy(POLICY_FILE);
    const unrelated = [
      "src/app/landing/components/KhubHero.tsx",
      "packages/ui-kit/src/theme/khub.css",
      "tests/unit/khub-theme.test.ts",
      "src/i18n/messages/en.json",
      "bin/cli/locales/en.json",
    ];
    const result = evaluate(unrelated, policy, null);

    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.checkedPaths, []);
  });

  it("accepts only exact, explicitly approved paths", () => {
    const policy = loadDeferredPolicy(POLICY_FILE);
    const approval = {
      status: "approved",
      operator: "OWNER",
      reason: "Documented operator approval for one instruction-surface edit",
      approvals: [{ path: "AGENTS.md", reason: "Reviewed instruction update" }],
    };
    const result = evaluate(["AGENTS.md", "CLAUDE.md"], policy, approval);

    assert.deepEqual(result.approvedPaths, ["AGENTS.md"]);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]?.path, "CLAUDE.md");
  });

  it("rejects malformed approval markers", () => {
    assert.throws(
      () =>
        validateApproval({
          status: "draft",
          operator: "OWNER",
          reason: "not approved yet",
          approvals: [{ path: "AGENTS.md", reason: "pending" }],
        }),
      /status=approved/
    );
    assert.throws(
      () => validateApproval({ status: "approved", operator: "OWNER", reason: "r", approvals: [] }),
      /explicit path entries/
    );
    assert.throws(
      () =>
        validateApproval({
          status: "approved",
          operator: "OWNER",
          reason: "r",
          approvals: [{ path: "AGENTS.md" }],
        }),
      /needs a reason/
    );
  });
});
