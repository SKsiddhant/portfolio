import { pct, num, rupees, tone } from "../lib/format.js";

/* ------------------------------------------------------------ parameter map */

export function Heatmap({ sweep, current, onPick }) {
  const { x, y, cells } = sweep;
  const cw = 54;
  const ch = 30;
  const left = 58;
  const top = 8;
  const W = left + x.values.length * cw + 4;
  const H = top + y.values.length * ch + 40;
  const flat = cells.flat().filter(Boolean).map((c) => c.sharpe);
  const best = Math.max(...flat);
  const scale = Math.max(1, ...flat.map(Math.abs));
  const fmt = (v) => (Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, ""));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label="Sharpe ratio for every parameter combination">
      {y.values.map((yv, i) => (
        <text key={`y${i}`} x={left - 8} y={top + i * ch + ch / 2 + 4} textAnchor="end">{fmt(yv)}</text>
      ))}
      {x.values.map((xv, j) => (
        <text key={`x${j}`} x={left + j * cw + cw / 2} y={top + y.values.length * ch + 16} textAnchor="middle">{fmt(xv)}</text>
      ))}
      <text x={left + (x.values.length * cw) / 2} y={H - 4} textAnchor="middle">{x.label}</text>
      <text x={12} y={top + (y.values.length * ch) / 2} textAnchor="middle" transform={`rotate(-90 12 ${top + (y.values.length * ch) / 2})`}>{y.label}</text>
      {cells.map((row, i) =>
        row.map((c, j) => {
          const px = left + j * cw;
          const py = top + i * ch;
          if (!c) {
            return <rect key={`${i}-${j}`} x={px + 1} y={py + 1} width={cw - 2} height={ch - 2} fill="none" stroke="var(--line)" strokeDasharray="2 3" />;
          }
          const isCur = current[x.key] === x.values[j] && current[y.key] === y.values[i];
          const strength = Math.min(1, Math.abs(c.sharpe) / scale);
          const label = `${x.label} ${fmt(x.values[j])}, ${y.label} ${fmt(y.values[i])}: Sharpe ${num(c.sharpe)}, return ${pct(c.total_return)}, ${c.trades} trades`;
          return (
            <g
              key={`${i}-${j}`}
              className="heat-cell"
              tabIndex={0}
              role="button"
              aria-label={label}
              onClick={() => onPick({ [x.key]: x.values[j], [y.key]: y.values[i] })}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick({ [x.key]: x.values[j], [y.key]: y.values[i] }))}
            >
              <title>{label}</title>
              <rect x={px + 1} y={py + 1} width={cw - 2} height={ch - 2} rx="2"
                style={{ fill: c.sharpe >= 0 ? "var(--gain)" : "var(--loss)", fillOpacity: 0.1 + 0.8 * strength }}
                stroke={isCur ? "var(--ink)" : "none"} strokeWidth={isCur ? 2.5 : 0} />
              <text x={px + cw / 2} y={py + ch / 2 + 4} textAnchor="middle"
                style={{ fill: strength > 0.55 ? "var(--paper-raised)" : "var(--ink)", fontWeight: c.sharpe === best ? 800 : 500 }}>
                {num(c.sharpe)}
              </text>
            </g>
          );
        }),
      )}
    </svg>
  );
}

