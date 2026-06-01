import React, { useState } from 'react';

export default function LeaderboardTable({ data = [], onSelectTicker }) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('win_rate');
  const [sortAsc, setSortAsc] = useState(false);

  // Filtering
  const filteredData = data.filter(d => 
    d.ticker.toLowerCase().includes(search.toLowerCase())
  );

  // Sorting
  const sortedData = [...filteredData].sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];
    
    if (typeof aVal === 'string') {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    
    return sortAsc ? aVal - bVal : bVal - aVal;
  });

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false); // Default descending for numbers
    }
  };

  const SortIndicator = ({ field }) => {
    if (sortField !== field) return null;
    return <span style={{ marginLeft: '4px', color: 'var(--color-primary)' }}>{sortAsc ? '▲' : '▼'}</span>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', width: '100%' }}>
      {/* Search Input */}
      <input
        type="text"
        placeholder="SEARCH TICKER..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          background: 'var(--bg-card-subtle)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          padding: '0.6rem 1rem',
          color: 'var(--text-main)',
          fontSize: '0.8rem',
          fontFamily: 'var(--font-display)',
          letterSpacing: '0.05em',
          outline: 'none',
          transition: 'var(--transition-smooth)'
        }}
        onFocus={e => e.target.style.borderColor = 'var(--color-primary)'}
        onBlur={e => e.target.style.borderColor = 'var(--border-subtle)'}
      />

      {/* Table Container */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-card-subtle)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
              {['ticker', 'tp_pct', 'sl_pct', 'trades', 'win_rate', 'cagr', 'max_dd', 'calmar'].map(field => {
                const label = field === 'tp_pct' ? 'TP' :
                              field === 'sl_pct' ? 'SL' :
                              field === 'max_dd' ? 'MAX DD' :
                              field.replace('_', ' ').toUpperCase();
                return (
                  <th 
                    key={field}
                    onClick={() => handleSort(field)}
                    style={{ 
                      padding: '0.75rem 1rem', 
                      cursor: 'pointer', 
                      fontFamily: 'var(--font-display)', 
                      fontWeight: 600,
                      userSelect: 'none'
                    }}
                  >
                    {label}
                    <SortIndicator field={field} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedData.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '2rem', textCenter: 'center', color: 'var(--text-dim)', textAlign: 'center' }}>
                  No tickers match your search
                </td>
              </tr>
            ) : (
              sortedData.map((row, idx) => (
                <tr 
                  key={idx}
                  onClick={() => onSelectTicker(row.ticker)}
                  style={{ 
                    borderBottom: '1px solid var(--border-subtle)', 
                    cursor: 'pointer',
                    transition: 'var(--transition-smooth)'
                  }}
                  className="hover:bg-card-hover"
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--color-primary)' }}>
                    {row.ticker}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>{row.tp_pct}%</td>
                  <td style={{ padding: '0.75rem 1rem' }}>{row.sl_pct}%</td>
                  <td style={{ padding: '0.75rem 1rem' }}>{row.trades}</td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{row.win_rate}%</td>
                  <td style={{ padding: '0.75rem 1rem', color: row.cagr > 0 ? 'var(--color-win)' : 'var(--color-loss)' }}>
                    {row.cagr > 0 ? '+' : ''}{row.cagr}%
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-loss)' }}>-{row.max_dd}%</td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>
                    {row.calmar === 999999 || row.calmar === Infinity ? '∞' : row.calmar}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
