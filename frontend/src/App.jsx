import React, { useState, useEffect } from 'react';
import ProgressRing from './components/ProgressRing';
import HeatmapGrid from './components/HeatmapGrid';
import EquityLineChart from './components/EquityLineChart';
import ExitReasonChart from './components/ExitReasonChart';
import LeaderboardTable from './components/LeaderboardTable';

const API_BASE = "http://localhost:8000";

export default function App() {
  // Main Navigation State
  const [activeTab, setActiveTab] = useState('explorer'); // 'explorer' or 'leaderboard'
  
  // Strategy settings input state
  const [entryScore, setEntryScore] = useState(7.0);
  const [exitScore, setExitScore] = useState(6.0);
  const [holdDays, setHoldDays] = useState(45);
  const [slType, setSlType] = useState('Fixed');

  // Ticker Scanner states
  const [scannerMode, setScannerMode] = useState('optimal'); // 'optimal' or 'scan'
  const [scanTp, setScanTp] = useState(2);
  const [scanSl, setScanSl] = useState(10);
  const [scanResults, setScanResults] = useState([]);
  const [loadingScan, setLoadingScan] = useState(false);
  
  // Backtest status state
  const [status, setStatus] = useState({
    status: "idle",
    progress: 0.0,
    current_ticker: "",
    error_message: "",
    elapsed_seconds: 0
  });

  // Global results cache
  const [globalData, setGlobalData] = useState({
    has_data: false,
    best_per_ticker: [],
    tickers_available: [],
    global_heatmap: []
  });

  // Interactive selection state
  const [selectedTicker, setSelectedTicker] = useState("AUBANK.NS");
  const [tickerCombos, setTickerCombos] = useState([]);
  const [selectedCombo, setSelectedCombo] = useState({ tp: 5, sl: 10, data: null });
  const [equityData, setEquityData] = useState(null);
  const [tradeLogs, setTradeLogs] = useState([]);
  const [loadingEquity, setLoadingEquity] = useState(false);

  // 1. Check status and fetch initial results on mount
  useEffect(() => {
    fetchStatus();
    fetchGlobalResults();
  }, []);

  // 1.1 Fetch scan results when scan configuration changes
  useEffect(() => {
    if (activeTab === 'leaderboard' && scannerMode === 'scan') {
      fetchScanResults();
    }
  }, [activeTab, scannerMode, scanTp, scanSl]);

  const fetchScanResults = async () => {
    setLoadingScan(true);
    try {
      const res = await fetch(`${API_BASE}/api/results/scan-custom?tp=${scanTp}&sl=${scanSl}`);
      if (res.ok) {
        const data = await res.json();
        setScanResults(data);
      } else {
        setScanResults([]);
      }
    } catch (e) {
      console.error("Error scanning tickers:", e);
      setScanResults([]);
    } finally {
      setLoadingScan(false);
    }
  };

  // 2. Poll status when backtest is running
  useEffect(() => {
    let interval = null;
    if (status.status === 'running') {
      interval = setInterval(() => {
        fetchStatus();
      }, 1000);
    } else if (status.status === 'completed') {
      // Reload results if it just finished
      fetchGlobalResults();
    }
    return () => clearInterval(interval);
  }, [status.status]);

  // 3. Re-fetch ticker sweep combos when selected ticker changes
  useEffect(() => {
    if (globalData.has_data && selectedTicker) {
      fetchTickerSweep();
    }
  }, [selectedTicker, globalData.has_data]);

  // 4. Re-fetch detailed equity curve when selected combo changes
  useEffect(() => {
    if (selectedTicker && selectedCombo.tp && selectedCombo.sl) {
      fetchEquityCurve();
    }
  }, [selectedTicker, selectedCombo.tp, selectedCombo.sl]);

  // API Call: Fetch running status
  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/backtest-status`);
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error("Error fetching status:", e);
    }
  };

  // API Call: Fetch global results & leaderboard
  const fetchGlobalResults = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/results`);
      const data = await res.json();
      setGlobalData(data);
      if (data.has_data && data.tickers_available.length > 0) {
        // Default to first ticker if none selected or not in list
        if (!data.tickers_available.includes(selectedTicker)) {
          setSelectedTicker(data.tickers_available[0]);
        }
      }
    } catch (e) {
      console.error("Error fetching global results:", e);
    }
  };

  // API Call: Fetch all 25 combos for chosen ticker
  const fetchTickerSweep = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/results/${selectedTicker}`);
      const data = await res.json();
      setTickerCombos(data);
      
      if (data.length > 0) {
        // Find if our currently selected TP & SL exists in the new ticker's sweep results
        const match = data.find(c => Math.round(c.tp_pct) === selectedCombo.tp && Math.round(c.sl_pct) === selectedCombo.sl);
        if (match) {
          setSelectedCombo(prev => ({
            ...prev,
            data: match
          }));
        } else {
          // Keep the custom selected TP & SL, and let the curve fetcher load stats on-demand
          setSelectedCombo(prev => ({
            ...prev,
            data: null
          }));
        }
      }
    } catch (e) {
      console.error("Error fetching ticker sweep:", e);
    }
  };

  // API Call: Fetch equity curve & detailed trade list
  const fetchEquityCurve = async () => {
    setLoadingEquity(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/equity-curve/${selectedTicker}/${selectedCombo.tp}/${selectedCombo.sl}`
      );
      if (res.ok) {
        const data = await res.json();
        setEquityData(data.equity_curve);
        setTradeLogs(data.trades);
        if (data.summary) {
          setSelectedCombo(prev => ({
            ...prev,
            data: data.summary
          }));
        }
      } else {
        setEquityData(null);
        setTradeLogs([]);
      }
    } catch (e) {
      console.error("Error fetching equity curve:", e);
      setEquityData(null);
      setTradeLogs([]);
    } finally {
      setLoadingEquity(false);
    }
  };

  // Load the best combo from current sweep results for this ticker
  const handleLoadOptimalParams = () => {
    if (tickerCombos.length > 0) {
      const best = tickerCombos[0]; // Sorted by win rate descending
      setSelectedCombo({
        tp: Math.round(best.tp_pct),
        sl: Math.round(best.sl_pct),
        data: best
      });
    }
  };

  // Action: Trigger backtest sweep
  const handleStartSweep = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/run-backtest`, { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          entry_score: parseFloat(entryScore),
          exit_score: parseFloat(exitScore),
          hold_days: parseInt(holdDays),
          sl_type: slType
        })
      });
      if (res.ok) {
        setStatus(prev => ({ ...prev, status: "running", progress: 0.0 }));
      } else {
        const err = await res.json();
        alert(`Failed to start backtest: ${err.detail}`);
      }
    } catch (e) {
      alert(`API Connection Failed. Please ensure backend is running.`);
    }
  };

  // Format Elapsed Time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="app-container">
      
      {/* ───────────────────────────────────────────────────────────────────────
          SIDEBAR / STATUS REGION
          ─────────────────────────────────────────────────────────────────────── */}
      <aside className="app-sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-logo">
            MAGIC TREND
          </h1>
          <span className="sidebar-subtitle">
            QUANTITATIVE SWEEP
          </span>
        </div>

        {/* Dynamic Status Dashboard Card */}
        <div className="glow-card sidebar-status-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: status.status === 'running' ? 'var(--color-primary)' : 
                          status.status === 'completed' ? 'var(--color-win)' : 'var(--text-dim)',
              boxShadow: status.status === 'running' ? '0 0 8px var(--color-primary)' : 'none'
            }} />
            <span style={{ 
              fontSize: '0.7rem', 
              fontFamily: 'var(--font-display)', 
              fontWeight: 600,
              textTransform: 'uppercase',
              color: 'var(--text-main)',
              letterSpacing: '0.05em'
            }}>
              SYSTEM: {status.status}
            </span>
          </div>

          {status.status === 'running' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                <span>RUNNING</span>
                <span>{status.progress}%</span>
              </div>
              <div style={{ height: '4px', background: 'rgba(255,255,255,0.03)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${status.progress}%`, height: '100%', background: 'var(--color-primary)', boxShadow: '0 0 6px var(--color-primary)' }} />
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Ticker: <span style={{ color: 'var(--color-primary)', fontWeight: 500 }}>{status.current_ticker}</span>
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                Elapsed: <span style={{ color: 'var(--text-main)' }}>{formatTime(status.elapsed_seconds)}</span>
              </div>
            </div>
          )}

          {status.status === 'error' && (
            <div style={{ fontSize: '0.7rem', color: 'var(--color-loss)', background: 'var(--color-loss-glow)', padding: '0.5rem', borderRadius: '4px' }}>
              {status.error_message}
            </div>
          )}

          {status.status !== 'running' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.8rem', marginTop: '0.4rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '0.05em' }}>
                STRATEGY PARAMETERS
              </div>

              {/* Stop Loss Type Dropdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Stop Loss Type:</span>
                </div>
                <select
                  value={slType}
                  onChange={e => setSlType(e.target.value)}
                  style={{ width: '100%', padding: '0.4rem 2rem 0.4rem 0.8rem', fontSize: '0.75rem', marginTop: '0.2rem' }}
                >
                  <option value="Fixed">Fixed Stop Loss</option>
                  <option value="Trailing">Trailing Stop Loss</option>
                  <option value="ATR-based">ATR Volatility Stop</option>
                </select>
              </div>

              {/* Take Profit (TP %) Slider */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Take Profit (TP %):</span>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{selectedCombo.tp}%</span>
                </div>
                <input 
                  type="range" 
                  min="0.5" 
                  max="30.0" 
                  step="0.5" 
                  value={selectedCombo.tp} 
                  onChange={e => setSelectedCombo(prev => ({ ...prev, tp: parseFloat(e.target.value) }))}
                  style={{ width: '100%', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                />
              </div>

              {/* Stop Loss (SL %) Slider */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Stop Loss (SL %):</span>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{selectedCombo.sl}%</span>
                </div>
                <input 
                  type="range" 
                  min="0.5" 
                  max="30.0" 
                  step="0.5" 
                  value={selectedCombo.sl} 
                  onChange={e => setSelectedCombo(prev => ({ ...prev, sl: parseFloat(e.target.value) }))}
                  style={{ width: '100%', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                />
              </div>
              
              {/* Entry Score Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Entry Score:</span>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{entryScore}</span>
                </div>
                <input 
                  type="range" 
                  min="5.0" 
                  max="9.0" 
                  step="0.1" 
                  value={entryScore} 
                  onChange={e => setEntryScore(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                />
              </div>

              {/* Exit Score Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Exit Score:</span>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{exitScore}</span>
                </div>
                <input 
                  type="range" 
                  min="4.0" 
                  max="8.0" 
                  step="0.1" 
                  value={exitScore} 
                  onChange={e => setExitScore(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                />
              </div>

              {/* Hold Days Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Max Hold Time:</span>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{holdDays} Days</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="90" 
                  step="5" 
                  value={holdDays} 
                  onChange={e => setHoldDays(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                />
              </div>
            </div>
          )}

          {status.status !== 'running' && (
            <button 
              onClick={handleStartSweep} 
              className="btn-neon-solid"
              style={{ width: '100%', padding: '0.6rem 0', fontSize: '0.75rem', letterSpacing: '0.05em', marginTop: '0.5rem' }}
            >
              START SWEEP RUN
            </button>
          )}
        </div>

        {/* Tab Buttons */}
        <nav className="sidebar-nav">
          <button
            onClick={() => setActiveTab('explorer')}
            style={{
              textAlign: 'left',
              padding: '0.6rem 0.8rem',
              borderRadius: '6px',
              background: activeTab === 'explorer' ? 'rgba(190, 242, 100, 0.05)' : 'transparent',
              border: 'none',
              color: activeTab === 'explorer' ? 'var(--color-primary)' : 'var(--text-muted)',
              fontFamily: 'var(--font-display)',
              fontWeight: 500,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'var(--transition-smooth)'
            }}
          >
            <span>PARAMETER EXPLORER</span>
            {activeTab === 'explorer' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-primary)' }}>
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            )}
          </button>
          <button
            onClick={() => setActiveTab('leaderboard')}
            style={{
              textAlign: 'left',
              padding: '0.6rem 0.8rem',
              borderRadius: '6px',
              background: activeTab === 'leaderboard' ? 'rgba(190, 242, 100, 0.05)' : 'transparent',
              border: 'none',
              color: activeTab === 'leaderboard' ? 'var(--color-primary)' : 'var(--text-muted)',
              fontFamily: 'var(--font-display)',
              fontWeight: 500,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'var(--transition-smooth)'
            }}
          >
            <span>TICKER LEADERBOARD</span>
            {activeTab === 'leaderboard' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-primary)' }}>
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            )}
          </button>
        </nav>

        <div className="sidebar-footer">
          v1.0.0 Stable API
        </div>
      </aside>

      {/* ───────────────────────────────────────────────────────────────────────
          MAIN DASHBOARD REGION
          ─────────────────────────────────────────────────────────────────────── */}
      <main className="app-main">
        
        {/* Top Summary Stats */}
        <div className="stats-grid">
          <div className="glow-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: '0.05em' }}>TICKERS RUN</span>
              <h2 style={{ fontSize: '1.5rem', color: 'var(--text-main)', marginTop: '0.2rem' }}>
                {globalData.has_data ? globalData.tickers_available.length : 0}
              </h2>
            </div>
            {/* SVG Bar Chart Icon */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-primary)', filter: 'drop-shadow(0 0 4px var(--color-primary-glow))' }}>
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
          </div>

          <div className="glow-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: '0.05em' }}>AVG SWEEP WIN RATE</span>
              <h2 style={{ fontSize: '1.5rem', color: 'var(--color-win)', marginTop: '0.2rem' }}>
                {globalData.has_data && globalData.best_per_ticker && globalData.best_per_ticker.length > 0
                  ? `${(globalData.best_per_ticker.reduce((acc, c) => acc + c.win_rate, 0) / globalData.best_per_ticker.length).toFixed(1)}%`
                  : '0.0%'}
              </h2>
            </div>
            {/* SVG Line Chart Icon */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-win)', filter: 'drop-shadow(0 0 4px var(--color-win-glow))' }}>
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
              <polyline points="17 6 23 6 23 12"></polyline>
            </svg>
          </div>

          <div className="glow-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: '0.05em' }}>TOP PERFORMING TICKER</span>
              <h2 style={{ fontSize: '1.15rem', color: 'var(--color-primary)', marginTop: '0.2rem', fontFamily: 'var(--font-display)', fontWeight: 'bold' }}>
                {globalData.has_data && globalData.best_per_ticker && globalData.best_per_ticker.length > 0 && globalData.best_per_ticker[0]?.ticker
                  ? `${globalData.best_per_ticker[0].ticker} (${globalData.best_per_ticker[0].win_rate}%)`
                  : 'N/A'}
              </h2>
            </div>
            {/* SVG Trophy Icon */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-primary)', filter: 'drop-shadow(0 0 4px var(--color-primary-glow))' }}>
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
              <path d="M4 22h16"></path>
              <path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34"></path>
              <path d="M12 2a7 7 0 0 0-7 7c0 3.18 2.12 5.86 5 6.71V2h2z"></path>
            </svg>
          </div>
        </div>

        {/* View Swapping */}
        {!globalData.has_data && status.status !== 'running' ? (
          /* Empty State */
          <div className="glow-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '1.5rem', textAlign: 'center' }}>
            {/* SVG Radar Target icon instead of emoji */}
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-primary)', filter: 'drop-shadow(0 0 8px var(--color-primary-glow))' }}>
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="6"></circle>
              <circle cx="12" cy="12" r="2"></circle>
            </svg>
            <div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No Sweep Results Cached</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '400px', margin: '0 auto' }}>
                Click the button in the sidebar to download stock history from FMP API and run the 25 combo grid sweep on all tickers.
              </p>
            </div>
            <button onClick={handleStartSweep} className="btn-neon">Start Backtest Run</button>
          </div>
        ) : activeTab === 'leaderboard' ? (
          /* Leaderboard Table View */
          <div className="glow-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>
                  {scannerMode === 'optimal' ? "BEST OPTIMAL COMBO PER TICKER" : "CROSS-TICKER PARAMETER SCANNER"}
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {scannerMode === 'optimal' 
                    ? "Displays the top performing settings sorted by win rate." 
                    : `Displays stock rankings for TP ${scanTp}% and SL ${scanSl}%.`}
                </p>
              </div>

              {/* Mode Toggle & Scan Parameters Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                  <button 
                    onClick={() => setScannerMode('optimal')}
                    style={{
                      background: scannerMode === 'optimal' ? 'var(--color-primary)' : 'transparent',
                      color: scannerMode === 'optimal' ? 'var(--bg-primary)' : 'var(--text-muted)',
                      border: 'none',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontFamily: 'var(--font-display)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'var(--transition-smooth)'
                    }}
                  >
                    BEST OPTIMAL
                  </button>
                  <button 
                    onClick={() => setScannerMode('scan')}
                    style={{
                      background: scannerMode === 'scan' ? 'var(--color-primary)' : 'transparent',
                      color: scannerMode === 'scan' ? 'var(--bg-primary)' : 'var(--text-muted)',
                      border: 'none',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontFamily: 'var(--font-display)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'var(--transition-smooth)'
                    }}
                  >
                    SCAN COMBO
                  </button>
                </div>

                {scannerMode === 'scan' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    {/* TP Slider */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', minWidth: '100px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>TP:</span>
                        <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{scanTp}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.5" 
                        max="30.0" 
                        step="0.5" 
                        value={scanTp} 
                        onChange={e => setScanTp(parseFloat(e.target.value))}
                        style={{ width: '100px', accentColor: 'var(--color-primary)', cursor: 'pointer', height: '4px' }}
                      />
                    </div>

                    {/* SL Slider */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', minWidth: '100px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>SL:</span>
                        <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{scanSl}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.5" 
                        max="30.0" 
                        step="0.5" 
                        value={scanSl} 
                        onChange={e => setScanSl(parseFloat(e.target.value))}
                        style={{ width: '100px', accentColor: 'var(--color-primary)', cursor: 'pointer', height: '4px' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {scannerMode === 'optimal' ? (
              <LeaderboardTable 
                data={globalData.best_per_ticker} 
                onSelectTicker={(t) => {
                  setSelectedTicker(t);
                  setActiveTab('explorer');
                }}
              />
            ) : loadingScan ? (
              <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                Scanning stocks for parameters...
              </div>
            ) : (
              <LeaderboardTable 
                data={scanResults} 
                onSelectTicker={(t) => {
                  setSelectedTicker(t);
                  // Setup combo to match scanned parameters
                  setSelectedCombo(prev => ({
                    ...prev,
                    tp: scanTp,
                    sl: scanSl
                  }));
                  setActiveTab('explorer');
                }}
              />
            )}
          </div>
        ) : (
          /* Parameter Explorer Grid View */
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
            
            {/* Split layout: Selector & Heatmap / Detail stats */}
            <div className="split-layout">
              
              {/* Left Column: Heatmap controls & cells */}
              <div className="glow-card explorer-grid-left" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>GRID SEARCH SWEEP</h3>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Select a ticker to explore all 25 TP/SL settings.</p>
                  </div>
                  {/* Ticker Selector & Load Optimal button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                      onClick={handleLoadOptimalParams}
                      className="btn-neon"
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.65rem', textTransform: 'uppercase' }}
                      title="Load the best performing parameters for this stock"
                    >
                      Load Optimal
                    </button>
                    <select
                      value={selectedTicker}
                      onChange={e => setSelectedTicker(e.target.value)}
                    >
                      {globalData.tickers_available.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <HeatmapGrid 
                  data={tickerCombos}
                  selectedCombo={selectedCombo}
                  onSelectCombo={setSelectedCombo}
                />
              </div>

              {/* Right Column: Dynamic selected cell detail dashboard */}
              <div className="glow-card explorer-grid-right" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>
                    {selectedTicker} DETAILS
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Config: <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>TP {selectedCombo.tp}% / SL {selectedCombo.sl}%</span>
                  </p>
                </div>

                {selectedCombo.data ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-around', width: '100%' }}>
                    <ProgressRing 
                      progress={selectedCombo.data.win_rate} 
                      label="Win Rate" 
                      color="var(--color-win)"
                    />
                    <ProgressRing 
                      progress={Math.min(100, Math.max(0, (selectedCombo.data.total_ret + 100) / 2))} 
                      valueText={`${selectedCombo.data.total_ret}%`}
                      label="Total Return" 
                      color="var(--color-primary)"
                    />
                    <ProgressRing 
                      progress={Math.min(100, (selectedCombo.data.cagr / 100) * 100)} 
                      valueText={`${selectedCombo.data.cagr}%`}
                      label="CAGR" 
                      color="var(--color-primary)"
                    />
                  </div>
                ) : (
                  <div style={{ height: '110px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
                    Loading statistics...
                  </div>
                )}

                {selectedCombo.data && (
                  <div className="details-stats-grid">
                    <div className="stat-item">
                      <span className="stat-label">TOTAL TRADES</span>
                      <span className="stat-value">{selectedCombo.data.trades}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">AVG PNL / TRADE</span>
                      <span className="stat-value" style={{ color: selectedCombo.data.avg_pnl >= 0 ? 'var(--color-win)' : 'var(--color-loss)' }}>
                        {selectedCombo.data.avg_pnl}%
                      </span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">MAX DRAWDOWN</span>
                      <span className="stat-value" style={{ color: 'var(--color-loss)' }}>-{selectedCombo.data.max_dd}%</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">CALMAR RATIO</span>
                      <span className="stat-value">{selectedCombo.data.calmar}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">AVG WIN / LOSS</span>
                      <span className="stat-value">
                        <span style={{ color: 'var(--color-win)' }}>{selectedCombo.data.avg_win}%</span>
                        {" / "}
                        <span style={{ color: 'var(--color-loss)' }}>{selectedCombo.data.avg_loss}%</span>
                      </span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">BEST / WORST</span>
                      <span className="stat-value">
                        <span style={{ color: 'var(--color-win)' }}>{selectedCombo.data.best}%</span>
                        {" / "}
                        <span style={{ color: 'var(--color-loss)' }}>{selectedCombo.data.worst}%</span>
                      </span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">AVG HOLD TIME</span>
                      <span className="stat-value">{selectedCombo.data.avg_hold} Days</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">FINAL CAPITAL</span>
                      <span className="stat-value">₹{Math.round(selectedCombo.data.final_cap || 0).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Row: Charts displaying Equity curve and Exit Reasons */}
            <div className="charts-row">
              
              {/* Equity Line Chart */}
              <div className="glow-card chart-card-large" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <h3 style={{ fontSize: '1rem', color: 'var(--text-main)' }}>HISTORICAL EQUITY CURVE</h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Mark-to-market performance tracing starting from ₹100,000.</p>
                </div>
                {loadingEquity ? (
                  <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                    Recalculating Equity Curve...
                  </div>
                ) : (
                  <EquityLineChart data={equityData} height={190} />
                )}
              </div>

              {/* Exit Reasons Chart */}
              <div className="glow-card chart-card-small" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <h3 style={{ fontSize: '1rem', color: 'var(--text-main)' }}>EXIT DISTRIBUTION</h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Categorization of exit reasons for all trades.</p>
                </div>
                {selectedCombo.data ? (
                  <ExitReasonChart 
                    tp={selectedCombo.data.tp_hits} 
                    sl={selectedCombo.data.sl_hits} 
                    score={selectedCombo.data.score_exits} 
                    time={selectedCombo.data.time_exits} 
                  />
                ) : (
                  <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
                    No statistics loaded
                  </div>
                )}
              </div>

            </div>

            {/* Trade History Logs */}
            <div className="glow-card trade-logs-card">
              <div>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>DETAILED TRADE HISTORY LOGS</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Chronological list of all closed-out trades for the selected combination.</p>
              </div>

              {loadingEquity ? (
                <div style={{ height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  Loading Trade Logs...
                </div>
              ) : !tradeLogs || tradeLogs.length === 0 ? (
                <div style={{ height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                  No trades recorded for this parameter configuration.
                </div>
              ) : (
                <div className="trade-logs-container">
                  <table className="trade-logs-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>ENTRY DATE</th>
                        <th>EXIT DATE</th>
                        <th>ENTRY PRICE</th>
                        <th>EXIT PRICE</th>
                        <th>P&L %</th>
                        <th>HOLD DAYS</th>
                        <th>EXIT REASON</th>
                        <th>CAPITAL AFTER</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradeLogs.map((trade, idx) => (
                        <tr key={idx}>
                          <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                          <td>{trade.entry_date}</td>
                          <td>{trade.exit_date}</td>
                          <td>₹{trade.entry_price ? trade.entry_price.toLocaleString() : '0'}</td>
                          <td>₹{trade.exit_price ? trade.exit_price.toLocaleString() : '0'}</td>
                          <td style={{ 
                            fontWeight: 600, 
                            color: trade.pnl_pct >= 0 ? 'var(--color-win)' : 'var(--color-loss)' 
                          }}>
                            {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct}%
                          </td>
                          <td>{trade.hold_days} Days</td>
                          <td style={{ 
                            fontWeight: 500,
                            color: trade.reason === 'TP' ? 'var(--color-win)' :
                                   trade.reason === 'SL' ? 'var(--color-loss)' :
                                   trade.reason === 'Score<6' ? 'var(--color-score)' : 'var(--color-time)'
                          }}>
                            {trade.reason === 'Score<6' ? 'Indicator Exit' :
                             trade.reason === 'Time45' ? 'Max Hold Limit' : trade.reason}
                          </td>
                          <td>₹{Math.round(trade.capital_after || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}

      </main>

    </div>
  );
}
