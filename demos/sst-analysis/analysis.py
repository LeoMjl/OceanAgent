import numpy as np
from common import CASE, read_json, region, save_json, weighted


def quality(out):
    data = region(out / "input.nc")
    sst = data.sst.values
    anomaly = data.anom.values
    valid = np.isfinite(sst)
    checks = {
        "grid_is_80_by_80": sst.shape == (80, 80),
        "sst_in_physical_range": bool(np.all((sst[valid] >= -3) & (sst[valid] <= 40))),
        "valid_ocean_pixels_exist": bool(valid.sum() > 0),
        "matching_sst_anomaly_mask": bool(np.array_equal(valid, np.isfinite(anomaly))),
        "latitude_increasing": bool(np.all(np.diff(data.lat.values) > 0)),
        "longitude_increasing": bool(np.all(np.diff(data.lon.values) > 0)),
        "quarter_degree_grid": bool(np.allclose(np.diff(data.lat), 0.25) and np.allclose(np.diff(data.lon), 0.25)),
    }
    result = {"passed": all(checks.values()), "checks": checks,
              "total_pixels": int(sst.size), "valid_ocean_pixels": int(valid.sum()),
              "land_or_missing_pixels": int((~valid).sum()),
              "note": "Masked pixels include land and missing values; they are not automatically data errors."}
    save_json(out / "quality.json", result)
    if not result["passed"]:
        raise ValueError("Data quality checks failed")
    return result


def analyze(out):
    data = region(out / "input.nc")
    sst, anomaly = data.sst.values, data.anom.values
    valid = np.isfinite(anomaly)
    weights = np.broadcast_to(np.cos(np.deg2rad(data.lat.values.astype(float)))[:, None], anomaly.shape)
    metrics = {
        "date": CASE["date"], "bbox": CASE["bbox"], "baseline": CASE["baseline"],
        "weighted_sst_c": weighted(sst, data.lat.values),
        "weighted_anomaly_c": weighted(anomaly, data.lat.values),
        "warm_area_fraction": float(weights[valid & (anomaly > CASE["warm_threshold_c"])].sum() / weights[valid].sum()),
        "warm_threshold_c": CASE["warm_threshold_c"],
        "sst_min_c": float(np.nanmin(sst)), "sst_max_c": float(np.nanmax(sst)),
        "anomaly_min_c": float(np.nanmin(anomaly)), "anomaly_max_c": float(np.nanmax(anomaly)),
        "valid_ocean_pixels": int(valid.sum()),
    }
    save_json(out / "metrics.json", metrics)
    data.to_dataframe().reset_index()[["lat", "lon", "sst", "anom", "err"]].to_csv(out / "region.csv", index=False)
    return metrics


def verify(out):
    metrics, qc = read_json(out / "metrics.json"), read_json(out / "quality.json")
    data = region(out / "input.nc")
    # Independent row-wise accumulation checks the vectorised statistics.
    sums = {"sst": [0., 0.], "anom": [0., 0.]}
    warm_weight = 0.
    for i, latitude in enumerate(data.lat.values):
        weight = float(np.cos(np.deg2rad(float(latitude))))
        for name in sums:
            for value in data[name].values[i]:
                if np.isfinite(value):
                    sums[name][0] += float(value) * weight
                    sums[name][1] += weight
                    if name == "anom" and value > CASE["warm_threshold_c"]:
                        warm_weight += weight
    checks = {"quality_passed": qc["passed"]}
    for name, key in [("sst", "weighted_sst_c"), ("anom", "weighted_anomaly_c")]:
        checks[key] = abs(sums[name][0] / sums[name][1] - metrics[key]) < 1e-9
    checks["fraction_in_range"] = 0 <= metrics["warm_area_fraction"] <= 1
    checks["warm_area_fraction"] = abs(warm_weight / sums["anom"][1] - metrics["warm_area_fraction"]) < 1e-9
    required = ["quality.json", "metrics.json", "region.csv", "sst.png", "anomaly.png", "report.html", "report.md", "provenance.json"]
    for name in required:
        checks[name] = (out / name).is_file() and (out / name).stat().st_size > 0
    result = {"passed": all(checks.values()), "checks": checks, "artifacts": required}
    save_json(out / "verification.json", result)
    if not result["passed"]:
        raise ValueError("Final verification failed")
    return result
