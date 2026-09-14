# 南海海表温度演示包

本目录是可以直接在 OceanAgent 创建为本地研究项目的完整工作区。

## 演示目标

首页点击“南海海表温度与异常分析”案例 → 模型实际调查数据与工具，展示进度说明和工具调用并生成方案 → 用户点击确认 → 主智能体执行数据准备、质量检查、统计、绘图和报告 → 核验产物并交付可点击结果。

现有脚本和缓存支持2019-07-15、105–125°E、5–25°N，使用真实 NOAA OISST v2.1 数据。`DEMO_PROMPT.md` 包含可原样粘贴的完整科研需求，明确日期、范围、数据、方法与成果，常规技术细节由模型自行决定，执行方案仍需用户确认。

## 现场准备

1. 启动 OceanAgent，访问 http://127.0.0.1:3210 。
2. 打开空白会话页面，选择有可用余额的模型。
3. 点击“南海海表温度与异常分析 · 查看方案并执行”案例卡片。平台会自动创建或复用案例项目，创建独立会话并启动模型调查，无需填写目录或粘贴提示词。
4. 查看模型的调查过程与生成的方案，点击“确认并执行”。平台不预写数据发现或科研方案，缓存是否存在由模型通过工具调查；数据质量在获批后检查。`DEMO_PROMPT.md` 保留供手动输入时使用。
5. 展开执行过程，展示真实命令、子任务和结果。完成后点 HTML 报告链接，展示两张地图、指标和数据来源。

演示分析本身在当前机器约几十秒；模型规划、调度与总结还需要额外时间，取决于响应速度。缓存模式无需现场下载数据，但调用模型仍需网络。

此前使用完整需求提示词完成一次平台真实彩排：约113秒，主智能体生成方案后模拟用户确认，委派2个子智能体并行执行quality/analyze，最终交付9个文件，规划状态为completed。记录保存在 `rehearsal-platform.json`；该记录来自此前版本的提示词。现场需新建会话和输出目录，不复用这次彩排的结果冒充实时执行。

## 环境检查与安装

```powershell
python check_environment.py
# 仅当检查提示缺依赖时安装：
python -m pip install -r requirements.txt
```

当前机器所需库已具备。`run.py` 与工作目录无关，可用绝对路径调用；`--out` 始终相对演示目录。

## 执行工具与依赖

为每次现场运行选择新的目录，例如 `runs/demo-20260913-01`。下表中的 `<out>` 必须替换为同一个目录名。

| 步骤 | 命令 | 依赖 | 产物 |
|---|---|---|---|
| 数据准备 | `python run.py prepare --out <out>` | 用户确认 | input.nc、provenance.json |
| 质量检查 | `python run.py quality --out <out>` | prepare | quality.json |
| 分析统计 | `python run.py analyze --out <out>` | prepare | metrics.json、region.csv |
| 绘图 | `python run.py plot --out <out>` | quality、analyze | sst.png、anomaly.png |
| 中文报告 | `python run.py report --out <out>` | plot、quality、analyze | report.md、report.html |
| 独立复核 | `python run.py verify --out <out>` | report | verification.json |
| 平台交付 | `complete_research_plan` 工具 | verify通过 | 可点击链接；规划状态变为已完成 |

quality 与 analyze 可分别交给两个子智能体并行执行，各自只运行自己的命令，不修改共享脚本。后续步骤由主智能体顺序执行。子任务需要获批执行轮次才能使用 bash。

每个命令会打印 START、DONE 和 OUTPUT_DIR，失败返回非零退出码。首次失败后修复问题，只需重跑受影响步骤及其下游；`all` 用于离线预演或失败后的人工复现，不用它代替现场分步展示。

```powershell
python run.py all --out runs/rehearsal-new
```

如确需展示实时下载，可在 prepare 时增加 `--mode download`。网络失败应报错或由主智能体明确改用 `--mode cache`，不暗中伪装成下载成功。

## 方法与验收

- 检查日期、维度、经纬度顺序、0.25°分辨率、单位、SST物理范围、海陆掩膜一致性。
- 截取80×80网格。陆地和缺测剔除后，使用纬度余弦权重计算SST与anom平均值；计算有效海域内anom > 1°C的加权比例。
- 距平由NOAA相对1971–2000气候基线计算。本例读取anom，不把区域平均或同日SST当成气候态。
- verify 用独立的逐行累积算法复核平均值，并检查全部产物存在且非空；全部通过才可交付。
- 数据质量失败、产物缺失、验证失败时不得标记为完成。
- 本例不训练预测模型，也不推断热浪、因果关系或长期变暖趋势。

## 数据与文件

- `case.json`：数据日期、范围、来源、阈值和限制。
- `data/oisst-avhrr-v02r01.20190715.nc`：约1.6MB真实官方原始文件缓存。
- `run.py`：分步/全流程入口，支持cache与download。
- `common.py`、`analysis.py`、`presentation.py`：读数、统计复核、绘图报告实现。
- `runs/rehearsal/`：准备期间的预演产物，只供验收，不代替现场实际计算。
- `requirements.txt`、`check_environment.py`：依赖与开场前自检。
- `platform_rehearsal.mjs`：完整需求流程的API集成测试，不支持多轮澄清；若模型仍提出问题，应在网页中处理，不能据此判定平台故障。只有显式传入 `--approve-rehearsal` 才会模拟用户确认并执行。

```powershell
# 测试平台能生成待确认方案；不会自动批准：
node platform_rehearsal.mjs
# 仅用于自动化彩排，明确模拟确认操作：
node platform_rehearsal.mjs --approve-rehearsal
```

数据来源：[NOAA产品说明](https://www.ncei.noaa.gov/products/optimum-interpolation-sst)；原始URL在case.json中。灰色网格表示陆地或缺测；矩形窗口包含邻近海域，并非精确南海海盆边界。
