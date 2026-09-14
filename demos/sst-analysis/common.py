"""Shared deterministic inputs, paths and data checks for the demonstration."""
import json
from pathlib import Path
import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parent
CASE = json.loads((ROOT / "case.json").read_text(encoding="utf-8"))


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def region(path):
    with xr.open_dataset(path) as source:
        for variable in ["sst", "anom", "err"]:
            if variable not in source:
                raise ValueError(f"Missing variable: {variable}")
        date = str(source.time.values[0])[:10]
        if source.sizes.get("time") != 1 or date != CASE["date"]:
            raise ValueError(f"Unexpected date: {date}")
        west, east, south, north = CASE["bbox"]
        data = source[["sst", "anom", "err"]].isel(time=0, zlev=0).sel(
            lon=slice(west, east), lat=slice(south, north)).load()
    if not data.sizes["lon"] or not data.sizes["lat"]:
        raise ValueError("Empty spatial window")
    if data.sst.attrs.get("units") != "Celsius":
        raise ValueError("Expected Celsius SST")
    return data


def weighted(values, latitudes):
    values = np.asarray(values, dtype=float)
    weights = np.broadcast_to(np.cos(np.deg2rad(np.asarray(latitudes, dtype=float)))[:, None], values.shape)
    valid = np.isfinite(values)
    if not valid.any():
        raise ValueError("No valid ocean pixels")
    return float(np.sum(values[valid] * weights[valid]) / weights[valid].sum())
