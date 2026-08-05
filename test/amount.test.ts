import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAmount,
  parsePositiveAmount,
  topUpAmount,
} from "../src/lib/amount.js";

test("parses and formats Fee Juice amounts", () => {
  const amount = parsePositiveAmount("12.5", 18);
  assert.equal(amount, 12_500_000_000_000_000_000n);
  assert.equal(formatAmount(amount, 18), "12.5");
});

test("rejects invalid and zero amounts", () => {
  assert.throws(() => parsePositiveAmount("0"));
  assert.throws(() => parsePositiveAmount("-1"));
  assert.throws(() => parsePositiveAmount("1e18"));
});

test("computes target-balance top ups", () => {
  assert.equal(topUpAmount(4n, 10n), 6n);
  assert.equal(topUpAmount(10n, 10n), 0n);
  assert.equal(topUpAmount(12n, 10n), 0n);
});
