import csv
import io
import math
import os

import numpy as np
from flask import Flask, jsonify, request, send_from_directory, Response
from detector import detect_bursts, synthetic_light_curve, to_dict

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # reject uploads over 10 MB (Flask answers 413)


def _finite(value):
    """JSON has no NaN/Infinity. Failed fits give NaN, and Flask would emit invalid JSON
    that the browser cannot parse, breaking the whole response. Send null instead."""
    return None if isinstance(value, float) and not math.isfinite(value) else value


def _payload(time, flux, sigma, prominence):
    smoothed, bursts = detect_bursts(time, flux, sigma=sigma, prominence_factor=prominence)
    step = max(1, len(time) // 1500)
    return {
        "time": [float(x) for x in time[::step]],
        "flux": [float(x) for x in flux[::step]],
        "smoothed": [float(x) for x in smoothed[::step]],
        "bursts": [{k: _finite(v) for k, v in b.items()} for b in to_dict(bursts)],
    }


def _params():
    sigma = float(request.values.get("sigma", 3))
    prominence = float(request.values.get("prominence", 4))
    if not (0 < sigma <= 100 and math.isfinite(sigma)):
        raise ValueError("sigma must be a number between 0 and 100.")
    if not (0 < prominence <= 1000 and math.isfinite(prominence)):
        raise ValueError("prominence must be a number between 0 and 1000.")
    return sigma, prominence


def _cell(value):
    """Neutralise spreadsheet formula injection: the export body is client-supplied, so a string
    starting with = + - @ (or tab/CR) would be executed by Excel/Sheets when the CSV is opened."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


@app.errorhandler(413)
def too_large(_exc):
    return jsonify(error="File too large (limit 10 MB)."), 413


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/demo")
def demo():
    try:
        seed = int(request.args.get("seed", 7))
        sigma, prom = _params()
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    t, f = synthetic_light_curve(seed=seed)
    return jsonify(_payload(t, f, sigma, prom))


@app.post("/api/analyse")
def analyse():
    upload = request.files.get("file")
    if upload is None:
        return jsonify(error="Attach a CSV file with two columns: time, flux."), 400
    try:
        rows = list(csv.reader(io.StringIO(upload.read().decode("utf-8-sig"))))
        data = []
        for r in rows:
            try:
                a, b = float(r[0]), float(r[1])
            except (ValueError, IndexError):
                continue  # header or blank line
            if math.isfinite(a) and math.isfinite(b):  # skip nan/inf rows, they poison the smoothing
                data.append((a, b))
        # Real exports are often unsorted or repeat timestamps; the detector needs strictly increasing time.
        data = sorted(dict(data).items())
        if len(data) < 20:
            raise ValueError("Need at least 20 numeric rows with distinct, finite times.")
        t, f = zip(*data)
        sigma, prom = _params()
        return jsonify(_payload(np.array(t), np.array(f), sigma, prom))
    except (ValueError, UnicodeDecodeError) as exc:
        return jsonify(error=str(exc)), 400


@app.post("/api/export")
def export():
    body = request.get_json(force=True, silent=True)
    bursts = body.get("bursts", []) if isinstance(body, dict) else None
    keys = ("peak_time", "peak_flux", "rise_time", "decay_time", "flare_class", "fit_ok")
    if not isinstance(bursts, list) or not all(isinstance(b, dict) and all(k in b for k in keys) for b in bursts):
        return jsonify(error="Send JSON like {\"bursts\": [...]} with the fields returned by /api/analyse."), 400
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["peak_time_s", "peak_flux_W_m2", "rise_time_s", "decay_time_s", "class", "fit_ok"])
    for b in bursts:
        w.writerow([_cell(b[k]) for k in keys])
    return Response(out.getvalue(), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=bursts.csv"})


if __name__ == "__main__":
    # The Werkzeug debugger allows remote code execution, so it is opt-in: FLASK_DEBUG=1 python app.py
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")
