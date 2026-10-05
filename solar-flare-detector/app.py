import csv
import io

import numpy as np
from flask import Flask, jsonify, request, send_from_directory, Response
from detector import detect_bursts, synthetic_light_curve, to_dict

app = Flask(__name__, static_folder="static", static_url_path="")


def _payload(time, flux, sigma, prominence):
    smoothed, bursts = detect_bursts(time, flux, sigma=sigma, prominence_factor=prominence)
    step = max(1, len(time) // 1500)
    return {
        "time": [float(x) for x in time[::step]],
        "flux": [float(x) for x in flux[::step]],
        "smoothed": [float(x) for x in smoothed[::step]],
        "bursts": to_dict(bursts),
    }


def _params():
    return float(request.values.get("sigma", 3)), float(request.values.get("prominence", 4))


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/demo")
def demo():
    t, f = synthetic_light_curve(seed=int(request.args.get("seed", 7)))
    sigma, prom = _params()
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
                data.append((float(r[0]), float(r[1])))
            except (ValueError, IndexError):
                continue  # header or blank line
        if len(data) < 20:
            raise ValueError("Need at least 20 numeric rows.")
        t, f = zip(*data)
        sigma, prom = _params()
        return jsonify(_payload(np.array(t), np.array(f), sigma, prom))
    except (ValueError, UnicodeDecodeError) as exc:
        return jsonify(error=str(exc)), 400


@app.post("/api/export")
def export():
    bursts = request.get_json(force=True).get("bursts", [])
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["peak_time_s", "peak_flux_W_m2", "rise_time_s", "decay_time_s", "class", "fit_ok"])
    for b in bursts:
        w.writerow([b["peak_time"], b["peak_flux"], b["rise_time"], b["decay_time"], b["flare_class"], b["fit_ok"]])
    return Response(out.getvalue(), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=bursts.csv"})


if __name__ == "__main__":
    app.run(debug=True)
