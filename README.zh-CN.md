# Aztec 6.0.0 Mainnet Sponsored FPC

面向运维的 TypeScript CLI：在 Alpha（以太坊主网）上派生并实验性发布 Aztec 内置的 `SponsoredFPC`，桥接真实 Fee Juice、将其 claim 到 FPC，并测试赞助式手续费支付。

所有 Aztec 依赖固定为 `6.0.0`。交易类命令默认 dry-run；只有同时提供 `--execute` 与 `--confirm-mainnet` 才会真正上链。

## 重要限制

Aztec 文档将内置 `SponsoredFPC` 限定为 testnet / devnet / 本地使用。本项目按需求实现了主网发布路径，但不会掩盖该限制。`verify` 会执行关键的 Alpha 模拟；若网络拒绝该 FPC，会报告 public setup allowlist 拒绝。仅发布并给地址打款，并不能证明它能作为 fee payer 使用。

在小额余额下 `verify` 成功之前，切勿桥接大额资金。

## 环境要求

- Node.js 24+
- pnpm
- Aztec node 版本 `6.0.0`
- 以太坊主网 RPC
- L1 ETH（用于 approve / deposit 的 gas）
- L1 Fee Juice（`$AZTEC`，用于桥接）

安装：

```bash
pnpm install
cp .env.example .env.mainnet.6.0.0.local
```

在 `.env.mainnet.6.0.0.local` 中设置 `ETHEREUM_RPC_URL`。Aztec RPC 默认值为 `https://aztec-mainnet.drpc.org`。

## 生成以太坊与 Aztec 账户

```bash
pnpm accounts:generate
pnpm accounts:show
```

会创建：

- 以太坊私钥与 EOA 地址
- Aztec Schnorr 无 initializer 账户的 secret / signing key / salt / address

密钥会以原子写方式写入 `.env.mainnet.6.0.0.local`，文件权限为 `0600`。除非提供 `--force`，否则不会覆盖已有密钥。私钥永远不会打印到终端。

任意命令都可用 `--secrets-file <path>` 指定其它密钥文件。

## 预检（Preflight）

```bash
pnpm preflight
```

预检要求：

- 以太坊 chain ID 为 `1`
- Aztec L1 chain ID 为 `1`
- Aztec node 版本为 `6.0.0`（SponsoredFPC artifact 固定为 `6.0.0`）
- 节点返回非零的 Fee Juice 与 portal 地址

## 派生并发布自定义 salt 的 SponsoredFPC

派生为离线操作：

```bash
pnpm fpc:derive --salt 1
pnpm fpc:derive --salt 0x1234
pnpm fpc:derive --salt random
```

Dry-run 发布：

```bash
pnpm fpc:deploy --salt 0x1234
```

使用已注资的 Aztec operator 发布合约 class 与 universal instance：

```bash
pnpm fpc:deploy --salt 0x1234 --execute --confirm-mainnet
```

幂等部署清单保存在 `deployments/mainnet-6.0.0.json`，记录 salt、确定性地址、class ID、artifact SHA-256、交易哈希、版本与发布状态。

## 引导 Aztec operator

Operator 需要 Fee Juice 才能发布 FPC，以及后续为打入 FPC 的存款执行 claim。先给 operator 桥接一小笔：

```bash
pnpm operator:bridge --amount 10
pnpm operator:bridge --amount 10 --execute --confirm-mainnet
```

L1→L2 消息被纳入后：

```bash
pnpm status
pnpm claim --id operator-... --execute --confirm-mainnet
```

Operator 的 claim 使用 `FeeJuicePaymentMethodWithClaim`。无 initializer
账户在本地注册后即可使用，无需部署；其首笔签名交易会同时 claim Fee
Juice 并用它支付交易费用。

## 为 SponsoredFPC 注资或追加

查询当前公开 Fee Juice 余额（默认读取部署清单中的 FPC 地址）：

```bash
pnpm fpc:balance
pnpm fpc:balance --address <aztec-address>
```

桥接精确的追加金额：

```bash
pnpm fpc:topup --amount 100
pnpm fpc:topup --amount 100 --execute --confirm-mainnet
```

仅按目标 L2 余额差额追加：

```bash
pnpm fpc:topup --target-balance 1000
pnpm fpc:topup --target-balance 1000 --execute --confirm-mainnet
```

默认 FPC 地址来自 `deployments/mainnet-6.0.0.json`，也可通过 `--address <aztec-address>` 或 `--salt <field>` 指定。每次 top-up 都会在 `claims/mainnet-6.0.0` 下新建一条权限为 `0600` 的 claim 记录；重复 top-up 不会覆盖以往的 claim secret。

查看状态并 claim：

```bash
pnpm status
pnpm status --id fpc-...
pnpm claim --wait --timeout-minutes 120 --poll-seconds 15 \
  --execute --confirm-mainnet
pnpm claim --id fpc-... --execute --confirm-mainnet
pnpm claim --all-ready --execute --confirm-mainnet
```

FPC claim id 会写入 `claims/mainnet-6.0.0/fpc-ids.txt`。`pnpm claim` 不带 `--id` 时会自动 claim 尚未完成的 FPC 记录。`--all-ready` 还会包含 operator bootstrap claim。

FPC 的 claim 由已注资的 operator 发起，并调用规范合约 `FeeJuice.claim(fpcAddress, amount, secret, leafIndex)`。

## 验证赞助（Verify）

```bash
pnpm verify
pnpm verify --execute --confirm-mainnet
```

验证内容：

1. 清单中的 salt 能重新派生出已记录地址；
2. class 与 public instance 已存在于 Alpha；
3. FPC 持有 Fee Juice；
4. 空应用交易可在 `SponsoredFeePaymentMethod` 下成功模拟；
5. 若带 `--execute`，则广播最小赞助探测交易。

## 幂等一键编排（Setup）

`setup` 每次只推进一个安全阶段，可在 L1 消息纳入后重复执行：

```bash
pnpm mainnet:setup \
  --salt 0x1234 \
  --operator-amount 10 \
  --fpc-amount 100
```

真正执行：

```bash
pnpm mainnet:setup \
  --salt 0x1234 \
  --operator-amount 10 \
  --fpc-amount 100 \
  --wait \
  --execute --confirm-mainnet
```

阶段顺序：

`preflight → operator bridge/claim → FPC publish → FPC bridge/claim → verify`

若 claim 仍在等待中，命令不会重复创建存款；纳入后再重新运行即可。可用 `--target-balance` 替代 `--fpc-amount`。

## Agent 操作手册

当被要求部署时：

1. 运行 `pnpm preflight`。
2. 运行 `pnpm accounts:show`；若尚无密钥，运行 `pnpm accounts:generate`，并请操作员仅为打印出的 L1 地址注资。
3. 用请求的 salt 与金额 dry-run `pnpm mainnet:setup`。
4. 任何真实交易前，展示收款方、金额与当前余额。
5. 仅在用户明确授权后，使用 `--execute --confirm-mainnet` 执行。
6. 在消息纳入后重复运行 setup，直至状态为 `complete`。

当被要求追加资金时：

1. 不要重新部署 FPC。
2. 运行 `pnpm fpc:topup --amount X` 或 `pnpm fpc:topup --target-balance X`。
3. 确认后追加 `--execute --confirm-mainnet`。
4. 运行 `pnpm claim --wait --execute --confirm-mainnet`。
5. 报告新的 FPC 余额，以及本地累计已 claim 金额。

## 开发检查

```bash
pnpm typecheck
pnpm test
ETHEREUM_RPC_URL=https://your-mainnet-rpc pnpm test:alpha
```
