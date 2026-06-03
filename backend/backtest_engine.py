import pandas as pd
import numpy as np
import warnings
import yfinance as yf
import requests
import concurrent.futures
import time

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS & CONFIG
# ─────────────────────────────────────────────────────────────────────────────
INITIAL_CAP   = 100_000
HOLD_DAYS     = 45
SCORE_ENTRY   = 7.0
SCORE_EXIT    = 6.0
ROLL_CORR_LB  = 50

TP_VALUES = [0.02, 0.03, 0.05, 0.08, 0.10]
SL_VALUES = [0.05, 0.10, 0.15, 0.20, 0.25]

# ─────────────────────────────────────────────────────────────────────────────
# INDICATOR HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def ema(s, p):  return s.ewm(span=p, adjust=False).mean()
def rma(s, l):  return s.ewm(alpha=1/l, adjust=False).mean()
def wma(s, l):
    w = np.arange(1, l+1); ws = w.sum()
    return s.rolling(l).apply(lambda x: np.dot(x,w)/ws, raw=True)

def true_range(h, l, c):
    pc = c.shift(1)
    return pd.concat([(h-l),(h-pc).abs(),(l-pc).abs()], axis=1).max(axis=1)

def atr_fn(h, l, c, n): return rma(true_range(h,l,c), n)

def zlema(s, n):
    lag = (n-1)//2
    return ema(s + (s - s.shift(lag)), n)

def compute_trend_vec(close, zl, vol):
    cl=close.values; zv=zl.values; vv=vol.values
    trend=np.zeros(len(cl))
    for i in range(1, len(cl)):
        upper=zv[i]+vv[i]; lower=zv[i]-vv[i]
        pu=zv[i-1]+vv[i-1]; pl=zv[i-1]-vv[i-1]
        t=trend[i-1]
        if   cl[i]>upper and cl[i-1]<=pu: t= 1
        elif cl[i]<lower and cl[i-1]>=pl: t=-1
        trend[i]=t
    return pd.Series(trend, index=close.index)

def supertrend_vec(h, l, c, n=10, mult=3.0):
    hl2=(h+l)/2; av=atr_fn(h,l,c,n)
    upper=hl2+mult*av; lower=hl2-mult*av
    st=np.empty(len(c)); d=np.zeros(len(c))
    st[0]=c.iloc[0]
    cv=c.values; uv=upper.values; lv=lower.values
    for i in range(1, len(c)):
        ps=st[i-1]
        st[i]=max(lv[i],ps) if cv[i-1]>ps else min(uv[i],ps)
        if   cv[i]>ps: d[i]= 1
        elif cv[i]<ps: d[i]=-1
        else:           d[i]=d[i-1]
    return pd.Series(st, index=c.index), pd.Series(d, index=c.index)

def psar_vec(h, l, af_step=0.02, af_max=0.2):
    psar=np.empty(len(h)); psar[0]=l.iloc[0]
    is_bull=True; af=af_step; ep=l.iloc[0]
    hv=h.values; lv=l.values
    for i in range(1, len(h)):
        pp=psar[i-1]
        if i==1: psar[i]=pp; ep=hv[i] if is_bull else lv[i]; continue
        np_=pp+af*(ep-pp)
        if is_bull:
            if i>1: np_=min(np_,lv[i-1])
            if i>2: np_=min(np_,lv[i-2])
            if lv[i]<np_: is_bull=False; np_=ep; ep=lv[i]; af=af_step
            elif hv[i]>ep: ep=hv[i]; af=min(af+af_step,af_max)
        else:
            if i>1: np_=max(np_,hv[i-1])
            if i>2: np_=max(np_,hv[i-2])
            if hv[i]>np_: is_bull=True; np_=ep; ep=hv[i]; af=af_step
            elif lv[i]<ep: ep=lv[i]; af=min(af+af_step,af_max)
        psar[i]=np_
    return pd.Series(psar, index=h.index)

