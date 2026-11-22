/**
 * Provider "attention needed" predicate — the rule behind the dashboard warning.
 *
 * Owner rule: a provider needs attention when it has more routable accounts than
 * the threshold and no more healthy accounts than the threshold. The first half
 * is what exempts small providers permanently: a provider with `total <= threshold`
 * can never alarm, however many of its accounts are limited.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { applyAttentionTransitions, attentionInputsFromConnectionFlags, isProviderAttentionNeeded } =
  await import("../../src/lib/providers/attentionThreshold.ts");

const THRESHOLD = 10;

test("small providers never alarm, even with zero healthy accounts", () => {
  assert.equal(isProviderAttentionNeeded({ total: 3, routable: 3, healthy: 0 }, THRESHOLD), false);
  assert.equal(
    isProviderAttentionNeeded({ total: 10, routable: 10, healthy: 0 }, THRESHOLD),
    false
  );
});

test("a provider over the threshold with too few healthy accounts alarms", () => {
  assert.equal(
    isProviderAttentionNeeded({ total: 11, routable: 11, healthy: 10 }, THRESHOLD),
    true
  );
  assert.equal(isProviderAttentionNeeded({ total: 50, routable: 50, healthy: 0 }, THRESHOLD), true);
});

test("a well-staffed provider over the threshold does not alarm", () => {
  assert.equal(
    isProviderAttentionNeeded({ total: 50, routable: 50, healthy: 40 }, THRESHOLD),
    false
  );
});

test("empty and all-disabled providers are exempt", () => {
  assert.equal(isProviderAttentionNeeded({ total: 0, routable: 0, healthy: 0 }, THRESHOLD), false);
  assert.equal(
    isProviderAttentionNeeded({ total: 100, routable: 0, healthy: 0 }, THRESHOLD),
    false
  );
});

test("the denominator counts routable accounts, not raw total", () => {
  // 95 deliberately disabled accounts are not a capacity shortfall.
  assert.equal(
    isProviderAttentionNeeded({ total: 100, routable: 5, healthy: 5 }, THRESHOLD),
    false
  );
  // ...but 80 disabled with only 8 healthy out of 20 routable is a real shortfall.
  assert.equal(
    isProviderAttentionNeeded({ total: 100, routable: 20, healthy: 8 }, THRESHOLD),
    true
  );
});

test("threshold 0 means 'no healthy accounts'", () => {
  assert.equal(isProviderAttentionNeeded({ total: 5, routable: 5, healthy: 0 }, 0), true);
  assert.equal(isProviderAttentionNeeded({ total: 5, routable: 5, healthy: 5 }, 0), false);
});

test("connection flags produce total/routable/healthy counts", () => {
  const inputs = attentionInputsFromConnectionFlags(
    [{ isActive: true }, { isActive: false }, { isActive: undefined }, {}],
    2
  );
  assert.deepEqual(inputs, { total: 4, routable: 3, healthy: 2 });
});

test("only the first crossing toasts; recovery re-arms", () => {
  const first = applyAttentionTransitions({}, { a: true, b: false });
  assert.deepEqual(first.toasts, ["a"]);
  assert.deepEqual(first.next, { a: "alert", b: "ok" });

  const steady = applyAttentionTransitions(first.next, { a: true, b: false });
  assert.deepEqual(steady.toasts, []);

  const recovered = applyAttentionTransitions(steady.next, { a: false, b: false });
  assert.deepEqual(recovered.toasts, []);

  const droppedAgain = applyAttentionTransitions(recovered.next, { a: true, b: false });
  assert.deepEqual(droppedAgain.toasts, ["a"]);
});

test("transitions prune providers that disappeared", () => {
  const result = applyAttentionTransitions({ gone: "alert", a: "ok" }, { a: false });
  assert.deepEqual(result.toasts, []);
  assert.deepEqual(result.next, { a: "ok" });
});
