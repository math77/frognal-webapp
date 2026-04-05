'use client';

/**
 * providers.tsx
 * Wraps the app with RainbowKit, wagmi (Base chain), and React Query.
 * Keep this a client component; layout.tsx stays a server component.
 *
 * Required env var: NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
 * Get one free at: https://cloud.walletconnect.com
 */

import { RainbowKitProvider, getDefaultConfig, darkTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { base } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import '@rainbow-me/rainbowkit/styles.css';

const wagmiConfig = getDefaultConfig({
  appName:   'Frognal',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '',
  chains:    [base],
  ssr:       true,
});

export function Providers({ children }: { children: ReactNode }) {
  // QueryClient must be stable per render — useState prevents server/client mismatch
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor:          '#39ff14',
            accentColorForeground: '#060a06',
            borderRadius:          'medium',
            fontStack:             'system',
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
