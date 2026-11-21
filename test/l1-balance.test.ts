import assert from "node:assert/strict";
import test from "node:test";

import { getAddress } from "viem";

import { l1BalanceCommand } from "../src/commands/ops.js";
import { parseEthereumAddress } from "../src/lib/bridge.js";

test("parseEthereumAddress accepts and checksums an L1 address", () => {
  const address = "0x0000000000000000000000000000000000000001";
  assert.equal(parseEthereumAddress(address), getAddress(address));
});

test("l1:balance rejects an invalid Ethereum address before using the network", async () => {
  await assert.rejects(
    () => l1BalanceCommand(["--address", "not-an-address"]),
    /--address must be an Ethereum address/,
  );
});

test("l1:balance rejects unknown options", async () => {
  await assert.rejects(
    () => l1BalanceCommand(["--amount", "1"]),
    /Unknown option: --amount/,
  );
});
