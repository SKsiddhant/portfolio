import { useEffect, useMemo, useRef } from "react";
import { createChart, CrosshairMode, LineStyle, PriceScaleMode } from "lightweight-charts";
import { dateKey } from "../engine/csv.js";
import { themeColors } from "../lib/format.js";

/** lightweight-charts needs strictly increasing times; fall back to synthetic days for odd CSVs. */
function timeAxis(dates) {
  const keys = dates.map(dateKey);
  const iso = keys.every((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
  const increasing = keys.every((k, i) => i === 0 || k > keys[i - 1]);
  if (iso && increasing) return keys;
  const base = Date.UTC(2000, 0, 3) / 1000;
  return dates.map((_, i) => base + i * 86400);
}

const plain = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const FORMATTERS = {
  price: (v) => plain.format(v),
  // Indian notation for portfolio value: ₹4.3L, ₹1.2Cr
  money: (v) => (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : `₹${plain.format(Math.round(v))}`),
  pct: (v) => `${v.toFixed(1)}%`,
};

function baseOptions(c, height, kind) {
  return {
    height,
    layout: { background: { color: "transparent" }, textColor: c.inkSoft, fontFamily: "Archivo, system-ui, sans-serif", fontSize: 11 },
    localization: { priceFormatter: FORMATTERS[kind], locale: "en-IN" },
    // the graph paper behind the canvas is the grid
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { borderColor: c.gridStrong },
    timeScale: { borderColor: c.gridStrong, rightOffset: 4, minBarSpacing: 0.05 },
    crosshair: { mode: CrosshairMode.Normal },
    handleScale: { axisPressedMouseMove: true },
  };
}

export default function Charts({ data, result, showBenchmark = true }) {
  const priceEl = useRef(null);
  const equityEl = useRef(null);
  const ddEl = useRef(null);
  const charts = useRef(null);
  const needsFit = useRef(true);
  const times = useMemo(() => timeAxis(data.date), [data]);

  // create once
  useEffect(() => {
    const c = themeColors();
    const price = createChart(priceEl.current, baseOptions(c, priceEl.current.clientHeight, "price"));
    const equity = createChart(equityEl.current, baseOptions(c, equityEl.current.clientHeight, "money"));
    const dd = createChart(ddEl.current, baseOptions(c, ddEl.current.clientHeight, "pct"));
    const series = {
      candles: price.addCandlestickSeries({ priceLineVisible: false }),
      strat: equity.addLineSeries({ lineWidth: 2, priceLineVisible: false, lastValueVisible: true }),
      bench: equity.addLineSeries({ lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }),
      dd: dd.addAreaSeries({ lineWidth: 1, priceLineVisible: false }),
    };
    const all = [price, equity, dd];
    // keep the three panels scrolled and zoomed together
    let syncing = false;
    all.forEach((ch) =>
      ch.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncing || !range) return;
        syncing = true;
        all.forEach((other) => other !== ch && other.timeScale().setVisibleLogicalRange(range));
        syncing = false;
      }),
    );

    const applyTheme = () => {
      const t = themeColors();
      const kinds = ["price", "money", "pct"];
      all.forEach((ch, i) => ch.applyOptions(baseOptions(t, [priceEl, equityEl, ddEl][i].current.clientHeight, kinds[i])));
      series.candles.applyOptions({
        upColor: t.gain, downColor: t.loss, borderUpColor: t.gain, borderDownColor: t.loss,
        wickUpColor: t.gain, wickDownColor: t.loss,
      });
      series.strat.applyOptions({ color: t.gain });
      series.bench.applyOptions({ color: t.bench });
      series.dd.applyOptions({ lineColor: t.loss, topColor: t.lossWash, bottomColor: t.lossWash });
    };
    applyTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", applyTheme);
    const ro = new ResizeObserver(() =>
      all.forEach((ch, i) => {
        const el = [priceEl, equityEl, ddEl][i].current;
        ch.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      }),
    );
    [priceEl, equityEl, ddEl].forEach((r) => ro.observe(r.current));
    // prices and portfolio value compound, so a log scale shows each year fairly
    price.priceScale("right").applyOptions({ mode: PriceScaleMode.Logarithmic });
    equity.priceScale("right").applyOptions({ mode: PriceScaleMode.Logarithmic });
    dd.priceScale("right").applyOptions({ scaleMargins: { top: 0.12, bottom: 0.04 } });
    charts.current = { all, series, applyTheme };
    return () => {
      mq.removeEventListener("change", applyTheme);
      ro.disconnect();
      all.forEach((ch) => ch.remove());
      charts.current = null;
    };
  }, []);

  // data changes: refit
  useEffect(() => {
    const { series, all } = charts.current;
    series.candles.setData(
      data.close.map((cl, i) => ({ time: times[i], open: data.open[i], high: data.high[i], low: data.low[i], close: cl })),
    );
    needsFit.current = true;
  }, [data, times]);

  // result changes: redraw lines + markers without touching zoom
  useEffect(() => {
    if (!result) return;
    const { series } = charts.current;
    const t = themeColors();
    series.strat.setData(result.equity.map((v, i) => ({ time: times[i], value: v })));
    series.bench.setData(showBenchmark ? result.benchmark.equity.map((v, i) => ({ time: times[i], value: v })) : []);
    series.dd.setData(result.drawdown.map((v, i) => ({ time: times[i], value: v * 100 })));
    const markers = [];
    for (const tr of result.trades) {
      const long = tr.side === "long";
      markers.push({
        time: times[tr.entry_index],
        position: long ? "belowBar" : "aboveBar",
        color: long ? t.gain : t.loss,
        shape: long ? "arrowUp" : "arrowDown",
      });
      if (tr.reason !== "open") {
        markers.push({
          time: times[tr.exit_index],
          position: long ? "aboveBar" : "belowBar",
          color: tr.reason === "stop" ? t.loss : t.inkSoft,
          shape: tr.reason === "stop" ? "square" : "circle",
          text: tr.reason === "stop" ? "stop" : "",
        });
      }
    }
    markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    series.candles.setMarkers(markers);
    if (needsFit.current) {
      // fit once every series has data, so the empty panels cannot pull the zoom back in
      charts.current.all.forEach((ch) => ch.timeScale().fitContent());
      needsFit.current = false;
    }
  }, [result, times, showBenchmark]);

  return (
    <div className="charts">
      <div className="chart-label">
        <span>Price with every entry and exit</span>
        <span className="key"><span className="swatch" style={{ background: "var(--gain)" }} />long entry</span>
        <span className="key"><span className="swatch" style={{ background: "var(--loss)" }} />short entry or stop</span>
      </div>
      <div ref={priceEl} className="chart-box graph-paper" />
      <div className="chart-label">
        <span>Portfolio value</span>
        <span className="key"><span className="swatch" style={{ background: "var(--gain)" }} />strategy</span>
        <span className="key"><span className="swatch" style={{ background: "var(--bench)" }} />buy &amp; hold</span>
      </div>
      <div ref={equityEl} className="chart-box graph-paper" />
      <div className="chart-label"><span>Distance below the previous peak (%)</span></div>
      <div ref={ddEl} className="chart-box small graph-paper" />
    </div>
  );
}
