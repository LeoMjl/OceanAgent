import importlib
import sys
from pathlib import Path

required = ["numpy", "pandas", "xarray", "netCDF4", "matplotlib", "requests"]
failed = []
for name in required:
    try:
        module = importlib.import_module(name)
        print(f"OK {name}: {getattr(module, '__version__', 'available')}")
    except ImportError:
        failed.append(name)
cache = Path(__file__).resolve().parent / "data" / "oisst-avhrr-v02r01.20190715.nc"
print(f"CACHE {'OK' if cache.is_file() else 'MISSING'}: {cache}")
print(f"PYTHON: {sys.executable}")
if failed or not cache.is_file():
    print(f"FAILED missing packages={failed}")
    raise SystemExit(1)
print("READY: use DEMO_PROMPT.md in OceanAgent; choose a model with available credit.")
