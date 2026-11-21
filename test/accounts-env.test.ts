import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { privateKeyToAccount } from "viem/accounts";

import { accountsGenerate } from "../src/commands/accounts.js";
import {
  generateAccounts,
  mergeAccountEnv,
  readAccountSecrets,
  serializeAccountEnv,
} from "../src/lib/accounts.js";

const NETWORK = {
  aztecNodeUrl: "https://aztec-mainnet.drpc.org",
  ethereumRpcUrl: "https://ethereum-rpc.example",
};

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "fpc-accounts-"));
}

test("mergeAccountEnv keeps existing lines and separates the new block", () => {
  const merged = mergeAccountEnv(
    "ETHEREUM_RPC_URL=https://ethereum-rpc.example\n# keep me\n",
    "ETHEREUM_PRIVATE_KEY=0x11\n",
  );
  assert.equal(
    merged,
    "ETHEREUM_RPC_URL=https://ethereum-rpc.example\n# keep me\n\nETHEREUM_PRIVATE_KEY=0x11\n",
  );
});

test("generated accounts include the uncompressed Ethereum public key", async () => {
  const generated = await generateAccounts();
  const derived = privateKeyToAccount(generated.ethereumPrivateKey);
  assert.equal(generated.ethereumAddress, derived.address);
  assert.equal(generated.ethereumPublicKey, derived.publicKey);
  assert.match(generated.ethereumPublicKey, /^0x04[0-9a-f]{128}$/);

  const env = serializeAccountEnv(generated, NETWORK);
  assert.match(env, new RegExp(`ETHEREUM_ADDRESS=${generated.ethereumAddress}`));
  assert.match(
    env,
    new RegExp(`ETHEREUM_PUBLIC_KEY=${generated.ethereumPublicKey}`),
  );

  const root = tempDir();
  try {
    const envFile = path.join(root, "secrets.env");
    writeFileSync(envFile, env);
    const loaded = await readAccountSecrets(envFile);
    assert.equal(loaded.ethereumPublicKey, generated.ethereumPublicKey);
    assert.equal(loaded.aztecAddress, generated.aztecAddress);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accounts:generate appends to an existing secrets file", async () => {
  const root = tempDir();
  const envFile = path.join(root, ".env.mainnet.6.0.0.local");
  writeFileSync(
    envFile,
    [
      "AZTEC_NODE_URL=https://aztec-mainnet.drpc.org",
      "ETHEREUM_RPC_URL=https://ethereum-rpc.example",
      "# keep me",
      "ETHEREUM_PRIVATE_KEY=",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  const envSnapshot = snapshotEnv();
  delete process.env.ETHEREUM_RPC_URL;
  delete process.env.AZTEC_NODE_URL;

  try {
    const logs: string[] = [];
    const first = await accountsGenerate(["--secrets-file", envFile], {
      log(message) {
        logs.push(message);
      },
    });
    const written = readFileSync(envFile, "utf8");
    assert.equal(first.action, "appended");
    assert.match(written, /# keep me/);
    assert.match(written, /^ETHEREUM_RPC_URL=https:\/\/ethereum-rpc\.example$/m);
    assert.equal(
      written
        .split("\n")
        .filter((line) => line.startsWith("ETHEREUM_RPC_URL=")).length,
      1,
    );
    assert.match(
      written,
      new RegExp(`ETHEREUM_PUBLIC_KEY=${first.ethereumPublicKey}`),
    );
    assert.match(written, new RegExp(`ETHEREUM_ADDRESS=${first.ethereumAddress}`));
    assert.ok(logs.some((line) => line.includes("Appended account secrets")));
    assert.ok(logs.some((line) => line.includes(first.ethereumPublicKey)));

    const second = await accountsGenerate(["--secrets-file", envFile], {
      log() {},
    });
    const loaded = await readAccountSecrets(envFile);
    const appended = readFileSync(envFile, "utf8");
    assert.equal(second.action, "appended");
    assert.equal(loaded.ethereumAddress, second.ethereumAddress);
    assert.equal(loaded.ethereumPublicKey, second.ethereumPublicKey);
    assert.notEqual(first.ethereumAddress, second.ethereumAddress);
    assert.match(appended, new RegExp(`ETHEREUM_ADDRESS=${first.ethereumAddress}`));
    assert.match(
      appended,
      new RegExp(`ETHEREUM_ADDRESS=${second.ethereumAddress}`),
    );
  } finally {
    restoreEnv(envSnapshot);
    rmSync(root, { recursive: true, force: true });
  }
});

test("accounts:generate creates a file and --force replaces it", async () => {
  const root = tempDir();
  const envFile = path.join(root, ".env.mainnet.6.0.0.local");
  const envSnapshot = snapshotEnv();
  process.env.ETHEREUM_RPC_URL = NETWORK.ethereumRpcUrl;
  delete process.env.AZTEC_NODE_URL;

  try {
    const created = await accountsGenerate(["--secrets-file", envFile], {
      log() {},
    });
    assert.equal(created.action, "created");
    const createdText = readFileSync(envFile, "utf8");
    assert.match(
      createdText,
      new RegExp(`ETHEREUM_PUBLIC_KEY=${created.ethereumPublicKey}`),
    );

    writeFileSync(envFile, `${createdText}# keep me\n`);
    const replaced = await accountsGenerate(
      ["--secrets-file", envFile, "--force"],
      { log() {} },
    );
    const replacedText = readFileSync(envFile, "utf8");
    assert.equal(replaced.action, "replaced");
    assert.doesNotMatch(replacedText, /# keep me/);
    assert.match(
      replacedText,
      new RegExp(`ETHEREUM_PUBLIC_KEY=${replaced.ethereumPublicKey}`),
    );
    assert.equal(
      replacedText
        .split("\n")
        .filter((line) => line.startsWith("ETHEREUM_PRIVATE_KEY=")).length,
      1,
    );
  } finally {
    restoreEnv(envSnapshot);
    rmSync(root, { recursive: true, force: true });
  }
});

test("readAccountSecrets rejects a public key from another account", async () => {
  const generated = await generateAccounts();
  const root = tempDir();
  try {
    const envFile = path.join(root, "secrets.env");
    writeFileSync(
      envFile,
      serializeAccountEnv(generated, NETWORK).replace(
        `ETHEREUM_PUBLIC_KEY=${generated.ethereumPublicKey}`,
        `ETHEREUM_PUBLIC_KEY=0x04${"11".repeat(64)}`,
      ),
    );
    await assert.rejects(
      () => readAccountSecrets(envFile),
      /ETHEREUM_PUBLIC_KEY does not match ETHEREUM_PRIVATE_KEY/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function snapshotEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}
