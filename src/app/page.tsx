'use client';

import dynamic from 'next/dynamic';

/**
 * FrogChat uses MediaPipe LlmInference which is browser-only (WebGPU).
 * Dynamic import with ssr: false prevents Next.js from trying to run it server-side.
 */
const FrogChat = dynamic(() => import('@/components/FrogChat'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#060a06',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Press Start 2P', monospace",
        color: '#39ff14',
        fontSize: 14,
        letterSpacing: '0.1em',
      }}
    >
      LOADING...
    </div>
  ),
});

export default function Home() {
  return <FrogChat />;
}