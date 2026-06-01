import React, { useState, useRef, useEffect } from 'react';

export default function EquityLineChart({ data = [], height = 180 }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const [width, setWidth] = useState(400);

  // Update container width on resize
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(containerRef.current);
    setWidth(containerRef.current.clientWidth);
    return () => resizeObserver.disconnect();
  }, []);

  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
        No chart data available
      </div>
    );
  }

  // Extract values
  const values = data.map(d => d.equity);
  const minVal = Math.min(...values) * 0.98; // Add small buffer
  const maxVal = Math.max(...values) * 1.02; // Add small buffer
  const valRange = maxVal - minVal || 1;

  // Margin definitions
  const margin = { top: 15, right: 15, bottom: 25, left: 55 };
  const graphWidth = width - margin.left - margin.right;
  const graphHeight = height - margin.top - margin.bottom;

  // Map data to SVG coordinates
  const getCoordinates = () => {
    const len = data.length;
    return data.map((d, index) => {
      const x = margin.left + (index / (len - 1 || 1)) * graphWidth;
      const y = margin.top + graphHeight - ((d.equity - minVal) / valRange) * graphHeight;
      return { x, y, data: d };
    });
  };

  const coords = getCoordinates();

  // Create path strings
  const getLinePath = () => {
    if (coords.length === 0) return '';
    return coords.reduce((acc, c, i) => {
      return i === 0 ? `M ${c.x} ${c.y}` : `${acc} L ${c.x} ${c.y}`;
    }, '');
  };

  const getAreaPath = (linePath) => {
    if (!linePath) return '';
    // Close the path to the bottom of the graph to fill the area
    return `${linePath} L ${coords[coords.length - 1].x} ${margin.top + graphHeight} L ${coords[0].x} ${margin.top + graphHeight} Z`;
  };

  const linePath = getLinePath();
  const areaPath = getAreaPath(linePath);

  // Handle mouse moves for tooltip tracing
  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - margin.left;
    
    // Find closest index
    const len = data.length;
    const pct = Math.max(0, Math.min(1, mouseX / graphWidth));
    const rawIndex = Math.round(pct * (len - 1));
    const index = Math.max(0, Math.min(len - 1, rawIndex));
    
    setHoverIndex(index);
    if (coords[index]) {
      setTooltipPos({
        x: coords[index].x,
        y: coords[index].y - 12
      });
    }
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  // Y-axis tick values (4 steps)
  const yTicks = [
    minVal,
    minVal + valRange * 0.33,
    minVal + valRange * 0.66,
    maxVal
  ];

  // X-axis date markings (5 steps)
  const getXTicks = () => {
    const len = data.length;
    if (len < 5) return data;
    const step = Math.floor(len / 4);
    return [0, step, step * 2, step * 3, len - 1].map(i => ({
      index: i,
      date: data[i].date,
      x: coords[i].x
    }));
  };

  const xTicks = getXTicks();

  return (
    <div 
      ref={containerRef} 
      style={{ width: '100%', position: 'relative', userSelect: 'none' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <svg width={width} height={height}>
        <defs>
          {/* Gradient for area fill */}
          <linearGradient id="neonAreaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.0" />
          </linearGradient>
          {/* Glow filter for the neon line */}
          <filter id="neonLineGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Y Axis Gridlines and Labels */}
        {yTicks.map((val, i) => {
          const y = margin.top + graphHeight - ((val - minVal) / valRange) * graphHeight;
          return (
            <g key={i}>
              <line 
                x1={margin.left} 
                y1={y} 
                x2={width - margin.right} 
                y2={y} 
                stroke="rgba(255, 255, 255, 0.03)" 
                strokeWidth={1}
              />
              <text 
                x={margin.left - 10} 
                y={y + 4} 
                fill="var(--text-muted)" 
                fontSize="0.7rem" 
                textAnchor="end"
                fontFamily="var(--font-display)"
              >
                ₹{Math.round(val).toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* X Axis Date Labels */}
        {xTicks.map((tick, i) => {
          return (
            <g key={i}>
              <line
                x1={tick.x}
                y1={margin.top}
                x2={tick.x}
                y2={margin.top + graphHeight}
                stroke="rgba(255, 255, 255, 0.02)"
                strokeWidth={1}
              />
              <text 
                x={tick.x} 
                y={height - 6} 
                fill="var(--text-muted)" 
                fontSize="0.65rem" 
                textAnchor="middle"
                fontFamily="var(--font-display)"
              >
                {new Date(tick.date).toLocaleDateString(undefined, {month: 'short', year: '25' === tick.date ? undefined : '2-digit'})}
              </text>
            </g>
          );
        })}

        {/* The Filled Gradient Area */}
        <path d={areaPath} fill="url(#neonAreaGradient)" />

        {/* The Glowing Neon Line */}
        <path 
          d={linePath} 
          fill="none" 
          stroke="var(--color-primary)" 
          strokeWidth={2} 
          filter="url(#neonLineGlow)"
        />

        {/* Vertical Tracing Line on Hover */}
        {hoverIndex !== null && coords[hoverIndex] && (
          <line
            x1={coords[hoverIndex].x}
            y1={margin.top}
            x2={coords[hoverIndex].x}
            y2={margin.top + graphHeight}
            stroke="var(--color-primary)"
            strokeWidth={1}
            strokeDasharray="4,4"
            style={{ opacity: 0.5 }}
          />
        )}

        {/* Glowing Data Point on Hover */}
        {hoverIndex !== null && coords[hoverIndex] && (
          <g>
            <circle
              cx={coords[hoverIndex].x}
              cy={coords[hoverIndex].y}
              r={7}
              fill="var(--color-primary)"
              style={{ opacity: 0.2 }}
            />
            <circle
              cx={coords[hoverIndex].x}
              cy={coords[hoverIndex].y}
              r={3}
              fill="var(--bg-primary)"
              stroke="var(--color-primary)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {/* Floating Tooltip HTML */}
      {hoverIndex !== null && coords[hoverIndex] && (
        <div style={{
          position: 'absolute',
          left: tooltipPos.x - 70,
          top: tooltipPos.y - 50,
          width: '140px',
          background: 'var(--bg-card)',
          border: '1px solid var(--color-primary)',
          borderRadius: '4px',
          padding: '4px 8px',
          boxShadow: 'var(--shadow-neon)',
          pointerEvents: 'none',
          zIndex: 100,
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-display)' }}>
            {coords[hoverIndex].data.date}
          </div>
          <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}>
            ₹{coords[hoverIndex].data.equity.toLocaleString()}
          </div>
          {coords[hoverIndex].data.in_trade && (
            <div style={{ fontSize: '0.6rem', color: 'var(--color-win)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              In Trade
            </div>
          )}
        </div>
      )}
    </div>
  );
}
