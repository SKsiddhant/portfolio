import { useEffect, useMemo, useRef, useState } from "react";
import Controls from "./components/Controls.jsx";
import LiveView from "./components/LiveView.jsx";
import Charts from "./components/Charts.jsx";
import { MonteCarloPanel, SweepPanel, TradesPanel, WalkForwardPanel } from "./components/Research.jsx";
import { backtest } from "./engine/analysis.js";
import { byKey, defaults } from "./engine/strategies.js";
import { DEFAULT_CONFIG } from "./engine/backtest.js";
import { num, pct, rupees, tone } from "./lib/format.js";

const TABS = [
  ["sweep", "Parameter map"],
  ["walk", "Walk-forward"],
  ["mc", "Monte Carlo"],
  ["trades", "Trades"],
];

/* ---------- shareable state in the URL hash ---------- */
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const s = byKey[h.get("s")] ? h.get("s") : "donchian";
  const params = { ...defaults(s) };
  for (const kv of (h.get("p") || "").split(",")) {
    const [k, v] = kv.split(":");
    if (k in params && Number.isFinite(Number(v))) params[k] = Number(v);
  }
  const cfg = { ...DEFAULT_CONFIG };
  for (const key of ["fee_bps", "slippage_bps", "stop_loss_pct", "initial_capital"]) {
    const v = Number(h.get(key));
    if (h.has(key) && Number.isFinite(v)) cfg[key] = v;
  }
  cfg.allow_short = h.get("short") === "1";
  return { market: h.get("m") || "trending", strategy: s, params, config: cfg };
}

function writeHash(market, strategy, params, cfg) {
  const h = new URLSearchParams();
  h.set("m", market);
  h.set("s", strategy);
  const p = Object.entries(params).map(([k, v]) => `${k}:${v}`).join(",");
  if (p) h.set("p", p);
  for (const key of ["fee_bps", "slippage_bps", "stop_loss_pct", "initial_capital"]) {
    if (cfg[key] !== DEFAULT_CONFIG[key]) h.set(key, cfg[key]);
  }
  if (cfg.allow_short) h.set("short", "1");
  history.replaceState(null, "", `#${h}`);
}

/* ---------- worker for the heavy research jobs ---------- */
function useResearch() {
  const worker = useRef(null);
  const pending = useRef(new Map());
  useEffect(() => {
    worker.current = new Worker(new URL("./engine/worker.js", import.meta.url), { type: "module" });
    worker.current.onmessage = ({ data }) => {
      const cb = pending.current.get(data.id);
      pending.current.delete(data.id);
      cb?.(data);
    };
    return () => worker.current.terminate();
  }, []);
  return (msg) =>
    new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      pending.current.set(id, resolve);
      worker.current.postMessage({ ...msg, id });
    });
}

function ModeSwitch({ mode, setMode }) {
  return (
    <div className="brand-block">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 22 14" aria-hidden="true">
          <path d="M1 12 L6 7 L10 9 L15 3 L21 5" fill="none" stroke="var(--gain)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <h1>QuantForge</h1>
      </div>
      <nav className="segmented mode" aria-label="Mode">
        <button aria-pressed={mode === "backtest"} onClick={() => setMode("backtest")}>Backtest</button>
        <button aria-pressed={mode === "live"} onClick={() => setMode("live")}>Live intraday</button>
      </nav>
    </div>
  );
}

export default function App() {
  const [mode, setModeRaw] = useState(location.hash.startsWith("#live") ? "live" : "backtest");
  const setMode = (m) => {
    if (m === "live") history.replaceState(null, "", "#live");
    else history.replaceState(null, "", location.pathname);
    setModeRaw(m);
  };
  const sw = <ModeSwitch mode={mode} setMode={setMode} />;
  return mode === "live" ? <LiveView modeSwitch={sw} /> : <BacktestView modeSwitch={sw} />;
}

