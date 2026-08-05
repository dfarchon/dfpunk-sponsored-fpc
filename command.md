pnpm mainnet:setup \
 --salt 0x17e2ffa9e5c30f5e5e717e83d061a0f27ca5fc1dfce074ccfb41a9196f7121b5 \
 --operator-amount 10 \
 --target-balance 100

pnpm mainnet:setup \
 --salt 0x17e2ffa9e5c30f5e5e717e83d061a0f27ca5fc1dfce074ccfb41a9196f7121b5 \
 --operator-amount 10 \
 --target-balance 100 \
 --wait \
 --timeout-minutes 120 \
 --poll-seconds 15 \
 --execute \
 --confirm-mainnet
