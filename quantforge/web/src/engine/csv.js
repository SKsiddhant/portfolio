// Port of quantforge/data.py load_csv. Handles Yahoo, NSE, TradingView and broker exports.
const ALIASES = {
  date: ["date", "datetime", "time", "timestamp", "day"],
  open: ["open", "o"],
  high: ["high", "h"],
  low: ["low", "l"],
  close: ["close", "c", "adj close", "adj_close", "ltp", "price"],
  volume: ["volume", "vol", "v", "shares traded", "qty"],
};
const REQUIRED = ["date", "open", "high", "low", "close"];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const pad = (n) => String(n).padStart(2, "0");

export function dateKey(s) {
  const t = s.trim();
  let m;
  if ((m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  if ((m = t.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$/)) && MONTHS[m[2].toLowerCase()])
    return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  if ((m = t.match(/^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/)) && MONTHS[m[1].toLowerCase()])
    return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`;
  return t;
}

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  if (lines.length < 3) throw new Error("CSV needs a header row and at least 2 data rows");
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    for (const name of names) {
      const i = header.indexOf(name);
      if (i >= 0) {
        col[field] = i;
        break;
      }
    }
  }
  const missing = REQUIRED.filter((f) => !(f in col));
  if (missing.length) throw new Error(`CSV is missing column(s): ${missing.join(", ")}`);

  const out = { date: [], open: [], high: [], low: [], close: [], volume: [] };
  const num = (s) => (s === undefined ? NaN : Number(String(s).replace(/,/g, "").trim() || NaN));
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const r = splitCsvLine(line);
    const vals = ["open", "high", "low", "close"].map((f) => num(r[col[f]]));
    if (vals.some((v) => !Number.isFinite(v))) continue;
    let vol = 1;
    if ("volume" in col && r[col.volume] !== undefined && r[col.volume].trim()) {
      vol = num(r[col.volume]);
      if (!Number.isFinite(vol)) continue;
    }
    out.date.push((r[col.date] || "").trim());
    out.open.push(vals[0]);
    out.high.push(vals[1]);
    out.low.push(vals[2]);
    out.close.push(vals[3]);
    out.volume.push(vol);
  }
  if (out.close.length < 30) throw new Error("need at least 30 valid rows of price data");
  if (dateKey(out.date[0]) > dateKey(out.date[out.date.length - 1])) for (const k in out) out[k].reverse();
  return out;
}
