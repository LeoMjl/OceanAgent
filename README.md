# OceanAgent

OceanAgent 是基于 Pi Agent SDK 的海洋科研智能体。它将本地 `Ocean-RAG`、官方网页检索、结构化追问、科研规划审批、会话树和 SQLite 持久化整合为一个网页版工作台。

## 当前能力

- 根据问题难度直接回答、检索证据、请求关键参数或生成科研规划。
- 支持通过设置页面配置多个 Pi SDK 模型供应商；默认使用 `qwen3.7-text-embedding` 生成 1024 维知识库向量。
- 对 `Ocean-RAG` 的 dataset、problem_solution、usage_bundle 卡片执行增量索引与混合检索。
- 只在语义置信度足够时返回 RAG 证据，并保留知识卡、数据集和网页来源。
- 科研规划必须经用户确认；确认后自动启动受控执行轮次。
- 以 SQLite 保存会话、树节点、运行、SSE 事件、工具调用、规划和引用。
- 支持会话分支切换、流式输出、停止运行、结构化补充参数和证据侧栏。

规划执行目前可以完成知识检索、证据综合、方法细化和研究步骤说明。需要真实数据下载、Python 计算或文件产出的步骤会被明确标记为待执行，当前版本不会伪造结果。

## 环境要求

- Node.js `>=22.19.0`（当前机器的 22.14.0 已通过实测，但低于 Pi SDK 声明版本，建议升级）。
- 首次使用时在网页“设置”中配置至少一个模型供应商和模型。
- 默认知识库目录：`Ocean-RAG`。

模型、API Key、默认模型、远程连接和嵌入模型参数均保存在 SQLite。`.env` 文件不会被自动读取；端口、数据库路径等进程级覆盖项可通过系统环境变量注入，示例见 `.env.example`。

## 启动

```powershell
npm ci
npm run build
npm start
```

浏览器访问：<http://127.0.0.1:3210>

首次启动后，在左下角“设置”中配置模型供应商、API Key 和模型。本仓库不包含私有 Ocean-RAG 知识卡；若要使用知识库，请将兼容的 JSONL 卡片放入 `Ocean-RAG/cards/`，保存阿里云百炼凭据，然后在另一个终端建立索引：

```powershell
npm run index:rag:rebuild
```

开发模式：

```powershell
npm run dev
```

## 验证

```powershell
npm test
npm run typecheck
npm run build
```

## 主要目录

```text
.pi/SYSTEM.md                 OceanAgent 系统规则
frontend/src/                 React 会话树与科研工作台
src/agent/                    Pi 会话、工具和运行编排
src/db/                       SQLite schema 与 repositories
src/rag/                      Ocean-RAG 解析、索引和检索
src/server/                   Fastify API、SSE 与审批路由
data/ocean-agent.sqlite       本地运行数据库（不提交）
```

## 安全边界

- Pi 内置高权限工具未暴露给模型，当前使用显式工具白名单。
- 规划审批前不执行；规划审批后只执行当前工具真实支持的工作。
- 官方网页检索使用域名硬过滤；检索失败时不会用名称相似的无关网页替代。
- 模型与远程服务器凭据使用 Windows DPAPI 加密后写入 SQLite，不读取 `.env` 中的凭据。

## 隐私与分发

公开仓库只包含源码、构建配置、`.pi/SYSTEM.md` 和空的 `Ocean-RAG/cards/` 目录，不包含知识库内容。不要提交 `.env`、`data/`、SQLite、日志、缓存、运行产物、远程服务器脚本、实验目录或知识卡。克隆后的首次运行会创建全新的本地数据库，使用者需要自行配置模型、远程连接和知识库。
