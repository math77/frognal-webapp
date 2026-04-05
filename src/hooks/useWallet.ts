'use client';

/**
 * useWallet.ts
 * Thin wrapper around wagmi hooks.
 * Returns connection state + $FROGNAL balance + eligibility flag.
 */

import { useAccount, useReadContract, useDisconnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { FROGNAL_TOKEN_ADDRESS, FROGNAL_THRESHOLD } from '@/lib/customFrog';

const ERC20_BALANCE_OF_ABI = [
  {
    name:             'balanceOf',
    type:             'function',
    stateMutability:  'view',
    inputs:           [{ name: 'account', type: 'address' }],
    outputs:          [{ name: '',        type: 'uint256' }],
  },
] as const;

export interface WalletState {
  /** Connected wallet address, or undefined */
  address:          `0x${string}` | undefined;
  /** True when the wallet is connected */
  isConnected:      boolean;
  /** Raw $FROGNAL balance in wei, or 0n if not connected / loading */
  frognalBalance:   bigint;
  /** Human-readable balance, e.g. "52,000" */
  formattedBalance: string;
  /** True when balance ≥ 50 000 $FROGNAL */
  isEligible:       boolean;
  /** Opens RainbowKit connect modal */
  openConnect:      () => void;
  /** Disconnects the wallet */
  disconnect:       () => void;
}

export function useWallet(): WalletState {
  const { address, isConnected } = useAccount();
  const { openConnectModal }     = useConnectModal();
  const { disconnect }           = useDisconnect();

  const { data: rawBalance } = useReadContract({
    address:      FROGNAL_TOKEN_ADDRESS,
    abi:          ERC20_BALANCE_OF_ABI,
    functionName: 'balanceOf',
    args:         address ? [address] : undefined,
    query:        { enabled: !!address },
  });

  const frognalBalance   = (rawBalance as bigint | undefined) ?? 0n;
  const isEligible       = frognalBalance >= FROGNAL_THRESHOLD;

  // Readable: divide by 1e18, format with commas, no decimals
  const formattedBalance = frognalBalance === 0n
    ? '0'
    : Number(frognalBalance / 10n ** 15n / 1000n)
        .toLocaleString(undefined, { maximumFractionDigits: 0 });

  return {
    address,
    isConnected,
    frognalBalance,
    formattedBalance,
    isEligible,
    openConnect: openConnectModal ?? (() => {}),
    disconnect:  () => disconnect(),
  };
}