def stoch_k_vec(h, l, c, n=50):
    mn=l.rolling(n).min(); mx=h.rolling(n).max()
    d=(mx-mn).replace(0,np.nan)
    return ((100*(c-mn)/d).fillna(50)).clip(0,100)

def vortex_vec(h, l, c, n=14):
    tr=true_range(h,l,c)
    vp=(h-l.shift(1)).abs().rolling(n).sum()
    vm=(l-h.shift(1)).abs().rolling(n).sum()
    trs=tr.rolling(n).sum().replace(0,1e-6)
    return (vp/trs).fillna(1), (vm/trs).fillna(1)

def rsi_vec(c, n=14):
    d=c.diff(); g=d.where(d>0,0); ls=-d.where(d<0,0)
    rs=rma(g,n)/rma(ls,n).replace(0,1e-6)
    return (100-100/(1+rs)).fillna(50)

def dmi_vec(h, l, c, n=14):
    tr=true_range(h,l,c)
    dh=h.diff(); dl=l.diff()
    pdm=pd.Series(np.where((dh>0)&(dh>-dl),dh,0),index=h.index)
    mdm=pd.Series(np.where((dl<0)&(dl.abs()>dh),dl.abs(),0),index=h.index)
    trs=rma(tr,n).replace(0,1e-6)
    pdi=100*rma(pdm,n)/trs; mdi=100*rma(mdm,n)/trs
    dx=100*(pdi-mdi).abs()/(pdi+mdi).replace(0,1e-6)
    return pdi.fillna(50), mdi.fillna(50), rma(dx,n).fillna(25)

def mfi_vec(h, l, c, v, n=14):
    tp=(h+l+c)/3; mf=tp*v; fd=tp.diff()
    pmf=mf.where(fd>0,0); nmf=mf.where(fd<0,0)
    mr=rma(pmf,n)/rma(nmf,n).replace(0,1e-6)
    return (100-100/(1+mr)).fillna(50)

def fisher_vec(h, l, c, n=10):
    hh=h.rolling(n).max(); ll=l.rolling(n).min()
    raw=pd.Series(np.where(hh==ll,0,2*((c-ll)/(hh-ll))-1),index=c.index).fillna(0)
    sm=wma(raw,5).clip(-0.999,0.999)
    return (0.5*np.log((1+sm)/np.maximum(1-sm,0.001))).fillna(0)

