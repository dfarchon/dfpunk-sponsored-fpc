import {
  createNetworkClients,
  DEFAULT_ENV_FILE,
  loadConfig,
  runNetworkPreflight,
} from '../config.js';
import {
  generateAccounts,
  getAccountBalances,
  readAccountSecrets,
  serializeAccountEnv,
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
  ethereumAddress: string;
  aztecAddress: string;
}

export interface AccountsShowResult {
  ethereumAddress: string;
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
  const writtenPath = await writeSecretsAtomically(
    appConfig.envFile,
    serializeAccountEnv(generated, appConfig),
    { force: hasFlag(args, 'force') },
  );
  const result = {
    envFile: writtenPath,
    ethereumAddress: generated.ethereumAddress,
    aztecAddress: generated.aztecAddress,
  };

  output.log(`Wrote account secrets to ${writtenPath} (mode 0600).`);
  output.log(`Ethereum address: ${result.ethereumAddress}`);
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
    aztecAddress: accounts.aztecAddress,
    balances,
  };

  output.log(`Ethereum address: ${result.ethereumAddress}`);
  output.log(`Ethereum balance: ${balances.ethereumEth} ETH`);
  output.log(`Aztec address: ${result.aztecAddress}`);
  output.log(`Fee Juice public balance: ${balances.feeJuiceFormatted}`);
  return result;
}
