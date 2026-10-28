import { useState } from "react";
import { STRATEGIES, byKey } from "../engine/strategies.js";
import { parseCsv } from "../engine/csv.js";

const FAMILIES = ["Trend", "Momentum", "Mean reversion", "Volatility", "Benchmark"];
const fmt = (v, step) => (step < 1 ? v.toFixed(step < 0.5 ? 2 : 1) : String(v));

export default function Controls({ markets, source, setSource, onCsv, strategy, setStrategy, params, setParams, config, setConfig }) {
  const [csvError, setCsvError] = useState("");
  const strat = byKey[strategy];

  const loadFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = parseCsv(await file.text());
      setCsvError("");
      onCsv({ name: file.name.replace(/\.csv$/i, ""), data });
    } catch (err) {
      setCsvError(`${file.name}: ${err.message}. Expected columns Date, Open, High, Low, Close and optionally Volume.`);
    }
  };

  const num = (key, min, max) => (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) setConfig({ ...config, [key]: Math.min(max, Math.max(min, v)) });
  };

  return (
    <aside className="rail" aria-label="Backtest settings">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 22 14" aria-hidden="true">
          <path d="M1 12 L6 7 L10 9 L15 3 L21 5" fill="none" stroke="var(--gain)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <h1>QuantForge</h1>
      </div>
      <p className="tagline">Backtest a trading idea honestly: realistic fills, costs, and tests on data the strategy has never seen.</p>

      <fieldset className="group" style={{ border: 0, padding: 0 }}>
        <h2>Market</h2>
        {Object.entries(markets).map(([key, m]) => (
          <label key={key} className={`choice ${source === key ? "is-on" : ""}`}>
            <input type="radio" name="market" checked={source === key} onChange={() => setSource(key)} />
            <span className="name">{m.name}</span>
            <span className="note">{m.blurb}</span>
          </label>
        ))}
        {source === "csv" && (
          <label className="choice is-on">
            <input type="radio" name="market" checked readOnly />
            <span className="name">Your file</span>
            <span className="note">Loaded from CSV.</span>
          </label>
        )}
        <label className="upload">
          <input type="file" accept=".csv,text/csv" onChange={loadFile} />
          Load your own OHLCV CSV (NSE, Yahoo, TradingView)
        </label>
        {csvError && <p className="error" role="alert">{csvError}</p>}
      </fieldset>

      <fieldset className="group" style={{ border: 0, padding: 0 }}>
        <h2>Strategy</h2>
        {FAMILIES.map((fam) => (
          <div key={fam}>
            <div className="family">{fam}</div>
            {STRATEGIES.filter((s) => s.family === fam).map((s) => (
              <label key={s.key} className={`choice ${strategy === s.key ? "is-on" : ""}`}>
                <input type="radio" name="strategy" checked={strategy === s.key} onChange={() => setStrategy(s.key)} />
                <span className="name">{s.name}</span>
                {strategy === s.key && <span className="note">{s.description}</span>}
              </label>
            ))}
          </div>
        ))}
      </fieldset>

      {strat.params.length > 0 && (
        <div className="group">
          <h2>Settings</h2>
          {strat.params.map((p) => (
            <div className="slider" key={p.key}>
              <div className="slider-head">
                <label htmlFor={`p-${p.key}`}>{p.label}</label>
                <output htmlFor={`p-${p.key}`}>{fmt(params[p.key], p.step)}</output>
              </div>
              <input id={`p-${p.key}`} type="range" min={p.min} max={p.max} step={p.step} value={params[p.key]}
                onChange={(e) => setParams({ ...params, [p.key]: Number(e.target.value) })} />
            </div>
          ))}
        </div>
      )}

      <div className="group">
        <h2>Costs and risk</h2>
        <div className="row2">
          <div className="field">
            <label htmlFor="fee">Brokerage (bps)</label>
            <input id="fee" type="number" min="0" max="500" step="1" value={config.fee_bps} onChange={num("fee_bps", 0, 500)} />
          </div>
          <div className="field">
            <label htmlFor="slip">Slippage (bps)</label>
            <input id="slip" type="number" min="0" max="500" step="1" value={config.slippage_bps} onChange={num("slippage_bps", 0, 500)} />
          </div>
          <div className="field">
            <label htmlFor="stop">Stop-loss %</label>
            <input id="stop" type="number" min="0" max="90" step="0.5" value={config.stop_loss_pct} onChange={num("stop_loss_pct", 0, 90)} />
          </div>
          <div className="field">
            <label htmlFor="cap">Capital (₹)</label>
            <input id="cap" type="number" min="1000" step="10000" value={config.initial_capital} onChange={num("initial_capital", 1000, 1e10)} />
          </div>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={config.allow_short} onChange={(e) => setConfig({ ...config, allow_short: e.target.checked })} />
          Allow short selling
        </label>
      </div>

      <p className="rail-foot">
        Orders are decided at the close and filled at the next open. Stop-loss 0 turns it off. 1 bp is 0.01% per side.
      </p>
    </aside>
  );
}
