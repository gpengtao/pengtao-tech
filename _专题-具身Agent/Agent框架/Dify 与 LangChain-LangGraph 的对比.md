---
tags: [P0, AI方向, 具身方向, 未动]
来源: 专题 · 具身 Agent
相关: [[01-AI大模型/Agent系统/Agent 的基本抽象是什么]] [[LangGraph 是什么 与 LangChain 的关系]] [[01-AI大模型/Agent系统/ReAct 的核心思想是什么]]
---

# Dify 与 LangChain-LangGraph 的对比

> **价值定位**：Dify 偏「平台型」（流程 / 编排 / 多租户 / 评估），LangChain/LangGraph 偏「代码框架」（细粒度状态 / 可编程图）。**用对比来学是最高效的**——把两套抽象放进同一张表，能看清各自擅长的场景。这是 Agent 工程方向上**很有价值的横向对比题**。

## 一句话速记
**TODO ── 学完后能 30 秒讲清楚**

参考方向（学完自己写一句）：
> Dify 是「**面向业务的大模型应用 BaaS 平台**」（可视化工作流 + 多租户 + 插件 + 评测 + 运营后台），LangChain/LangGraph 是「**面向开发者的 SDK/编排库**」（代码定义 Agent、状态图、工具）；前者**降业务接入门槛**，后者**给工程师最大可控性**，**多 Agent 与复杂状态机** LangGraph 占优，**业务自助 + 平台运营** Dify 占优。

---

## 通俗解释（5 分钟版）

### Dify 是什么
TODO ── 学完填：
- 产品形态：可视化工作流编辑器 + 应用 + 知识库 + 插件市场 + 监控
- 部署形态：容器化 BaaS，对外暴露 API
- 核心抽象：应用（Chatflow / Agent / Workflow）+ 节点 + 数据集 + 模型供应商
- 平台能力关键词：多环境部署、版本升级、自研插件（dify_plugin）、异步任务回执协议、Prompt 版本化、回放评估

### LangChain / LangGraph 是什么
TODO ── 学完填：
- **LangChain**：Python/JS SDK，提供 LLM 抽象、Prompt 模板、Tools、Memory、Chains、Agents、Retrievers 等积木块
- **LangGraph**：LangChain 团队后来推出的**状态图编排框架**，**核心是 `StateGraph`**：把 Agent 当作显式状态机，**节点是函数、边是控制流、状态是显式 dict/Pydantic**
- 为什么会有 LangGraph：LangChain 早期的 `AgentExecutor` 黑盒太多，**长流程 / 多 Agent / 错误恢复** 难做；LangGraph 把控制流和状态显式化
- 关键能力：checkpoint（断点恢复）、interrupt（人在回路）、subgraph（嵌套）、multi-agent 编排（supervisor、swarm）

---

## 对比表（核心产物，重点填这张）

| 维度 | Dify | LangChain | LangGraph | 备注 |
|------|------|-----------|-----------|------|
| **本质定位** | BaaS 平台 / 产品 | SDK / 库 | 状态图编排库 | TODO |
| **使用人** | 业务方 + 平台工程师 | 开发者 | 开发者 | TODO |
| **抽象层次** | 高（拉节点） | 中（写代码 + 链式 API） | 中低（显式 StateGraph） | TODO |
| **Agent 能力** | TODO（Dify Agent 节点） | TODO | TODO | TODO |
| **多 Agent 协作** | TODO | TODO（有 LangGraph multi-agent） | TODO | TODO |
| **状态管理** | 节点变量 + 会话 | Memory 类 | StateGraph + checkpoint | TODO |
| **错误恢复 / 重试** | TODO | TODO | checkpoint + retry policy | TODO |
| **工具调用** | dify_plugin / API 工具节点 | LangChain Tools | 同 LangChain | TODO |
| **MCP 支持** | TODO（最新版本） | TODO | TODO | TODO |
| **RAG / 知识库** | 内置数据集 + 检索节点 | Retriever 抽象 | 同 LangChain | TODO |
| **Prompt 管理** | 平台级版本化 | 代码内 PromptTemplate | 同 LangChain | TODO |
| **评测 / 回放** | 平台内置 | LangSmith（外挂） | LangSmith | TODO |
| **可观测性** | 平台监控 + 日志 | LangSmith | LangSmith | TODO |
| **多租户 / 权限** | 平台一等公民 | 自己造 | 自己造 | TODO |
| **部署形态** | 自建 BaaS / 云服务 | 嵌入式 lib | 嵌入式 lib | TODO |
| **学习曲线** | 业务方 0 → 1 快 | 开发者中等 | 开发者中等偏上 | TODO |
| **可控性 / 可调** | 受平台抽象限制 | 高 | 高 | TODO |
| **适合的业务形态** | TODO | TODO | TODO | TODO |

