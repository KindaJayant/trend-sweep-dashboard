import React from 'react';

export default function ProgressRing({ radius = 45, stroke = 6, progress = 0, label = "", valueText = "", color = "var(--color-primary)" }) {
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (Math.max(0, Math.min(100, progress)) / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center relative" style={{ width: radius * 2, height: radius * 2 + (label ? 25 : 0) }}>
      <div className="relative" style={{ width: radius * 2, height: radius * 2 }}>
        <svg height={radius * 2} width={radius * 2} style={{ transform: 'rotate(-90deg)' }}>
          {/* Track Circle */}
          <circle
            stroke="rgba(255, 255, 255, 0.04)"
            fill="transparent"
            strokeWidth={stroke}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          {/* Active Glowing Circle */}
          <circle
            stroke={color}
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={circumference + ' ' + circumference}
            style={{ 
              strokeDashoffset, 
              transition: 'stroke-dashoffset 0.8s ease-in-out',
              filter: `drop-shadow(0 0 6px ${color})`
            }}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
            strokeLinecap="round"
          />
        </svg>
        {/* Centered value text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span className="font-display font-bold text-lg" style={{ color: 'var(--text-main)', fontSize: '1.15rem' }}>
            {valueText || `${Math.round(progress)}%`}
          </span>
        </div>
      </div>
      {label && (
        <span style={{ 
          fontSize: '0.75rem', 
          color: 'var(--text-muted)', 
          marginTop: '0.4rem', 
          display: 'block', 
          textAlign: 'center',
          fontFamily: 'var(--font-display)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          {label}
        </span>
      )}
    </div>
  );
}
