import React from 'react';

export default function ExitReasonChart({ tp = 0, sl = 0, score = 0, time = 0 }) {
  const total = tp + sl + score + time || 1;

  const getPct = (val) => {
    return Math.round((val / total) * 100);
  };

  const categories = [
    { label: "Take Profit Hits (TP)", value: tp, pct: getPct(tp), color: "var(--color-win)", glow: "var(--color-win-glow)" },
    { label: "Stop Loss Hits (SL)", value: sl, pct: getPct(sl), color: "var(--color-loss)", glow: "var(--color-loss-glow)" },
    { label: "Score Exits (<6.0)", value: score, pct: getPct(score), color: "var(--color-score)", glow: "var(--color-score-glow)" },
    { label: "Time Exits (45 Days)", value: time, pct: getPct(time), color: "var(--color-time)", glow: "var(--color-time-glow)" },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', width: '100%' }}>
      {categories.map((cat, idx) => {
        return (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontFamily: 'var(--font-display)' }}>
              <span style={{ color: 'var(--text-muted)' }}>{cat.label}</span>
              <span style={{ color: cat.color, fontWeight: 'bold' }}>{cat.value} ({cat.pct}%)</span>
            </div>
            
            {/* Custom Progress bar */}
            <div style={{ 
              height: '6px', 
              background: 'rgba(255,255,255,0.03)', 
              borderRadius: '3px',
              overflow: 'hidden',
              position: 'relative',
              border: '1px solid rgba(255,255,255,0.01)'
            }}>
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                bottom: 0,
                width: `${cat.pct}%`,
                background: cat.color,
                borderRadius: '3px',
                boxShadow: `0 0 8px ${cat.color}`,
                transition: 'width 0.8s ease-in-out'
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
