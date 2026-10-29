"""Zerodha equity intraday (MIS) charges on NSE, from zerodha.com/charges (checked Oct 2026).

Each component is rounded to the paisa, as Zerodha's own contract notes and calculator do.
web/src/live/costs.js is an exact port.
"""
from __future__ import annotations

import math

BROKERAGE_RATE = 0.0003       # 0.03% per executed order ...
BROKERAGE_CAP = 20.0          # ... or Rs 20, whichever is lower
STT_SELL = 0.00025            # 0.025% on the sell side only
NSE_TXN = 0.0000307           # 0.00307% of turnover
SEBI = 10 / 1e7               # Rs 10 per crore
IPFT = 0.01 / 1e7             # Rs 0.01 per crore
GST = 0.18                    # on brokerage + SEBI + transaction + IPFT
STAMP_BUY = 0.00003           # 0.003% on the buy side only


def r2(x: float) -> float:
    """Round half up to 2 decimals, identical in Python and JavaScript."""
    return math.floor(x * 100 + 0.5 + 1e-9) / 100


def intraday_charges(buy_value: float, sell_value: float) -> dict:
    """Charges for one round trip: one buy order and one sell order."""
    turnover = buy_value + sell_value
    brokerage = r2(min(buy_value * BROKERAGE_RATE, BROKERAGE_CAP) + min(sell_value * BROKERAGE_RATE, BROKERAGE_CAP))
    stt = r2(sell_value * STT_SELL)
    txn = r2(turnover * NSE_TXN)
    sebi = r2(turnover * SEBI)
    ipft = r2(turnover * IPFT)
    gst = r2((brokerage + sebi + txn + ipft) * GST)
    stamp = r2(buy_value * STAMP_BUY)
    total = r2(brokerage + stt + txn + sebi + ipft + gst + stamp)
    return {"brokerage": brokerage, "stt": stt, "transaction": txn, "sebi": sebi, "ipft": ipft,
            "gst": gst, "stamp": stamp, "total": total}
