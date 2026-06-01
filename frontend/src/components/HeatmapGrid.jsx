import React from 'react';

export default function HeatmapGrid({ data = [], selectedCombo = null, onSelectCombo }) {
  // Constants
  const TP_VALUES = [2, 3, 5, 8, 10];
  const SL_VALUES = [5, 10, 15, 20, 25];

  // Helper to find data point
  const getCellData = (tp, sl) => {
    return data.find(d => Math.round(d.tp_pct) === tp && Math.round(d.sl_pct) === sl);
  };

  // Find min/max win rate to normalize colors
  const winRates = data.map(d => d.win_rate).filter(w => w !== undefined);
  const minWR = winRates.length > 0 ? Math.min(...winRates) : 0;
  const maxWR = winRates.length > 0 ? Math.max(...winRates) : 100;
  const wrRange = maxWR - minWR || 1;

  const getCellColorStyle = (cell) => {
    if (!cell) return { backgroundColor: 'rgba(255, 255, 255, 0.02)', color: 'var(--text-dim)' };
    
    // Normalize win rate between 0.1 and 0.8 for alpha channel of neon green
    const normalized = (cell.win_rate - minWR) / wrRange;
    const alpha = 0.1 + normalized * 0.75;
    
    // Determine text color based on background brightness
    const textColor = alpha > 0.45 ? 'var(--bg-primary)' : 'var(--text-main)';
    
    return {
      backgroundColor: `rgba(190, 242, 100, ${alpha})`,
      color: textColor,
      boxShadow: alpha > 0.6 ? '0 0 10px rgba(190, 242, 100, 0.2)' : 'none'
    };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '480px', margin: '0 auto' }}>
      
      {/* Heatmap Grid Header: SL % */}
      <div style={{ display: 'flex', marginBottom: '8px' }}>
        {/* Empty corner block for alignment */}
        <div style={{ width: '45px', flexShrink: 0 }} />
        <div style={{ display: 'flex', flexGrow: 1, justifyContent: 'space-around' }}>
          {SL_VALUES.map(sl => (
            <div 
              key={sl} 
              style={{ 
                width: '100%', 
                textAlign: 'center', 
                fontSize: '0.75rem', 
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-display)',
                fontWeight: 600
              }}
            >
              SL {sl}%
            </div>
          ))}
        </div>
      </div>

      {/* Grid Rows */}
      {TP_VALUES.map(tp => (
        <div key={tp} style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
          {/* Row Header: TP % */}
          <div 
            style={{ 
              width: '45px', 
              fontSize: '0.75rem', 
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              flexShrink: 0
            }}
          >
            TP {tp}%
          </div>

          {/* Row Cells */}
          <div style={{ display: 'flex', flexGrow: 1, gap: '6px' }}>
            {SL_VALUES.map(sl => {
              const cell = getCellData(tp, sl);
              const colorStyle = getCellColorStyle(cell);
              const isSelected = selectedCombo && selectedCombo.tp === tp && selectedCombo.sl === sl;
              
              return (
                <div
                  key={sl}
                  onClick={() => cell && onSelectCombo({ tp, sl, data: cell })}
                  className="heatmap-cell"
                  style={{
                    ...colorStyle,
                    width: '100%',
                    paddingTop: '35%', /* Ensure square aspect ratio */
                    position: 'relative',
                    border: isSelected ? '2px solid var(--color-primary)' : '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    cursor: cell ? 'pointer' : 'default',
                    opacity: cell ? 1 : 0.3,
                    transform: isSelected ? 'scale(1.05)' : 'none',
                    zIndex: isSelected ? 5 : 1,
                    boxShadow: isSelected ? 'var(--shadow-neon-strong)' : colorStyle.boxShadow
                  }}
                >
                  <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-display)',
                    fontSize: '0.75rem',
                    fontWeight: 700
                  }}>
                    {cell ? `${cell.win_rate}%` : 'N/A'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
