import {
  createNetworkClients,
  DEFAULT_ENV_FILE,
  loadConfig,
  runNetworkPreflight,
} from '../config.js';
import {
  appendSecretsAtomically,
  generateAccounts,
  getAccountBalances,
  readAccountSecrets,
  secretsFileExists,
  serializeAccountEnv,
  serializeAppendedAccount,
  writeSecretsAtomically,
  type AccountBalances,
} from '../lib/accounts.js';
import {
  getStringFlag,
  hasFlag,
  parseArgs,
  rejectUnknownFlags,
} from '../lib/args.js';

export interface CommandOutput {
  log(message: string): void;
}

export interface AccountsGenerateResult {
  envFile: string;
  action: 'created' | 'appended' | 'replaced';
  ethereumAddress: string;
  ethereumPublicKey: string;
  aztecAddress: string;
}

export interface AccountsShowResult {
  ethereumAddress: string;
  ethereumPublicKey: string;
  aztecAddress: string;
  balances: AccountBalances;
}

function assertNoPositionals(positionals: readonly string[]): void {
  if (positionals.length > 0) {
    throw new Error(`Unexpected argument: ${positionals[0]}`);
  }
}

export async function accountsGenerate(
  argv: readonly string[],
  output: CommandOutput = console,
): Promise<AccountsGenerateResult> {
  const args = parseArgs(argv);
  rejectUnknownFlags(args, ['force', 'secrets-file']);
  assertNoPositionals(args.positionals);

  const envFile = getStringFlag(args, 'secrets-file') ?? DEFAULT_ENV_FILE;
  const appConfig = loadConfig({ envFile });
  const generated = await generateAccounts();
  const force = hasFlag(args, 'force');
  const exists = await secretsFileExists(appConfig.envFile);
  const action: AccountsGenerateResult['action'] = exists
    ? force
      ? 'replaced'
      : 'appended'
    : 'created';
  const writtenPath =
    action === 'appended'
      ? await appendSecretsAtomically(
          appConfig.envFile,
          serializeAppendedAccount(generated),
        )
      : await writeSecretsAtomically(
          appConfig.envFile,
          serializeAccountEnv(generated, appConfig),
          { force },
        );
  const result = {
    envFile: writtenPath,
    action,
    ethereumAddress: generated.ethereumAddress,
    ethereumPublicKey: generated.ethereumPublicKey,
    aztecAddress: generated.aztecAddress,
  };

  if (action === 'appended') {
    output.log(`Appended account secrets to ${writtenPath} (mode 0600).`);
    output.log('Commands use the last value of each key in this file.');
  } else if (action === 'replaced') {
    output.log(`Replaced account secrets in ${writtenPath} (mode 0600).`);
  } else {
    output.log(`Wrote account secrets to ${writtenPath} (mode 0600).`);
  }
  output.log(`Ethereum address: ${result.ethereumAddress}`);
  output.log(`Ethereum public key: ${result.ethereumPublicKey}`);
  output.log(`Aztec address: ${result.aztecAddress}`);
  return result;
}

export async function accountsShow(
  argv: readonly string[],
  output: CommandOutput = console,
): Promise<AccountsShowResult> {
  const args = parseArgs(argv);
  rejectUnknownFlags(args, ['secrets-file']);
  assertNoPositionals(args.positionals);

  const envFile = getStringFlag(args, 'secrets-file') ?? DEFAULT_ENV_FILE;
  const appConfig = loadConfig({ envFile });
  const clients = createNetworkClients(appConfig);
  await runNetworkPreflight(clients);
  const accounts = await readAccountSecrets(appConfig.envFile);
  const balances = await getAccountBalances(accounts, clients);
  const result = {
    ethereumAddress: accounts.ethereumAddress,
    ethereumPublicKey: accounts.ethereumPublicKey,
    aztecAddress: accounts.aztecAddress,
    balances,
  };

  output.log(`Ethereum address: ${result.ethereumAddress}`);
  output.log(`Ethereum public key: ${result.ethereumPublicKey}`);
  output.log(`Ethereum balance: ${balances.ethereumEth} ETH`);
  output.log(`Aztec address: ${result.aztecAddress}`);
  output.log(`Fee Juice public balance: ${balances.feeJuiceFormatted}`);
  return result;
}