function BacktestView({ modeSwitch }) {
  const initial = useMemo(readHash, []);
  const [markets, setMarkets] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [source, setSource] = useState(initial.market);
  const [custom, setCustom] = useState(null);
  const [strategy, setStrategyRaw] = useState(initial.strategy);
  const [params, setParams] = useState(initial.params);
  const [config, setConfig] = useState(initial.config);
  const [tab, setTab] = useState("sweep");
  const [research, setResearch] = useState({});
  const [server, setServer] = useState(false);
  const [engine, setEngine] = useState("browser");
  const [serverResult, setServerResult] = useState(null);
  const ask = useResearch();

  useEffect(() => {
    fetch("data/markets.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((m) => {
        setMarkets(m);
        setSource((s) => (m[s] ? s : "trending"));
      })
      .catch((e) => setLoadError(`Could not load the sample markets (${e.message}). Load a CSV to continue.`));
    // GitHub Pages has no backend; only look for the Python server when self-hosted
    if (!location.hostname.endsWith("github.io")) {
      fetch("api/health")
        .then((r) => r.ok && r.json())
        .then((j) => j?.engine === "python" && setServer(true))
        .catch(() => {});
    }
  }, []);

  const setStrategy = (s) => {
    setStrategyRaw(s);
    setParams(defaults(s));
  };

  const dataset = source === "csv" ? custom : markets?.[source] && { name: markets[source].name, data: markets[source].data };
  const data = dataset?.data;

  useEffect(() => {
    if (source !== "csv") writeHash(source, strategy, params, config);
  }, [source, strategy, params, config]);

  const result = useMemo(() => (data ? backtest(data, strategy, params, config) : null), [data, strategy, params, config]);

  // optional: re-run on the Python engine and show that both agree
  useEffect(() => {
    if (engine !== "python" || !data) return setServerResult(null);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch("api/backtest", {
        method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, strategy, params, config }),
      })
        .then((r) => r.json())
        .then((j) => setServerResult(j.error ? { error: j.error } : j))
        .catch((e) => e.name !== "AbortError" && setServerResult({ error: e.message }));
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [engine, data, strategy, params, config]);

  const shown = engine === "python" && serverResult && !serverResult.error ? serverResult : result;
  const parity = useMemo(() => {
    if (!serverResult || serverResult.error || !result) return null;
    let worst = 0;
    result.equity.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - serverResult.equity[i]) / v)));
    return worst;
  }, [serverResult, result]);

  // research jobs key off everything except the two swept parameters
  const strat = byKey[strategy];
  const fixedParams = Object.fromEntries(Object.entries(params).filter(([k]) => !strat.sweep.includes(k)));
  const jobKey = JSON.stringify([source, custom?.name, strategy, fixedParams, config]);
  useEffect(() => {
    if (!data || !strat.params.length || (tab !== "sweep" && tab !== "walk")) return;
    if (research[`${tab}|${jobKey}`]) return;
    let live = true;
    const msg = tab === "sweep"
      ? { kind: "sweep", data, strategy, params: fixedParams, config }
      : { kind: "walk", data, strategy, params: fixedParams, config, folds: 5 };
    ask(msg).then((r) => live && setResearch((prev) => ({ ...prev, [`${tab}|${jobKey}`]: r })));
    return () => {
      live = false;
    };
  }, [tab, jobKey, data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!markets && !custom) {
    return (
      <div className="shell">
        <main className="main">{loadError ? <p className="error">{loadError}</p> : <p className="busy">Loading markets…</p>}</main>
      </div>
    );
  }

  const m = shown?.metrics;
  const b = shown?.benchmark.metrics;
  const cap = config.initial_capital;
  const job = research[`${tab}|${jobKey}`];

  return (
    <div className="shell">
      <Controls
        modeSwitch={modeSwitch}
        markets={markets || {}} source={source} setSource={setSource}
        onCsv={(c) => {
          setCustom(c);
          setSource("csv");
        }}
        strategy={strategy} setStrategy={setStrategy} params={params} setParams={setParams} config={config} setConfig={setConfig}
      />
      <main className="main">
        <div className="topbar">
          <span className="dataset">
            {dataset.name}: {data.date[0]} to {data.date[data.date.length - 1]}, {data.date.length.toLocaleString("en-IN")} bars
          </span>
          {server && (
            <span style={{ display: "flex", alignItems: "center" }}>
              <span className="engine-switch" role="group" aria-label="Engine">
                <button aria-pressed={engine === "browser"} onClick={() => setEngine("browser")}>Browser</button>
                <button aria-pressed={engine === "python"} onClick={() => setEngine("python")}>Python</button>
              </span>
              {engine === "python" && (
                <span className="parity">
                  {serverResult?.error ? `Server error: ${serverResult.error}` : parity == null ? "Running on Python…" : parity === 0 ? "matches the browser engine exactly" : `matches the browser engine to ${parity.toExponential(0)}`}
                </span>
              )}
            </span>
          )}
        </div>

        {m && <Verdict name={strat.name} cap={cap} m={m} b={b} isBench={strategy === "buy_hold"} />}

        <Charts data={data} result={shown} showBenchmark={strategy !== "buy_hold"} />

        {m && (
          <dl className="ledger">
            <Cell label="Yearly growth" v={pct(m.cagr)} cls={tone(m.cagr)} bench={pct(b.cagr)} />
            <Cell label="Sharpe" v={num(m.sharpe)} cls={tone(m.sharpe)} bench={num(b.sharpe)} />
            <Cell label="Sortino" v={num(m.sortino)} bench={num(b.sortino)} />
            <Cell label="Worst fall" v={pct(m.max_drawdown)} cls="neg" bench={pct(b.max_drawdown)} />
            <Cell label="Win rate" v={pct(m.win_rate, 0)} />
            <Cell label="Profit factor" v={num(m.profit_factor)} />
            <Cell label="Trades" v={m.trades} note={m.avg_bars_held ? `${Math.round(m.avg_bars_held)} bars avg` : ""} />
            <Cell label="Time in market" v={pct(m.exposure, 0)} />
          </dl>
        )}

        <div className="tabs" role="tablist" aria-label="Analysis">
          {TABS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} aria-controls="panel" id={`tab-${key}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        <section className="panel" role="tabpanel" id="panel" aria-labelledby={`tab-${tab}`}>
          {tab === "trades" && <TradesPanel trades={shown.trades} />}
          {tab === "mc" && <MonteCarloPanel mc={shown.monte_carlo} capital={cap} />}
          {(tab === "sweep" || tab === "walk") && !strat.params.length && (
            <p className="panel-intro">Buy &amp; hold has no settings to tune. Pick another strategy to map its parameters.</p>
          )}
          {(tab === "sweep" || tab === "walk") && strat.params.length > 0 && (
            !job ? <p className="busy">Running {tab === "sweep" ? "144 backtests" : "the walk-forward"}…</p>
              : job.error ? <p className="error">{job.error}</p>
                : tab === "sweep" ? <SweepPanel sweep={job.result} params={params} onPick={(p) => setParams({ ...params, ...p })} />
                  : <WalkForwardPanel wf={job.result} n={data.close.length} />
          )}
        </section>

        <p className="footer">
          The three sample markets are generated by a seeded regime-switching model, not real prices. Load a CSV to test a real
          instrument. Results include brokerage and slippage on every fill. This is a research tool, not investment advice.
          The engine is written in Python and ported to JavaScript; tests check both give identical results.{" "}
          <a href="https://github.com/SKsiddhant/portfolio/tree/main/quantforge">Source on GitHub</a>
        </p>
      </main>
    </div>
  );
}

function Cell({ label, v, cls = "", bench, note }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={cls}>
        {v}
        {(bench || note) && <small>{bench ? `buy & hold ${bench}` : note}</small>}
      </dd>
    </div>
  );
}

function Verdict({ name, cap, m, b, isBench }) {
  const up = m.final_equity >= cap;
  const betterRisk = m.sharpe > b.sharpe;
  const shallower = m.max_drawdown > b.max_drawdown;
  let judgement = "";
  if (!isBench) {
    if (betterRisk && shallower) judgement = `It beat buy and hold on risk: a higher Sharpe (${num(m.sharpe)} against ${num(b.sharpe)}) and a shallower worst fall.`;
    else if (betterRisk) judgement = `Its Sharpe of ${num(m.sharpe)} beats buy and hold's ${num(b.sharpe)}, but the deepest fall was worse.`;
    else if (shallower) judgement = `It fell less than the market, but buy and hold still earned more per unit of risk (Sharpe ${num(b.sharpe)} against ${num(m.sharpe)}).`;
    else judgement = `Buy and hold was better on every count. Try another strategy, or check the parameter map.`;
  }
  return (
    <section className="verdict" aria-live="polite">
      <p className="headline">
        {name} turned {rupees(cap)} into <span className={`amt ${up ? "up" : "down"}`}>{rupees(m.final_equity)}</span>.
      </p>
      <p className="sub">
        {isBench
          ? `The worst fall from a peak along the way was ${pct(Math.abs(m.max_drawdown))}.`
          : `Its worst fall from a peak was ${pct(Math.abs(m.max_drawdown))}. Simply holding would have ended at ${rupees(b.final_equity)}, with a ${pct(Math.abs(b.max_drawdown))} fall along the way. ${judgement}`}
      </p>
    </section>
  );
}
