import assert from "node:assert/strict";
import test from "node:test";

import { AztecAddress } from "@aztec/aztec.js/addresses";

import { createOperatorClaimPayload } from "../src/commands/bridge.js";

test("initializerless operator claim is a signed transaction payload", async () => {
  const operator = AztecAddress.fromStringUnsafe(`0x${"01".repeat(32)}`);
  const payload = await createOperatorClaimPayload(operator, {
    amount: "10000000000000000000",
    claimSecret: "1",
    messageLeafIndex: "2",
  });

  assert(payload.feePayer?.equals(operator));
  assert.equal(payload.calls.length, 1);
  assert.equal(payload.calls[0]?.name, "claim_and_end_setup");
  assert(payload.calls[0]?.args[0]?.equals(operator.toField()));
});
