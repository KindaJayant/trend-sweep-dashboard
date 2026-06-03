import React from 'react';

export default function HeatmapGrid({ data = [], selectedCombo = null, onSelectCombo, slType = 'Fixed' }) {
  // Constants
  const TP_VALUES = [2, 3, 5, 8, 10];
  const SL_VALUES = [5, 10, 15, 20, 25];

  const safeData = Array.isArray(data) ? data : [];

  // Helper to find data point
  const getCellData = (tp, sl) => {
    return safeData.find(d => Math.round(d.tp_pct) === tp && Math.round(d.sl_pct) === sl);
  };

  // Find min/max win rate to normalize colors
  const winRates = safeData.map(d => d.win_rate).filter(w => w !== undefined);
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
    <div style={{
      display: 'grid',
      gridTemplateColumns: '50px repeat(5, 1fr)',
      gap: '8px',
      width: '100%',
      maxWidth: '480px',
      margin: '0 auto',
      alignItems: 'center'
    }}>
      {/* Empty corner block for alignment */}
      <div />
      
      {/* Heatmap Grid Header: SL % */}
      {SL_VALUES.map(sl => {
        let label = `SL ${sl}%`;
        if (slType === 'ATR-based') {
          const multMap = { 5: '1.5x', 10: '2.0x', 15: '3.0x', 20: '4.0x', 25: '5.0x' };
          label = `${multMap[sl] || (sl/5) + 'x'} ATR`;
        }
        return (
          <div 
            key={sl} 
            style={{ 
              textAlign: 'center', 
              fontSize: '0.7rem', 
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              padding: '4px 0',
              whiteSpace: 'nowrap'
            }}
          >
            {label}
          </div>
        );
      })}

      {/* Grid Rows */}
      {TP_VALUES.map(tp => (
        <React.Fragment key={tp}>
          {/* Row Header: TP % */}
          <div 
            style={{ 
              fontSize: '0.7rem', 
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              textAlign: 'right',
              paddingRight: '6px',
              whiteSpace: 'nowrap'
            }}
          >
            TP {tp}%
          </div>

          {/* Row Cells */}
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
                  aspectRatio: '1', /* Ensure perfect square aspect ratio */
                  position: 'relative',
                  border: isSelected ? '2px solid var(--color-primary)' : '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  cursor: cell ? 'pointer' : 'default',
                  opacity: cell ? 1 : 0.3,
                  transform: isSelected ? 'scale(1.05)' : 'none',
                  zIndex: isSelected ? 5 : 1,
                  boxShadow: isSelected ? 'var(--shadow-neon-strong)' : colorStyle.boxShadow,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  transition: 'var(--transition-smooth)'
                }}
              >
                {cell ? `${cell.win_rate}%` : 'N/A'}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}
