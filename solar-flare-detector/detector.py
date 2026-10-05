"""Detect and classify solar X-ray bursts in a light curve.

Pipeline: smooth with a Gaussian kernel -> find peaks on the smoothed curve ->
fit a fast-rise / exponential-decay model to each burst -> report rise time,
decay time, peak flux and a GOES-style class (A, B, C, M, X).
"""
from dataclasses import dataclass, asdict
import numpy as np
from scipy.optimize import curve_fit
from scipy.signal import find_peaks


def gaussian_kernel(sigma: float) -> np.ndarray:
    radius = max(1, int(4 * sigma))
    x = np.arange(-radius, radius + 1)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    return k / k.sum()


def smooth(flux: np.ndarray, sigma: float = 3.0) -> np.ndarray:
    padded = np.pad(flux, int(4 * sigma) + 1, mode="edge")
    out = np.convolve(padded, gaussian_kernel(sigma), mode="same")
    pad = int(4 * sigma) + 1
    return out[pad:-pad]


def burst_model(t, base, amp, t0, rise, decay):
    """Gaussian-like rise before t0, exponential decay after."""
    t = np.asarray(t, dtype=float)
    return base + amp * np.where(
        t < t0, np.exp(-0.5 * ((t - t0) / rise) ** 2), np.exp(-(t - t0) / decay)
    )


def goes_class(peak_flux: float) -> str:
    """Class from peak flux in W/m^2 (GOES 1-8 angstrom convention)."""
    for letter, upper, lower in (("A", 1e-7, 1e-8), ("B", 1e-6, 1e-7), ("C", 1e-5, 1e-6), ("M", 1e-4, 1e-5)):
        if peak_flux < upper:
            return f"{letter}{max(peak_flux, lower) / lower:.1f}"
    return f"X{peak_flux / 1e-4:.1f}"


@dataclass
class Burst:
    peak_time: float
    peak_flux: float
    rise_time: float
    decay_time: float
    flare_class: str
    fit_ok: bool


def detect_bursts(time, flux, sigma=3.0, prominence_factor=4.0, window=240):
    time, flux = np.asarray(time, float), np.asarray(flux, float)
    if time.shape != flux.shape or time.size < 20:
        raise ValueError("time and flux must be equal-length arrays with at least 20 samples")
    smoothed = smooth(flux, sigma)
    noise = 1.4826 * np.median(np.abs(flux - smoothed))
    peaks, _ = find_peaks(smoothed, prominence=max(prominence_factor * noise, 1e-12))
    dt = float(np.median(np.diff(time)))
    half = max(5, int(window / dt))
    bursts = []
    for p in peaks:
        lo, hi = max(0, p - half), min(time.size, p + half)
        t, f = time[lo:hi], flux[lo:hi]
        base0 = float(np.percentile(f, 10))
        amp0 = float(smoothed[p] - base0)
        guess = [base0, amp0, time[p], 4 * dt, 12 * dt]
        try:
            popt, _ = curve_fit(burst_model, t, f, p0=guess, maxfev=4000,
                                bounds=([0, 0, t[0], dt, dt], [np.inf, np.inf, t[-1], 50 * window, 50 * window]))
            base, amp, t0, rise, decay = popt
            peak = base + amp
            ok = True
        except (RuntimeError, ValueError):
            t0, peak, rise, decay, ok = float(time[p]), float(smoothed[p]), float("nan"), float("nan"), False
        bursts.append(Burst(float(t0), float(peak), float(rise), float(decay), goes_class(float(peak)), ok))
    return smoothed, bursts


def synthetic_light_curve(seed=7, n=3600, dt=1.0, flares=4):
    """Made-up demo data: slowly drifting background, noise and a few bursts."""
    rng = np.random.default_rng(seed)
    t = np.arange(n) * dt
    flux = 2e-7 + 4e-8 * np.sin(t / 900.0) + rng.normal(0, 1.5e-8, n)
    centres = np.sort(rng.uniform(0.12, 0.88, flares)) * n * dt
    for c in centres:
        flux += burst_model(t, 0, rng.uniform(1.5e-6, 6e-5), c, rng.uniform(15, 40), rng.uniform(90, 260))
    return t, np.clip(flux, 1e-9, None)


def to_dict(bursts):
    return [asdict(b) for b in bursts]