# ─────────────────────────────────────────────────────────────────────────────
# VECTORIZED SCORE
# ─────────────────────────────────────────────────────────────────────────────
def compute_scores_vectorized(df):
    c=df['close']; h=df['high']; l=df['low']; v=df['volume']

    ml=ema(c,12)-ema(c,26); sl_=ema(ml,9)
    k=stoch_k_vec(h,l,c)
    vp,vm=vortex_vec(h,l,c)
    mom=c.diff(10)
    rs=rsi_vec(c)
    ps=psar_vec(h,l)
    pdi,mdi,adx_v=dmi_vec(h,l,c)
    mf=mfi_vec(h,l,c,v)
    fi=fisher_vec(h,l,c)
    pc14=c.diff(14)
    bull_m=rma(pc14.where(pc14>0,0),14)
    bear_m=rma(-pc14.where(pc14<0,0),14)
    st_v,st_d=supertrend_vec(h,l,c)
    zl_s=zlema(c,50)
    atr_zl=atr_fn(h,l,c,50)
    vol_zl=atr_zl.rolling(150,min_periods=1).max()
    trend=compute_trend_vec(c,zl_s,vol_zl)
    a14=atr_fn(h,l,c,14); a10=atr_fn(h,l,c,10)
    df['atr'] = a14
    a14s=a14.replace(0,np.nan).fillna(1.0)
    a10s=a10.replace(0,np.nan).fillna(1.0)
    ms=mom.rolling(10,min_periods=2).std().replace(0,np.nan).fillna(1.0)
    fstd=fi.diff().rolling(10,min_periods=2).std().replace(0,np.nan).fillna(1.0)

    macd_sc=(5+(ml-sl_)/a14s*2).clip(0,10)
    stoch_sc=pd.Series(np.where(k>=50,5+(k-50)/5,5-(50-k)/5),index=c.index).clip(0,10)
    vort_sc=(5+(vp-vm)*10).clip(0,10)
    mom_sc=(5+(mom/ms)*2).clip(0,10)
    rsi_sc=(rs/10).clip(0,10)
    psar_sc=(5+((c-ps)/a14s)*5).clip(0,10)
    dmi_sc=(5+(pdi-mdi)*(adx_v/100)*5).clip(0,10)
    mfi_sc=(mf/10).clip(0,10)
    fish_sc=(5+(fi.diff()/fstd)*3).clip(0,10)
    adx_sc=(5+((bull_m-bear_m)/a14s)*3).clip(0,10)
    st_sc=(5+((c-st_v)/a10s)*4*st_d).clip(0,10)
    zl_sc=pd.Series(np.where(trend==1,7.5,np.where(trend==-1,2.5,5.0)),index=c.index)

    scores_df=pd.DataFrame({
        'macd':macd_sc,'stoch':stoch_sc,'vort':vort_sc,'mom':mom_sc,
        'rsi':rsi_sc,'psar':psar_sc,'dmi':dmi_sc,'mfi':mfi_sc,
        'fish':fish_sc,'adx':adx_sc,'st':st_sc,'zl':zl_sc
    })
    base_w=np.array([1.0,0.9,0.9,1.0,1.0,1.2,1.2,1.0,1.0,1.2,1.2,1.5])

    pcs=c.diff(1).apply(lambda x: 1. if x>0 else(-1. if x<0 else 0.))
    pcs_fwd=pcs.shift(-1)
    dirs=pd.DataFrame({
        'macd':np.where(ml>sl_,1.,-1.),'stoch':np.where(k>50,1.,-1.),
        'vort':np.where(vp>vm,1.,-1.),'mom':np.where(mom>0,1.,-1.),
        'rsi':np.where(rs>50,1.,-1.),'psar':np.where(c>ps,1.,-1.),
        'dmi':np.where(pdi>mdi,1.,-1.),'mfi':np.where(mf>50,1.,-1.),
        'fish':np.where(fi>0,1.,-1.),'adx':np.where(bull_m>bear_m,1.,-1.),
        'st':st_d.values,'zl':trend.values,
    },index=c.index).astype(float)

    acc_df=pd.DataFrame(index=c.index)
    for col in dirs.columns:
        acc_df[col]=dirs[col].rolling(ROLL_CORR_LB,min_periods=ROLL_CORR_LB//2).corr(pcs_fwd)
    acc_df=((acc_df+1)/2).fillna(0.5)
    acc_mult=pd.DataFrame(
        np.where(acc_df>0.6,1.2,np.where(acc_df<0.4,0.8,1.0)),
        index=c.index,columns=dirs.columns
    )

    sma_a14=a14.rolling(50,min_periods=1).mean().replace(0,np.nan).fillna(1.0)
    sma_vol=v.rolling(50,min_periods=1).mean().replace(0,np.nan).fillna(1.0)
    vr=(a14/sma_a14).fillna(1.0); volr=(v/sma_vol).fillna(1.0)
    tf=np.where(adx_v>25,1.5,0.7); mof=np.where(adx_v>25,0.7,1.2)
    vhf=np.where(vr>1.2,1.3,np.where(vr<0.8,1.2,1.0)); vcf=np.where(volr>1.5,1.1,1.0)

    regime=pd.DataFrame(1.0,index=c.index,columns=dirs.columns)
    for col in ['psar','dmi','adx','st','zl']:     regime[col]*=tf
    for col in ['macd','mom','rsi','mfi','fish']:   regime[col]*=mof
    for col in ['stoch','vort']:                    regime[col]*=vhf
    for col in ['mom','mfi']:                       regime[col]*=vcf

    final_w=(base_w*regime.values*acc_mult.values).clip(0.5,2.0)
    final_w_df=pd.DataFrame(final_w,index=c.index,columns=dirs.columns)

    ws=(scores_df*final_w_df).sum(axis=1)
    tw=final_w_df.sum(axis=1).replace(0,np.nan)
    overall=(ws/tw).fillna(5.0)
    overall.iloc[:60]=np.nan
    return overall

# ─────────────────────────────────────────────────────────────────────────────
# BACKTEST — with option to retrieve full trade list & mark-to-market equity curve
# ─────────────────────────────────────────────────────────────────────────────
def run_backtest(ticker, bt, tp_pct, sl_pct, entry_score=SCORE_ENTRY, exit_score=SCORE_EXIT, hold_days=HOLD_DAYS, sl_type="Fixed", return_details=False):
    dates  = bt.index.tolist()
    opens  = bt['open'].values
    closes = bt['close'].values
    scores = bt['score'].values
    atrs   = bt['atr'].values if 'atr' in bt.columns else np.zeros(len(closes))

    capital = INITIAL_CAP
    trades = []
    in_trade = False
    entry_price = entry_date = shares_held = None
    
    # Track trailing peak price
    max_price = 0.0
    
    # Mark-to-market daily capital tracing
    daily_equity = []

    for i in range(1, len(dates)):
        # Calculate current equity for daily curve
        if in_trade:
            # Mark to market using the current day's closing price
            current_equity = capital - (shares_held * entry_price) + (shares_held * closes[i])
        else:
            current_equity = capital
            
        daily_equity.append({
            'date': dates[i].strftime('%Y-%m-%d'),
            'equity': round(float(current_equity), 2),
            'in_trade': in_trade
        })

        if not in_trade:
            # Entry condition
            if i>=2 and scores[i-2]<=entry_score and scores[i-1]>entry_score:
                ep=opens[i]; sh=int(capital//ep)
                if sh==0: continue
                entry_price=ep; entry_date=dates[i]; shares_held=sh; in_trade=True
                max_price=closes[i]
            continue

        days_cal=(dates[i]-entry_date).days
        cc=closes[i]; sc=scores[i]
        tp_p=entry_price*(1+tp_pct)
        
        # Stop Loss Level based on Strategy Selection
        if sl_type == "Trailing":
            max_price = max(max_price, cc)
            sl_p = max_price * (1 - sl_pct)
        elif sl_type == "ATR-based":
            # Map SL sweep values (5%, 10%, 15%, 20%, 25%) to ATR multipliers (1.5x, 2.0x, 3.0x, 4.0x, 5.0x)
            mult_map = {0.05: 1.5, 0.10: 2.0, 0.15: 3.0, 0.20: 4.0, 0.25: 5.0}
            mult = mult_map.get(round(sl_pct, 2), 2.0)
            current_atr = atrs[i] if i < len(atrs) else 0.0
            sl_p = entry_price - (mult * current_atr)
        else: # Fixed
            sl_p = entry_price * (1 - sl_pct)

        reason=None
        if   cc>=tp_p:              reason="TP"
        elif cc<=sl_p:              reason="SL"
        elif sc<exit_score:         reason=f"Score<{exit_score}"
        elif days_cal>=hold_days:   reason=f"Time{hold_days}"

        if reason:
            if reason==f"Time{hold_days}":
                xp=cc; xd=dates[i]
            else:
                xp=opens[i+1] if i+1<len(dates) else cc
                xd=dates[i+1] if i+1<len(dates) else dates[i]

            invested=shares_held*entry_price; proceeds=shares_held*xp
            pnl_pct=(xp-entry_price)/entry_price*100
            capital=capital-invested+proceeds
            hd=(pd.Timestamp(xd)-entry_date).days
            years=hd/365.0
            cagr=((xp/entry_price)**(1/years)-1)*100 if years>0 else 0.0
            
            trades.append({
                'entry_date': entry_date.strftime('%Y-%m-%d'),
                'exit_date': pd.Timestamp(xd).strftime('%Y-%m-%d'),
                'entry_price': round(float(entry_price), 2),
                'exit_price': round(float(xp), 2),
                'pnl_pct': round(pnl_pct, 2),
                'cagr': round(cagr, 2),
                'hold_days': hd,
                'capital_after': round(float(capital), 2),
                'reason': reason
            })
            in_trade=False; entry_price=entry_date=shares_held=None

    # If no trades were taken, generate dummy return
    if not trades:
        return None

    tdf=pd.DataFrame(trades)
    wins=tdf[tdf['pnl_pct']>0]; losses=tdf[tdf['pnl_pct']<=0]; total=len(tdf)

    # Compute Max Drawdown
    equity_values = [d['equity'] for d in daily_equity] if daily_equity else [INITIAL_CAP]
    eq_arr = np.array(equity_values)
    peak = np.maximum.accumulate(eq_arr)
    dd = (eq_arr - peak) / peak * 100
    max_dd = abs(dd.min()) if len(dd) else 0.0

    final=capital
    start=pd.Timestamp(bt.index[0]); end=pd.Timestamp(bt.index[-1])
    yrs=(end-start).days/365.0
    cagr=((final/INITIAL_CAP)**(1/yrs)-1)*100 if yrs>0 else 0.0
    calmar=cagr/max_dd if max_dd>0 else float('inf')

    summary = {
        'ticker'      : ticker,
        'tp_pct'      : round(tp_pct*100,0),
        'sl_pct'      : round(sl_pct*100,0),
        'trades'      : total,
        'win_rate'    : round(len(wins)/total*100,1) if total > 0 else 0.0,
        'avg_pnl'     : round(tdf['pnl_pct'].mean(),2) if total > 0 else 0.0,
        'avg_win'     : round(wins['pnl_pct'].mean(),2) if len(wins) else 0.0,
        'avg_loss'    : round(losses['pnl_pct'].mean(),2) if len(losses) else 0.0,
        'best'        : round(tdf['pnl_pct'].max(),2) if total > 0 else 0.0,
        'worst'       : round(tdf['pnl_pct'].min(),2) if total > 0 else 0.0,
        'avg_hold'    : round(tdf['hold_days'].mean(),1) if total > 0 else 0.0,
        'final_cap'   : round(final,2),
        'total_ret'   : round((final/INITIAL_CAP-1)*100,2),
        'cagr'        : round(cagr,2),
        'max_dd'      : round(max_dd,2),
        'calmar'      : round(calmar,2),
        'tp_hits'     : int((tdf['reason']=='TP').sum()),
        'sl_hits'     : int((tdf['reason']=='SL').sum()),
        'score_exits' : int((tdf['reason']==f"Score<{exit_score}").sum()),
        'time_exits'  : int((tdf['reason']==f"Time{hold_days}").sum()),
    }
    
    if return_details:
        return {
            'summary': summary,
            'trades': trades,
            'equity_curve': daily_equity
        }
    return summary

# ─────────────────────────────────────────────────────────────────────────────
# DUAL-SOURCE DATA DOWNLOADER
# ─────────────────────────────────────────────────────────────────────────────
def fetch_ticker_fmp(ticker, start_date, apikey):
    url = f"https://financialmodelingprep.com/stable/historical-price-eod/full?symbol={ticker}&from={start_date}&apikey={apikey}"
    response = requests.get(url, timeout=15)
    if response.status_code != 200:
        raise Exception(f"FMP HTTP Error {response.status_code}")
    data = response.json()
    if not isinstance(data, list) or len(data) == 0:
        raise Exception(f"FMP returned empty or invalid data format.")
    
    df = pd.DataFrame(data)
    df['date'] = pd.to_datetime(df['date'])
    df.set_index('date', inplace=True)
    df.sort_index(inplace=True)
    df = df[['open', 'high', 'low', 'close', 'volume']].astype(float)
    return df

def fetch_ticker_yfinance(ticker, start_date, end_date):
    df = yf.download(ticker, start=start_date, end=end_date, auto_adjust=True, progress=False)
    if df.empty:
        raise Exception("yfinance returned empty DataFrame")
    df.columns = [c.lower() for c in df.columns]
    df = df[['open', 'high', 'low', 'close', 'volume']].dropna()
    return df

def fetch_ticker_data(ticker, start_date, end_date, apikey, primary_source="fmp"):
    if primary_source == "fmp" and apikey:
        try:
            df = fetch_ticker_fmp(ticker, start_date, apikey)
            print(f"[DATA] {ticker} successfully downloaded via FMP")
            return df
        except Exception as e:
            print(f"[WARN] FMP failed for {ticker}: {e}. Falling back to yfinance...")
            try:
                df = fetch_ticker_yfinance(ticker, start_date, end_date)
                print(f"[DATA] {ticker} successfully downloaded via yfinance (fallback)")
                return df
            except Exception as e2:
                print(f"[ERROR] yfinance fallback failed for {ticker}: {e2}")
                raise e2
    else:
        try:
            df = fetch_ticker_yfinance(ticker, start_date, end_date)
            print(f"[DATA] {ticker} successfully downloaded via yfinance")
            return df
        except Exception as e:
            print(f"[WARN] yfinance failed for {ticker}: {e}. Falling back to FMP...")
            try:
                df = fetch_ticker_fmp(ticker, start_date, apikey)
                print(f"[DATA] {ticker} successfully downloaded via FMP (fallback)")
                return df
            except Exception as e2:
                print(f"[ERROR] FMP fallback failed for {ticker}: {e2}")
                raise e2

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────
TICKERS = [
    # US Tech Momentum Leaders
    "NVDA", "AAPL", "MSFT", "TSLA", "AMD", "META", "AMZN", "AVGO", "NFLX", "SMCI",
    # Nifty Momentum Giants
    "RELIANCE.NS", "TATAMOTORS.NS", "TRENT.NS", "HAL.NS", "MAZDOCK.NS", "BEL.NS", "ADANIPORTS.NS", "PFC.NS", "RECLTD.NS", "TCS.NS",
    # Original List
    "AUBANK.NS","ABCAPITAL.NS","ANANDRATHI.NS","ASIANPAINT.NS","ASTERDM.NS",
    "BSE.NS","BAJFINANCE.NS","BHARTIARTL.NS","CANBK.NS","CHOLAFIN.NS",
    "CUB.NS","CUMMINSIND.NS","EICHERMOT.NS","FEDERALBNK.NS","FORTIS.NS",
    "GMRINFRA.NS","GMDC.NS","HBLENGINE.NS","HEROMOTOCO.NS","HINDALCO.NS",
    "INDIANB.NS","INDIGO.NS","KARURVYSYA.NS","LAURUSLABS.NS","M&M.NS",
    "MARUTI.NS","MUTHOOTFIN.NS","PTCIL.NS","RBLBANK.NS","SHRIRAMFIN.NS",
    "TVSMOTOR.NS","UPL.NS"
]

FETCH_START   = "2019-01-01"
BACKTEST_FROM = "2020-01-01"
BACKTEST_TO   = "2025-05-31"

def download_all_data(tickers, start_date, end_date, apikey, primary_source="fmp"):
    data_dict = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        future_to_ticker = {
            executor.submit(fetch_ticker_data, t, start_date, end_date, apikey, primary_source): t 
            for t in tickers
        }
        for future in concurrent.futures.as_completed(future_to_ticker):
            t = future_to_ticker[future]
            try:
                df = future.result()
                data_dict[t] = df
            except Exception as e:
                print(f"[CRITICAL] Failed to fetch data for {t}: {e}")
    return data_dict
