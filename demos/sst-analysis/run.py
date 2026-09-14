"""Run one reviewable step or the complete small-data demonstration."""
import argparse
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from common import ROOT, CASE, region, save_json


def prepare(out, mode):
    target = out / "input.nc"
    cache = ROOT / "data" / CASE["source_file"]
    if mode == "cache":
        if not cache.is_file():
            raise FileNotFoundError(f"Cached data missing: {cache}; use --mode download")
        shutil.copy2(cache, target)
    else:
        import requests
        temporary = out / "input.download"
        with requests.get(CASE["source_url"], timeout=(15, 120), stream=True) as response:
            response.raise_for_status()
            with temporary.open("wb") as stream:
                for chunk in response.iter_content(1024 * 128):
                    stream.write(chunk)
        region(temporary)
        temporary.replace(target)
    data = region(target)
    result = {"mode": mode, "source_url": CASE["source_url"], "documentation": CASE["documentation"],
              "bytes": target.stat().st_size, "date": CASE["date"], "region_shape": dict(data.sizes),
              "prepared_at": datetime.now(timezone.utc).isoformat(), "synthetic": False}
    save_json(out / "provenance.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("step", choices=["prepare", "quality", "analyze", "plot", "report", "verify", "all"])
    parser.add_argument("--out", default="runs/demo", help="Relative to the demonstration directory")
    parser.add_argument("--mode", choices=["cache", "download"], default="cache")
    args = parser.parse_args()
    out = (ROOT / args.out).resolve()
    if out == ROOT or ROOT not in out.parents or out == ROOT / "data" or ROOT / "data" in out.parents:
        raise ValueError("Outputs must be in a dedicated subdirectory of the demonstration workspace")
    out.mkdir(parents=True, exist_ok=True)
    from analysis import quality, analyze, verify
    from presentation import plot, report
    steps = {"prepare": lambda: prepare(out, args.mode), "quality": lambda: quality(out),
             "analyze": lambda: analyze(out), "plot": lambda: plot(out),
             "report": lambda: report(out), "verify": lambda: verify(out)}
    for name in steps if args.step == "all" else [args.step]:
        print(f"START {name} -> {out}", flush=True)
        result = steps[name]()
        print(f"DONE {name}: {result}", flush=True)
    print(f"OUTPUT_DIR={out}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
