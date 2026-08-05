import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSponsoredFpc,
  parseSalt,
} from "../src/lib/sponsored-fpc.js";

test("custom salt derives a stable universal SponsoredFPC address", async () => {
  const first = await deriveSponsoredFpc(parseSalt("1"));
  const second = await deriveSponsoredFpc(
    parseSalt(
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    ),
  );
  assert.equal(first.address.toString(), second.address.toString());
  assert.equal(
    first.address.toString(),
    "0x05b3ff4b43c662bfca919dbffece74edc750514f22f3f6479188dd176f6ef81c",
  );
});

test("rejects malformed salts", () => {
  assert.throws(() => parseSalt("-1"));
  assert.throws(() => parseSalt("hello"));
  assert.throws(() => parseSalt(`0x${"f".repeat(65)}`));
});
