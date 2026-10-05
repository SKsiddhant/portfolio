import unittest, io
import numpy as np
from detector import burst_model, detect_bursts, goes_class, synthetic_light_curve
from app import app


class DetectorTests(unittest.TestCase):
    def test_recovers_known_burst(self):
        t = np.arange(0, 1800.0)
        rng = np.random.default_rng(1)
        flux = 1e-7 + burst_model(t, 0, 5e-6, 900, 30, 150) + rng.normal(0, 1e-8, t.size)
        _, bursts = detect_bursts(t, flux)
        self.assertEqual(len(bursts), 1)
        b = bursts[0]
        self.assertTrue(b.fit_ok)
        self.assertAlmostEqual(b.peak_time, 900, delta=10)
        self.assertAlmostEqual(b.decay_time, 150, delta=25)
        self.assertTrue(b.flare_class.startswith("C"))

    def test_quiet_sun_has_no_bursts(self):
        t = np.arange(0, 1800.0)
        flux = 1e-7 + np.random.default_rng(2).normal(0, 1e-8, t.size)
        self.assertEqual(detect_bursts(t, flux)[1], [])

    def test_goes_class_boundaries(self):
        self.assertEqual(goes_class(5e-7)[0], "B")
        self.assertEqual(goes_class(2e-5), "M2.0")
        self.assertEqual(goes_class(3e-4), "X3.0")

    def test_demo_finds_bursts(self):
        t, f = synthetic_light_curve()
        self.assertGreaterEqual(len(detect_bursts(t, f)[1]), 3)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.c = app.test_client()

    def test_demo_endpoint(self):
        r = self.c.get("/api/demo")
        self.assertEqual(r.status_code, 200)
        self.assertIn("bursts", r.get_json())

    def test_upload_and_export(self):
        t, f = synthetic_light_curve()
        csv_text = "time,flux\n" + "\n".join(f"{a},{b}" for a, b in zip(t, f))
        r = self.c.post("/api/analyse", data={"file": (io.BytesIO(csv_text.encode()), "lc.csv")})
        self.assertEqual(r.status_code, 200)
        e = self.c.post("/api/export", json={"bursts": r.get_json()["bursts"]})
        self.assertIn("peak_time_s", e.get_data(as_text=True))

    def test_bad_upload(self):
        r = self.c.post("/api/analyse", data={"file": (io.BytesIO(b"a,b\n1,x"), "bad.csv")})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.c.post("/api/analyse").status_code, 400)


if __name__ == "__main__":
    unittest.main()