export function SweepPanel({ sweep, params, onPick }) {
  const cells = sweep.cells.flat().filter(Boolean);
  const positive = cells.filter((c) => c.sharpe > 0).length;
  const share = positive / cells.length;
  const bestCell = cells.reduce((a, b) => (b.sharpe > a.sharpe ? b : a));
  return (
    <div className="split">
      <figure className="figure" style={{ margin: 0 }}>
        <div className="heat-scroll">
          <Heatmap sweep={sweep} current={params} onPick={onPick} />
        </div>
        <figcaption>Sharpe ratio for each combination. Click a cell to load it. The outlined cell is what you are running now.</figcaption>
      </figure>
      <div>
        <dl className="facts">
          <dt>Combinations tested</dt><dd>{cells.length}</dd>
          <dt>Profitable on risk-adjusted terms</dt><dd className={tone(share - 0.5)}>{pct(share, 0)}</dd>
          <dt>Best Sharpe</dt><dd>{num(bestCell.sharpe)}</dd>
          <dt>Best total return</dt><dd>{pct(Math.max(...cells.map((c) => c.total_return)))}</dd>
        </dl>
        <p className={`callout ${share < 0.5 ? "warn" : ""}`}>
          {share >= 0.7
            ? "Most of the map is profitable, so the edge does not hinge on one lucky setting. That is what a robust strategy looks like."
            : share >= 0.4
              ? "Results swing a lot with the settings. Prefer a cell inside a broad profitable patch over the single best number."
              : "Only a few settings work. Picking the best cell here is curve-fitting: check the walk-forward tab before trusting it."}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ walk-forward */

function Spark({ values, height = 160, color = "var(--gain)", baseline }) {
  const W = 600;
  const lo = Math.min(...values, baseline ?? Infinity);
  const hi = Math.max(...values, baseline ?? -Infinity);
  const sy = (v) => height - 8 - ((v - lo) / (hi - lo || 1)) * (height - 16);
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(1)},${sy(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" preserveAspectRatio="none" aria-hidden="true" className="graph-paper" style={{ borderRadius: 6 }}>
      {baseline != null && <line x1="0" x2={W} y1={sy(baseline)} y2={sy(baseline)} stroke="var(--ink-faint)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function FoldTimeline({ wf, n }) {
  const W = 600;
  const rowH = 12;
  const trainLen = wf.folds[0].test_index[0];
  const step = wf.folds.length > 1 ? wf.folds[1].test_index[0] - wf.folds[0].test_index[0] : 0;
  const sx = (i) => (i / (n - 1)) * W;
  return (
    <figure style={{ margin: "0 0 18px" }}>
      <svg viewBox={`0 0 ${W} ${wf.folds.length * rowH + 4}`} width="100%" aria-label="Training and unseen windows for each fold">
        {wf.folds.map((f, i) => {
          const trS = i * step;
          const y = i * rowH + 2;
          return (
            <g key={f.fold}>
              <rect x={sx(trS)} y={y} width={sx(trS + trainLen) - sx(trS)} height={rowH - 4} rx="2" style={{ fill: "var(--grid-strong)" }} />
              <rect x={sx(f.test_index[0])} y={y} width={sx(f.test_index[1]) - sx(f.test_index[0])} height={rowH - 4} rx="2"
                style={{ fill: f.oos_return >= 0 ? "var(--gain)" : "var(--loss)" }} />
            </g>
          );
        })}
      </svg>
      <figcaption style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
        Grey: training window. Coloured: the unseen window that follows, blue if it made money, red if it lost.
      </figcaption>
    </figure>
  );
}

export function WalkForwardPanel({ wf, n }) {
  const eff = wf.efficiency;
  const m = wf.oos_metrics;
  return (
    <div>
      <p className="panel-intro">
        Each fold tunes the parameters on the shaded training window, then trades the next window it has never seen.
        Stitching the unseen windows together is the closest a backtest gets to live trading.
      </p>
      <FoldTimeline wf={wf} n={n} />
      <div className="table-scroll" style={{ maxHeight: "none" }}>
        <table className="grid-table">
          <thead>
            <tr><th>Fold</th><th>Trained on</th><th>Traded unseen</th><th>Chosen settings</th><th>Training Sharpe</th><th>Unseen Sharpe</th><th>Unseen return</th></tr>
          </thead>
          <tbody>
            {wf.folds.map((f) => (
              <tr key={f.fold}>
                <td>{f.fold}</td>
                <td>{f.train[0]} to {f.train[1]}</td>
                <td>{f.test[0]} to {f.test[1]}</td>
                <td>{Object.entries(f.params).map(([k, v]) => `${k} ${v}`).join(", ")}</td>
                <td>{num(f.in_sample_sharpe)}</td>
                <td className={tone(f.oos_sharpe)}>{num(f.oos_sharpe)}</td>
                <td className={tone(f.oos_return)}>{pct(f.oos_return)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="split" style={{ marginTop: 22 }}>
        <figure className="figure" style={{ margin: 0 }}>
          <Spark values={wf.oos_equity} baseline={wf.oos_equity[0]} color={m.total_return >= 0 ? "var(--gain)" : "var(--loss)"} />
          <figcaption>Portfolio value across the unseen windows only ({wf.oos_equity.length - 1} of {n - 1} bars).</figcaption>
        </figure>
        <div>
          <dl className="facts">
            <dt>Unseen return</dt><dd className={tone(m.total_return)}>{pct(m.total_return)}</dd>
            <dt>Unseen Sharpe</dt><dd className={tone(m.sharpe)}>{num(m.sharpe)}</dd>
            <dt>Average training Sharpe</dt><dd>{num(wf.in_sample_sharpe)}</dd>
            <dt>Worst fall from peak</dt><dd className="neg">{pct(m.max_drawdown)}</dd>
            <dt>Walk-forward efficiency</dt><dd>{eff == null ? "—" : pct(eff, 0)}</dd>
          </dl>
          <p className={`callout ${eff == null || eff < 0.5 ? "warn" : ""}`}>
            {eff == null
              ? "Training never found a setting with a positive Sharpe, so there is nothing to carry forward."
              : eff >= 0.5
                ? "Unseen results keep at least half of the training performance. The tuning is finding something real."
                : "Performance collapses on unseen data. The training results were mostly noise that the optimiser fitted."}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ monte carlo */

export function MonteCarloPanel({ mc, capital }) {
  if (!mc) {
    return <p className="panel-intro">Monte Carlo needs at least three closed trades. Loosen the settings or pick a longer dataset.</p>;
  }
  const W = 600;
  const H = 220;
  const allPts = mc.paths.flat();
  const lo = Math.min(...allPts, 1);
  const hi = Math.max(...allPts, 1);
  const sy = (v) => H - 10 - ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo) || 1)) * (H - 20);
  const k = mc.trades_per_sim;
  const maxCount = Math.max(...mc.histogram.counts);
  const fr = mc.final_return;
  const dd = mc.max_drawdown;
  return (
    <div>
      <p className="panel-intro">
        The same {k} trades, replayed {mc.sims.toLocaleString("en-IN")} times in random order with repeats.
        If the outcome depends heavily on the order, the backtest got lucky.
      </p>
      <div className="split">
        <figure className="figure" style={{ margin: 0 }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" className="graph-paper" style={{ borderRadius: 6 }} aria-label="Forty sample replays of the trade sequence">
            <line x1="0" x2={W} y1={sy(1)} y2={sy(1)} stroke="var(--ink-faint)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            {mc.paths.map((p, i) => (
              <path key={i} fill="none" vectorEffect="non-scaling-stroke"
                stroke={p[p.length - 1] >= 1 ? "var(--gain)" : "var(--loss)"} strokeOpacity="0.35" strokeWidth="1.2"
                d={p.map((v, j) => `${j ? "L" : "M"}${((j / k) * W).toFixed(1)},${sy(v).toFixed(1)}`).join("")} />
            ))}
          </svg>
          <figcaption>Forty of the replays, plotted on a log scale. Dashed line is break-even.</figcaption>
          <svg viewBox="0 0 600 90" width="100%" style={{ marginTop: 14 }} aria-label="Distribution of final returns">
            {mc.histogram.counts.map((c, i) => {
              const left = mc.histogram.start + i * mc.histogram.width;
              const h = (c / maxCount) * 70;
              return <rect key={i} x={i * 20 + 1} y={74 - h} width="18" height={h} style={{ fill: left + mc.histogram.width / 2 >= 0 ? "var(--gain)" : "var(--loss)", fillOpacity: 0.7 }} />;
            })}
            <text x="0" y="88">{pct(Math.expm1(mc.histogram.start), 0)}</text>
            <text x="600" y="88" textAnchor="end">{pct(Math.expm1(mc.histogram.start + mc.histogram.width * mc.histogram.counts.length), 0)}</text>
          </svg>
          <figcaption>Where the {mc.sims.toLocaleString("en-IN")} replays finished, on a log scale.</figcaption>
        </figure>
        <div>
          <table className="grid-table">
            <thead><tr><th>Outcome</th><th>Final value</th><th>Return</th><th>Worst fall</th></tr></thead>
            <tbody>
              {[["Bad luck (5th)", "p5"], ["Below typical", "p25"], ["Typical (median)", "p50"], ["Above typical", "p75"], ["Good luck (95th)", "p95"]].map(([label, key]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>{rupees(capital * (1 + fr[key]))}</td>
                  <td className={tone(fr[key])}>{pct(fr[key])}</td>
                  <td className="neg">{pct(dd[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`callout ${mc.prob_loss > 0.2 ? "warn" : ""}`}>
            {pct(mc.prob_loss, 1)} of replays lost money. A fall of {pct(Math.abs(dd.p5))} or deeper from a peak happened in one replay out of twenty,
            so size positions for that, not for the backtest's single path.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ trades */

export function TradesPanel({ trades }) {
  if (!trades.length) return <p className="panel-intro">No trades. The entry condition never triggered with these settings.</p>;
  return (
    <div className="table-scroll">
      <table className="grid-table">
        <thead>
          <tr><th>Side</th><th>Entered</th><th>Entry price</th><th>Exited</th><th>Exit price</th><th>Bars held</th><th>Return</th><th>Exit reason</th></tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i}>
              <td><span className={`tag ${t.side === "short" ? "short" : ""}`}>{t.side}</span></td>
              <td>{t.entry_date}</td>
              <td>{t.entry_price.toFixed(2)}</td>
              <td>{t.reason === "open" ? "still open" : t.exit_date}</td>
              <td>{t.exit_price.toFixed(2)}</td>
              <td>{t.bars}</td>
              <td className={tone(t.return)}>{pct(t.return, 2)}</td>
              <td>{t.reason === "stop" ? <span className="tag stop">stop-loss</span> : t.reason === "open" ? "marked at last close" : "signal"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
