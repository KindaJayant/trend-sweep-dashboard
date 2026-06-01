import os
import threading
import time
import pandas as pd
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from itertools import product
from typing import Optional

from backtest_engine import (
    TICKERS, FETCH_START, BACKTEST_FROM, BACKTEST_TO, TP_VALUES, SL_VALUES,
    download_all_data, compute_scores_vectorized, run_backtest
)

app = FastAPI(title="Magic Trend Parameter Sweep Dashboard API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Keys and Data Paths
FMP_API_KEY = "dbNyRfQKgqKOXmFXI0FJaTaFIWrzkfnN"
RESULTS_CSV = "param_sweep_results.csv"
BEST_CSV = "param_sweep_best_per_ticker.csv"

# Global In-Memory Stores
RAW_DATA_STORE = {}    # Ticker -> DataFrame (with 'score' computed)
SWEEP_RESULTS = []     # List of all backtest summaries (800 total)
BEST_PER_TICKER = []   # List of best summary per ticker

# Global Backtest Progress Tracking
BACKTEST_STATUS = {
    "status": "idle",       # "idle", "running", "completed", "error"
    "progress": 0.0,
    "current_ticker": "",
    "error_message": "",
    "start_time": 0.0,
    "elapsed_seconds": 0
}

# Auto-load files on startup if they exist
def load_existing_csvs():
    global SWEEP_RESULTS, BEST_PER_TICKER
    try:
        if os.path.exists(RESULTS_CSV):
            df_res = pd.read_csv(RESULTS_CSV)
            SWEEP_RESULTS = df_res.to_dict(orient="records")
            print(f"[STARTUP] Loaded {len(SWEEP_RESULTS)} results from {RESULTS_CSV}")
            
            if 'ticker' in df_res.columns:
                best_per_ticker_df = df_res.loc[df_res.groupby('ticker')['win_rate'].idxmax()].reset_index(drop=True)
                best_per_ticker_df = best_per_ticker_df.sort_values('win_rate', ascending=False)
                best_per_ticker_df.to_csv(BEST_CSV, index=False)
                BEST_PER_TICKER = best_per_ticker_df.to_dict(orient="records")
                print(f"[STARTUP] Recalculated {len(BEST_PER_TICKER)} best tickers with correct 'ticker' column.")
            else:
                print("[STARTUP ERROR] 'ticker' column missing in results CSV.")
    except Exception as e:
        print(f"[STARTUP WARN] Failed to load startup CSVs: {e}")

load_existing_csvs()

# ─────────────────────────────────────────────────────────────────────────────
# BACKGROUND WORKER
# ─────────────────────────────────────────────────────────────────────────────
def run_full_sweep_worker(apikey: str):
    global BACKTEST_STATUS, RAW_DATA_STORE, SWEEP_RESULTS, BEST_PER_TICKER
    
    BACKTEST_STATUS["status"] = "running"
    BACKTEST_STATUS["progress"] = 0.0
    BACKTEST_STATUS["start_time"] = time.time()
    BACKTEST_STATUS["error_message"] = ""
    
    combos = list(product(TP_VALUES, SL_VALUES))
    all_results = []
    
    try:
        BACKTEST_STATUS["current_ticker"] = "Downloading Tickers..."
        # 1. Fetch data in parallel
        ticker_dfs = download_all_data(TICKERS, FETCH_START, BACKTEST_TO, apikey, "fmp")
        
        # 2. Process and sweep
        total_tickers = len(TICKERS)
        for idx, ticker in enumerate(TICKERS):
            BACKTEST_STATUS["current_ticker"] = ticker
            BACKTEST_STATUS["progress"] = round((idx / total_tickers) * 100, 1)
            BACKTEST_STATUS["elapsed_seconds"] = int(time.time() - BACKTEST_STATUS["start_time"])
            
            df = ticker_dfs.get(ticker)
            if df is None or len(df) < 100:
                print(f"[WORKER] {ticker} skipped (no data or too short)")
                continue
                
            try:
                # Compute scores ONCE
                df['score'] = compute_scores_vectorized(df)
                bt = df[df.index >= BACKTEST_FROM].copy()
                bt.dropna(subset=['score'], inplace=True)
                
                # Keep in memory store for on-demand details
                RAW_DATA_STORE[ticker] = bt
                
                ticker_results = []
                for tp_pct, sl_pct in combos:
                    res = run_backtest(ticker, bt, tp_pct, sl_pct)
                    if res:
                        ticker_results.append(res)
                
                all_results.extend(ticker_results)
            except Exception as e:
                print(f"[WORKER ERROR] Processing failed for {ticker}: {e}")
                
        if not all_results:
            raise Exception("No backtest results generated. Check internet connectivity and symbols.")
            
        # 3. Compile and Save
        rdf = pd.DataFrame(all_results).sort_values('win_rate', ascending=False)
        rdf.to_csv(RESULTS_CSV, index=False)
        SWEEP_RESULTS = rdf.to_dict(orient="records")
        
        best_per_ticker_df = rdf.loc[rdf.groupby('ticker')['win_rate'].idxmax()].reset_index(drop=True)
        best_per_ticker_df = best_per_ticker_df.sort_values('win_rate', ascending=False)
        best_per_ticker_df.to_csv(BEST_CSV, index=False)
        BEST_PER_TICKER = best_per_ticker_df.to_dict(orient="records")
        
        BACKTEST_STATUS["status"] = "completed"
        BACKTEST_STATUS["progress"] = 100.0
        BACKTEST_STATUS["current_ticker"] = "Completed All"
        BACKTEST_STATUS["elapsed_seconds"] = int(time.time() - BACKTEST_STATUS["start_time"])
        print("[WORKER] Completed full sweep successfully!")
        
    except Exception as e:
        BACKTEST_STATUS["status"] = "error"
        BACKTEST_STATUS["error_message"] = str(e)
        print(f"[WORKER CRITICAL] Sweep worker crashed: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/run-backtest")
def start_backtest():
    if BACKTEST_STATUS["status"] == "running":
        raise HTTPException(status_code=400, detail="Backtest sweep is already running")
        
    # Start thread
    thread = threading.Thread(target=run_full_sweep_worker, args=(FMP_API_KEY,))
    thread.daemon = True
    thread.start()
    return {"message": "Sweep backtest started successfully"}

@app.get("/api/backtest-status")
def get_backtest_status():
    if BACKTEST_STATUS["status"] == "running":
        BACKTEST_STATUS["elapsed_seconds"] = int(time.time() - BACKTEST_STATUS["start_time"])
    return BACKTEST_STATUS

@app.get("/api/results")
def get_results():
    if not SWEEP_RESULTS:
        # Check if we can reload
        load_existing_csvs()
        
    if not SWEEP_RESULTS:
        return {"has_data": False}
        
    # Calculate global heatmap
    rdf = pd.DataFrame(SWEEP_RESULTS)
    pivot = rdf.groupby(['tp_pct','sl_pct'])['win_rate'].mean().reset_index()
    global_heatmap = pivot.to_dict(orient="records")
    
    unique_tickers = rdf['ticker'].unique().tolist()
    
    return {
        "has_data": True,
        "best_per_ticker": BEST_PER_TICKER,
        "tickers_available": unique_tickers,
        "global_heatmap": global_heatmap
    }

@app.get("/api/results/{ticker}")
def get_ticker_results(ticker: str):
    if not SWEEP_RESULTS:
        load_existing_csvs()
        
    if not SWEEP_RESULTS:
        raise HTTPException(status_code=404, detail="No backtest data available. Run sweep first.")
        
    # Filter for ticker
    rdf = pd.DataFrame(SWEEP_RESULTS)
    ticker_df = rdf[rdf['ticker'].str.upper() == ticker.upper()].sort_values('win_rate', ascending=False)
    
    if ticker_df.empty:
        raise HTTPException(status_code=404, detail=f"No results found for ticker {ticker}")
        
    return ticker_df.to_dict(orient="records")

@app.get("/api/equity-curve/{ticker}/{tp}/{sl}")
def get_equity_curve(ticker: str, tp: float, sl: float):
    # Ensure raw data is loaded/calculated
    bt = RAW_DATA_STORE.get(ticker)
    
    # If not in memory store, download and compute score on the fly
    if bt is None:
        try:
            # Single ticker download & compute
            ticker_dfs = download_all_data([ticker], FETCH_START, BACKTEST_TO, FMP_API_KEY, "fmp")
            df = ticker_dfs.get(ticker)
            if df is None or len(df) < 100:
                raise HTTPException(status_code=404, detail=f"Ticker data not found or insufficient history: {ticker}")
                
            df['score'] = compute_scores_vectorized(df)
            bt = df[df.index >= BACKTEST_FROM].copy()
            bt.dropna(subset=['score'], inplace=True)
            RAW_DATA_STORE[ticker] = bt
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to fetch data for {ticker}: {str(e)}")
            
    # Run backtest with details
    tp_pct = tp / 100.0
    sl_pct = sl / 100.0
    
    details = run_backtest(ticker, bt, tp_pct, sl_pct, return_details=True)
    if details is None:
        raise HTTPException(status_code=400, detail="No trades taken for this combination.")
        
    return details