---

## 何时选哪个（决策树，TODO 写完）

```
需要做的事是什么？
├── 业务方自助配置应用、需要平台运营 → Dify
├── 工程师写一个固定流程的 LLM 应用 → LangChain（或直接用 SDK）
├── Agent 流程长、需要 checkpoint、人在回路、多 Agent 协作 → LangGraph
├── 已经有 Dify 但单点能力不够 → Dify Workflow + LangGraph 子服务（混合）
└── 具身 Agent / VLA 上线 → 大概率 LangGraph（状态机 + 错误恢复 + 多 Agent）
```

---

## 横向对比的实战视角（TODO）

> **要点**：从「平台型工具 vs 代码框架」的角度看双方的差距与互补——这是工程师在选型时最常遇到的真问题。

TODO ── 学完后写：

1. **平台型抽象 vs 库型抽象的取舍**：Dify 让 N 个业务方各自跑应用，但**单应用复杂度**有上限；LangGraph 适合做单应用深度，但**平台化运营**得自己造。
2. **「Dify + LangGraph 混合」的真实场景**：什么节点用 Dify、什么节点退出到 LangGraph 服务；如何用 dify_plugin / HTTP 节点桥接。
3. **Agent 平台化的难点**：Prompt 版本、模型切换、灰度、Badcase 回放、多租户成本——这些是生产难题，LangGraph 单独跑不解决。
4. **具身场景的落点**：大脑（VLA + 高阶规划）适合放 LangGraph 状态机；业务侧（任务下发、人机交互、运营后台）可以借 Dify 的产品形态。

---

## 面试常问追问（先列预设题，学完逐个填）

- **Q：Dify 已经能做 Agent 了，为什么还需要 LangGraph？两者是替代关系吗？**  
  TODO（参考思路：互补关系——平台 vs 库；多 Agent 与状态机 LangGraph 强；运营与多租户 Dify 强；具身 Agent 倾向 LangGraph）

- **Q：Dify 的 Agent 节点和 LangGraph 的 ReAct 实现，本质差别在哪？**  
  TODO

- **Q：给具身 Agent 选编排层，应该选哪个？为什么？**  
  TODO（提示：考虑长流程、多 Agent、checkpoint、人在回路、可观测性、与硬件控制层的解耦）

- **Q：LangGraph 的 StateGraph 和事件驱动调度有什么相同 / 不同？**  
  TODO（提示：事件驱动调度的经验可以直接迁移到 StateGraph 的状态流转概念上）

- **Q：LangChain 为什么后来推出了 LangGraph？AgentExecutor 有什么问题？**  
  TODO

- **Q：怎么评测一个 LangGraph Agent？**  
  TODO（提示：LangSmith trace、单步评测、轨迹评测、AB、回归）

---

## 我的记法（30 秒能讲清的版本）

TODO ── 学完后写。建议结构：

> Dify 是「面向业务的 LLM 应用 BaaS 平台」，强在多租户、运营、可视化编排；LangGraph 是「面向开发者的状态图编排库」，强在单应用深度、checkpoint、多 Agent、人在回路。两者**不是替代关系**，是**不同抽象层的互补**——业务自助接入用 Dify，需要复杂状态机或具身长流程时退出到 LangGraph 子服务。具身 Agent 因为长流程 + 多 Agent + 错误恢复的特点，更适合 LangGraph 当大脑层。

---

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能填完整张对比表
- [ ] 能答 6 个追问
- [ ] 标签从 `#未动` 改 `#生疏` → `#能讲`

---

## 深研动作清单（决定深研此题时再用）

> **使用场景**：通识阶段不用做这些。等扫完所有题、决定要深研此题时，再按这清单走。

- [ ] 1. 看 LangChain 官方 quickstart（chat_models / prompts / tools），跑通 hello world
- [ ] 2. 看 LangGraph 官方 quickstart，跑通 ReAct 默认 demo
- [ ] 3. 跑通 LangGraph 的「**human-in-the-loop**」+「**checkpoint**」教程 ← 直接对应具身场景
- [ ] 4. 写一个 mini demo：LangGraph 调一个 mock 工具（模拟「机器人去拿杯子」任务图）
- [ ] 5. 回填上面所有 TODO（重点是对比表、决策树、横向对比视角）
- [ ] 6. 写一句话速记 + 我的记法

---

## 参考资料

学完往这里贴：
- LangChain 官方文档：TODO
- LangGraph 官方文档：TODO
- LangGraph multi-agent 教程：TODO
- Dify 官方文档与平台抽象：TODO
