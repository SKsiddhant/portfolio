import pytest

from quantforge.data import synthetic, to_json
from quantforge.server import create_app


@pytest.fixture()
def client():
    return create_app().test_client()


def test_health_and_catalogue(client):
    assert client.get("/api/health").get_json() == {"ok": True, "engine": "python"}
    keys = [s["key"] for s in client.get("/api/strategies").get_json()]
    assert "donchian" in keys and "buy_hold" in keys
    assert set(client.get("/api/markets").get_json()) == {"trending", "choppy", "volatile"}


def test_backtest_on_synthetic_market(client):
    r = client.post("/api/backtest", json={"market": "choppy", "strategy": "vwap_reversion",
                                           "params": {"window": 15}, "config": {"stop_loss_pct": 5}})
    body = r.get_json()
    assert r.status_code == 200
    assert body["params"]["window"] == 15 and body["config"]["stop_loss_pct"] == 5
    assert len(body["equity"]) == 1500 and body["monte_carlo"] is not None


def test_backtest_on_uploaded_data(client):
    data = to_json(synthetic("trending", 300))
    r = client.post("/api/backtest", json={"data": data, "strategy": "sma_cross", "params": {"fast": 10, "slow": 50}})
    assert r.status_code == 200 and len(r.get_json()["equity"]) == 300


def test_sweep_and_walkforward(client):
    s = client.post("/api/sweep", json={"market": "trending", "strategy": "donchian"}).get_json()
    assert len(s["cells"]) == len(s["y"]["values"])
    w = client.post("/api/walkforward", json={"market": "trending", "strategy": "donchian", "folds": 3}).get_json()
    assert len(w["folds"]) == 3


def test_parse_csv(client):
    lines = ["Date,Open,High,Low,Close,Volume"] + [f"2024-02-{i:02d},1,2,0.5,1.5,10" for i in range(1, 30)]
    lines += [f"2024-03-{i:02d},1,2,0.5,1.5,10" for i in range(1, 10)]
    r = client.post("/api/parse-csv", data="\n".join(lines))
    assert r.status_code == 200 and len(r.get_json()["close"]) == 38


@pytest.mark.parametrize("body,msg", [
    ({"strategy": "nope"}, "unknown strategy"),
    ({"market": "mars"}, "unknown market"),
    ({"config": {"fee_bps": -1}}, "out of range"),
    ({"data": {"close": [1, 2, 3]}}, "between 30"),
])
def test_bad_requests_return_400(client, body, msg):
    r = client.post("/api/backtest", json=body)
    assert r.status_code == 400 and msg in r.get_json()["error"]
