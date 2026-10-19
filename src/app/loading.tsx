'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { SericLoader } from '@/components/ui/SericLoader';

/**
 * GLOBAL LOADING STATE
 *
 * Replaces Next.js's browser dev-overlay fallback ("Rendering…") with a
 * branded Seric loader. The optional `delay` gives real network requests
 * time to settle so a fleeting loading frame doesn't flash on fast
 * connections.
 */

const BLUR: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  backgroundColor: 'rgba(15, 23, 42, 0.85)',
};

const WRAP: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

export default function RootLoading({ delay = 120 }: { delay?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(id);
  }, [delay]);

  return (
    <div style={BLUR} aria-hidden>
      {visible && (
        <div style={WRAP}>
          <SericLoader variant="brand" size="lg" glow label="Loading Seric" />
        </div>
      )}
    </div>
  );
}
