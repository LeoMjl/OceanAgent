# OceanAgent

OceanAgent 是基于 Pi Agent SDK 的海洋科研智能体。它将本地 `Ocean-RAG`、官方网页检索、结构化追问、科研规划审批、会话树和 SQLite 持久化整合为一个网页版工作台。

## 当前能力

- 根据问题难度直接回答、检索证据、请求关键参数或生成科研规划。
- 支持通过设置页面配置多个 Pi SDK 模型供应商。
- 对 `Ocean-RAG` 的 dataset、problem_solution、usage_bundle 卡片执行增量索引与混合检索。
- 只在语义置信度足够时返回 RAG 证据，并保留知识卡、数据集和网页来源。
- 科研规划必须经用户确认；确认后自动启动受控执行轮次。
- 以 SQLite 保存会话、树节点、运行、SSE 事件、工具调用、规划和引用。
- 支持会话分支切换、流式输出、停止运行、结构化补充参数和证据侧栏。

规划执行目前可以完成知识检索、证据综合、方法细化和研究步骤说明。需要真实数据下载、Python 计算或文件产出的步骤会被明确标记为待执行，当前版本不会伪造结果。

## 环境要求

- Node.js `>=22.19.0`。
- 首次使用时在网页“设置”中配置至少一个模型供应商和模型。
- 默认知识库目录：`Ocean-RAG`。

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

## 许可

Copyright © 2026 LeoMjl。本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)，仅允许非商业用途；商业使用须事先获得版权所有者的书面授权。
