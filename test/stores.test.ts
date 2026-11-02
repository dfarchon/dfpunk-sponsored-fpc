import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  actionableFpcClaims,
  fpcIdsPath,
  isActionableClaim,
  listClaims,
  listRecordedFpcIds,
  loadClaim,
  saveClaim,
  sumClaimedAmount,
  updateClaim,
  type ClaimRecord,
} from "../src/lib/claim-store.js";
import {
  loadDeployment,
  saveDeployment,
  type DeploymentManifest,
} from "../src/lib/deployment-store.js";

test("only deposited and ready claims are actionable", () => {
  const claim = {
    id: "operator-one",
    kind: "operator",
    recipient: "0xabc",
    amount: "10",
    claimSecret: "1",
    messageLeafIndex: "2",
    messageHash: "0x1234",
    status: "deposited",
    depositedAt: "2026-01-01T00:00:00.000Z",
  } satisfies ClaimRecord;

  assert.equal(isActionableClaim(claim), true);
  assert.equal(isActionableClaim({ ...claim, status: "ready" }), true);
  assert.equal(isActionableClaim({ ...claim, status: "claimed" }), false);
  assert.equal(isActionableClaim({ ...claim, status: "failed" }), false);
});

test("claim store preserves multiple top ups and status", () => {
  const root = mkdtempSync(path.join(tmpdir(), "fpc-claims-"));
  try {
    const base: ClaimRecord = {
      id: "fpc-one",
      kind: "fpc",
      recipient: "0xabc",
      amount: "10",
      claimSecret: "1",
      messageLeafIndex: "2",
      messageHash: "0x1234",
      status: "deposited",
      depositedAt: "2026-01-01T00:00:00.000Z",
    };
    saveClaim(base, root);
    saveClaim(
      {
        ...base,
        id: "fpc-two",
        amount: "20",
        messageHash: "0x5678",
        depositedAt: "2026-01-02T00:00:00.000Z",
      },
      root,
    );
    updateClaim("fpc-one", { status: "claimed" }, root);

    saveClaim(
      {
        ...base,
        id: "operator-one",
        kind: "operator",
        amount: "5",
        messageHash: "0x9abc",
        depositedAt: "2026-01-03T00:00:00.000Z",
      },
      root,
    );

    assert.equal(loadClaim("fpc-one", root).status, "claimed");
    assert.equal(listClaims(root).length, 3);
    assert.equal(sumClaimedAmount("0xAbC", root), 10n);
    assert.deepEqual(listRecordedFpcIds(root), ["fpc-one", "fpc-two"]);
    assert.deepEqual(
      actionableFpcClaims(root).map((claim) => claim.id),
      ["fpc-two"],
    );
    assert.equal(
      readFileSync(fpcIdsPath(root), "utf8"),
      "fpc-one\nfpc-two\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deployment manifest round trips", () => {
  const root = mkdtempSync(path.join(tmpdir(), "fpc-deployment-"));
  try {
    const manifest: DeploymentManifest = {
      network: "mainnet",
      l1ChainId: 1,
      aztecVersion: "5.0.1",
      salt: "0x01",
      address: "0x02",
      contractClassId: "0x03",
      classRegistered: false,
      publiclyDeployed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    saveDeployment(manifest, root);
    assert.deepEqual(loadDeployment(root), manifest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
