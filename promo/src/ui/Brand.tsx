import type React from 'react';
import { Img } from 'remotion';

// The oversized "V" from the app's start screen (apps/desktop/src/screens/StartScreen.tsx).
export const Watermark: React.FC<{ readonly style?: React.CSSProperties; readonly id: string }> = ({
  style,
  id,
}) => (
  <svg viewBox="38 44 180 168" style={{ position: 'absolute', ...style }}>
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f06b6b" stopOpacity={0.22} />
        <stop offset="100%" stopColor="#f06b6b" stopOpacity={0.02} />
      </linearGradient>
    </defs>
    <path
      fill={`url(#${id})`}
      d="M40.59 50.5 Q38 44 45 44 L77 44 Q84 44 86.59 50.5 L148.41 205.5 Q151 212 144 212 L112 212 Q105 212 102.41 205.5 Z M169.41 50.5 Q172 44 179 44 L211 44 Q218 44 215.41 50.5 L159.09 191.71 Q156.5 198.21 153.91 191.71 L136.09 147.04 Q133.5 140.54 136.09 134.04 Z"
    />
  </svg>
);

export const Chip: React.FC<{ readonly children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      padding: '10px 24px',
      borderRadius: 999,
      border: '1px solid rgba(255,255,255,0.16)',
      background: 'rgba(255,255,255,0.05)',
      fontFamily: '"Segoe UI Variable Text", "Segoe UI", sans-serif',
      fontSize: 28,
      color: '#d6d6d6',
    }}
  >
    {children}
  </div>
);

// A real screenshot with window-like rounding and depth (Img waits for it to load).
export const Shot: React.FC<{
  readonly src: string;
  readonly width: number;
  readonly style?: React.CSSProperties;
}> = ({ src, width, style }) => (
  <Img
    src={src}
    style={{
      position: 'absolute',
      width,
      borderRadius: 12,
      boxShadow: '0 40px 100px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.1)',
      ...style,
    }}
  />
);
