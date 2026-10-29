// Port of quantforge/live/costs.py: Zerodha NSE equity intraday charges (zerodha.com/charges, Oct 2026).
export const r2 = (x) => Math.floor(x * 100 + 0.5 + 1e-9) / 100;

export function intradayCharges(buyValue, sellValue) {
  const turnover = buyValue + sellValue;
  const brokerage = r2(Math.min(buyValue * 0.0003, 20) + Math.min(sellValue * 0.0003, 20));
  const stt = r2(sellValue * 0.00025);
  const transaction = r2(turnover * 0.0000307);
  const sebi = r2(turnover * (10 / 1e7));
  const ipft = r2(turnover * (0.01 / 1e7));
  const gst = r2((brokerage + sebi + transaction + ipft) * 0.18);
  const stamp = r2(buyValue * 0.00003);
  const total = r2(brokerage + stt + transaction + sebi + ipft + gst + stamp);
  return { brokerage, stt, transaction, sebi, ipft, gst, stamp, total };
}
