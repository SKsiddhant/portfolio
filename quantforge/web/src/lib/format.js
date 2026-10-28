const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export const rupees = (x) => (x == null || !Number.isFinite(x) ? "—" : inr.format(x));
export const pct = (x, d = 1, sign = false) =>
  x == null || !Number.isFinite(x) ? "—" : `${sign && x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(d)}%`;
export const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : `${x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}`);
export const tone = (x) => (x == null ? "" : x >= 0 ? "pos" : "neg");

/** Read the current CSS tokens so the canvas charts follow the light / blueprint themes. */
export function themeColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name) => s.getPropertyValue(name).trim();
  return {
    paper: v("--paper-raised"), grid: v("--grid"), gridStrong: v("--grid-strong"), ink: v("--ink"),
    inkSoft: v("--ink-soft"), gain: v("--gain"), loss: v("--loss"), bench: v("--bench"),
    gainWash: v("--gain-wash"), lossWash: v("--loss-wash"),
  };
}
