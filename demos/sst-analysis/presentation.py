import base64
import html
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from common import CASE, read_json, region


def plot(out):
    data = region(out / "input.nc")
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11})
    for variable, filename, title, cmap, limits in [
        ("sst", "sst.png", "Sea surface temperature", "viridis", (22, 32)),
        ("anom", "anomaly.png", "SST anomaly vs 1971–2000", "RdBu_r", (-3, 3)),
    ]:
        fig, ax = plt.subplots(figsize=(7, 5.8), layout="constrained")
        ax.set_facecolor("#e4e8eb")
        mesh = ax.pcolormesh(data.lon, data.lat, data[variable], cmap=cmap,
                             vmin=limits[0], vmax=limits[1], shading="auto")
        ax.set(xlabel="Longitude (°E)", ylabel="Latitude (°N)",
               title=f"{title}\nSouth China Sea window · {CASE['date']}")
        ax.set_aspect(1 / 0.966)
        fig.colorbar(mesh, ax=ax, label="°C", shrink=0.85, extend="both")
        fig.savefig(out / filename, dpi=160)
        plt.close(fig)
    return {"figures": ["sst.png", "anomaly.png"]}


def report(out):
    m, qc, provenance = [read_json(out / name) for name in ["metrics.json", "quality.json", "provenance.json"]]
    limitations = "\n".join(f"- {line}" for line in CASE["limitations"])
    text = f"""# {CASE['title']}

日期：{CASE['date']}；分析窗口：105–125°E，5–25°N。

## 实测结果

- 面积加权海表温度：{m['weighted_sst_c']:.3f} °C。
- 相对 NOAA 1971–2000 气候基线的面积加权距平：{m['weighted_anomaly_c']:+.3f} °C。
- 距平 > 1 °C 的有效海域面积比例：{100*m['warm_area_fraction']:.2f}%。
- 有效海洋网格：{m['valid_ocean_pixels']}；陆地或缺测网格：{qc['land_or_missing_pixels']}。
- 数据质量检查：{'通过' if qc['passed'] else '未通过'}。

## 方法与证据边界

使用 NOAA OISST v2.1 的 sst 和 anom 字段；按纬度余弦加权，仅在各变量的有效网格统计。
区域 CSV 保留全部网格与缺测标记，便于复核。距平并非相对当日区域平均温度计算。

{limitations}

## 数据来源

- 产品说明：{CASE['documentation']}
- 原始数据：{CASE['source_url']}
- 本次数据获取模式：{provenance['mode']}。
- 图表：sst.png、anomaly.png。指标：metrics.json。复核：verification.json。
"""
    (out / "report.md").write_text(text, encoding="utf-8")
    figures = "".join(f'<figure><img alt="{label}" src="data:image/png;base64,{base64.b64encode((out/name).read_bytes()).decode()}"><figcaption>{label}</figcaption></figure>'
                      for name, label in [("sst.png", "真实海表温度 / SST"), ("anomaly.png", "相对气候基线的距平 / Anomaly")])
    limitations_html = "".join(f"<li>{html.escape(line)}</li>" for line in CASE["limitations"])
    page = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{CASE['title']} · OceanAgent</title><style>
body{{margin:0;background:#f2f7f8;color:#183b45;font:16px/1.75 system-ui,sans-serif}}main{{max-width:1100px;margin:40px auto;padding:28px}}header{{border-bottom:1px solid #c9dce0;padding-bottom:24px}}h1{{font-size:34px;margin:8px 0}}.eyebrow{{letter-spacing:3px;color:#378d8b;font-size:12px}}.cards,.figures{{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:24px 0}}.card,section,figure{{background:white;border:1px solid #dce8eb;border-radius:14px;padding:22px}}.card strong{{font-size:30px;display:block;color:#16837b}}.figures{{grid-template-columns:1fr 1fr}}figure{{margin:0;padding:10px}}img{{width:100%;height:auto}}figcaption{{text-align:center;color:#678087}}section{{margin:20px 0}}a{{color:#087f89;overflow-wrap:anywhere}}@media(max-width:700px){{main{{padding:16px;margin:0}}.cards,.figures{{grid-template-columns:1fr}}h1{{font-size:26px}}}}
</style><main><header><div class="eyebrow">OCEANAGENT / REPRODUCIBLE RESEARCH</div><h1>{CASE['title']}</h1><p>{CASE['date']} · 105–125°E，5–25°N · NOAA OISST v2.1</p></header>
<div class="cards"><div class="card">面积加权 SST<strong>{m['weighted_sst_c']:.2f} °C</strong></div><div class="card">面积加权距平<strong>{m['weighted_anomaly_c']:+.2f} °C</strong></div><div class="card">暖距平 > 1 °C 面积占比<strong>{100*m['warm_area_fraction']:.1f}%</strong></div></div>
<section><h2>数据质量与计算口径</h2><p>{qc['valid_ocean_pixels']} 个有效海洋网格；{qc['land_or_missing_pixels']} 个陆地或缺测网格。质量检查：{'通过' if qc['passed'] else '未通过'}。</p><p>原生 0.25° 网格，纬度余弦面积加权。使用 NOAA anom 字段及 1971–2000 气候基线。暖距平比例仅针对有效海洋网格。</p></section>
<div class="figures">{figures}</div><section><h2>结论适用范围</h2><ul>{limitations_html}</ul></section>
<section><h2>可追溯来源与复核</h2><p><a href="{CASE['documentation']}">NOAA 产品说明</a> · <a href="{CASE['source_url']}">原始 NetCDF 文件</a></p><p>数据模式：{html.escape(provenance['mode'])}。CSV、指标、质量检查和最终验证文件保存在同一输出目录。</p></section></main></html>"""
    (out / "report.html").write_text(page, encoding="utf-8")
    return {"reports": ["report.md", "report.html"]}
