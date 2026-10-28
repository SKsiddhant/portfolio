"""Flask API. Serves the dashboard and exposes the Python engine over JSON.

The dashboard runs a JavaScript port of the engine in the browser (so it works on
GitHub Pages with no backend). When it is served from here, it detects /api/health
and lets you switch to this Python engine and compare the two.
"""
from __future__ import annotations

import math
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from . import STRATEGIES, Config, analysis, backtest, data as qdata

WEB_DIST = Path(__file__).resolve().parent.parent / "demo"
MAX_BARS = 20_000


def _json_safe(o):
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _json_safe(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_json_safe(v) for v in o]
    return o


def _config(body: dict) -> Config:
    c = body.get("config") or {}
    allowed = Config.__dataclass_fields__
    clean = {k: v for k, v in c.items() if k in allowed}
    cfg = Config(**clean)
    if not (0 <= cfg.fee_bps <= 500 and 0 <= cfg.slippage_bps <= 500 and 0 <= cfg.stop_loss_pct <= 90):
        raise ValueError("config values out of range")
    if cfg.initial_capital <= 0:
        raise ValueError("initial_capital must be positive")
    return cfg


def _data(body: dict) -> dict:
    if "data" in body:
        raw = body["data"]
        n = len(raw.get("close", []))
        if n < 30 or n > MAX_BARS:
            raise ValueError(f"data must have between 30 and {MAX_BARS} bars")
        for k in ("date", "open", "high", "low", "close"):
            if len(raw.get(k, [])) != n:
                raise ValueError(f"column '{k}' has the wrong length")
        raw = dict(raw)
        raw.setdefault("volume", [1.0] * n)
        return qdata.from_json(raw)
    market = body.get("market", "trending")
    if market not in qdata.MARKETS:
        raise ValueError(f"unknown market '{market}'")
    return qdata.synthetic(market)


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024

    @app.errorhandler(ValueError)
    def bad_request(e):
        return jsonify(error=str(e)), 400

    @app.get("/api/health")
    def health():
        return jsonify(ok=True, engine="python")

    @app.get("/api/strategies")
    def strategies():
        return jsonify([s.to_dict() for s in STRATEGIES.values()])

    @app.get("/api/markets")
    def markets():
        return jsonify({k: {"name": v["name"], "blurb": v["blurb"]} for k, v in qdata.MARKETS.items()})

    @app.post("/api/backtest")
    def run_backtest():
        body = request.get_json(force=True, silent=True) or {}
        res = backtest(_data(body), body.get("strategy", "sma_cross"), body.get("params"), _config(body))
        return jsonify(_json_safe(res))

    @app.post("/api/sweep")
    def run_sweep():
        body = request.get_json(force=True, silent=True) or {}
        res = analysis.sweep(_data(body), body.get("strategy", "sma_cross"), body.get("params"), _config(body))
        return jsonify(_json_safe(res))

    @app.post("/api/walkforward")
    def run_wf():
        body = request.get_json(force=True, silent=True) or {}
        folds = int(body.get("folds", 5))
        if not 2 <= folds <= 12:
            raise ValueError("folds must be between 2 and 12")
        res = analysis.walk_forward(_data(body), body.get("strategy", "sma_cross"), body.get("params"),
                                    _config(body), folds=folds)
        return jsonify(_json_safe(res))

    @app.post("/api/parse-csv")
    def parse_csv():
        text = request.get_data(as_text=True)
        return jsonify(qdata.to_json(qdata.load_csv(text)))

    @app.get("/", defaults={"path": "index.html"})
    @app.get("/<path:path>")
    def static_files(path):
        if not WEB_DIST.exists():
            return "Dashboard not built. Run: cd web && npm install && npm run build", 404
        target = WEB_DIST / path
        if not target.is_file():
            path = "index.html"
        return send_from_directory(WEB_DIST, path)

    return app


if __name__ == "__main__":
    create_app().run(port=5000)
