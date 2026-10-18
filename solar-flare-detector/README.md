# solar-flare-detector

Finds and classifies bursts in a solar X-ray light curve: Gaussian smoothing, peak detection, a fast-rise/exponential-decay fit per burst, and a GOES-style class (A, B, C, M, X). Flask API plus a single-page chart UI. Upload a CSV (`time,flux`) or use the built-in synthetic demo. Demo data only.

```bash
pip install -r requirements.txt
python app.py                  # http://127.0.0.1:5000
python -m pytest               # or: python -m unittest discover -s tests -t .
```

Uploads are limited to 10 MB. Rows that aren't finite numbers are skipped, and unsorted or duplicate timestamps are cleaned up. Set `FLASK_DEBUG=1` to run with Flask's debugger (local use only).
