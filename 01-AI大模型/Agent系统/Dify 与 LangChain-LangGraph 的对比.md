---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[01-AI大模型/Agent系统/Agent 的基本抽象是什么]] [[LangGraph 是什么 与 LangChain 的关系]] [[01-AI大模型/Agent系统/ReAct 的核心思想是什么]]"
---

# Dify 与 LangChain-LangGraph 的对比

> **价值定位**：Dify 偏「平台型」（流程 / 编排 / 多租户 / 评估），LangChain/LangGraph 偏「代码框架」（细粒度状态 / 可编程图）。**用对比来学是最高效的**——把两套抽象放进同一张表，能看清各自擅长的场景。这是 Agent 工程方向上**很有价值的横向对比题**。

## 一句话速记

**Dify = 面向业务的 LLM 应用 BaaS 平台**（可视化工作流 + 多租户 + 插件市场 + 评测后台），**LangChain = 面向开发者的 SDK 积木**（Tools / Memory / Chains），**LangGraph = 面向复杂 Agent 的状态图编排库**（StateGraph + checkpoint + 多 Agent）。三者**不是替代关系**：Dify 强在**业务自助 + 平台运营**；LangChain 强在**单应用快速搭积木**；LangGraph 强在**长流程 / 多 Agent / 人在回路 / 错误恢复**——具身 Agent 大脑层一般用 LangGraph，业务交互/运营后台用 Dify，互补而非二选一。

## 通俗解释（5 分钟版）

### Dify 是什么

- **产品形态**：可视化工作流编辑器 + 应用市场 + 知识库 + 插件市场 + 监控后台
- **部署形态**：容器化 BaaS，对外暴露 API；可自托管也可云服务
- **核心抽象**：应用（Chatflow / Agent / Workflow）+ 节点 + 数据集 + 模型供应商
- **平台能力关键词**：多环境部署、版本升级、自研插件（dify_plugin）、异步任务回执协议、Prompt 版本化、回放评估
- **谁在用**：业务方（运营、产品）+ 平台工程师；典型场景是企业内多个业务方各跑各的 LLM 应用

### LangChain / LangGraph 是什么

- **LangChain**：Python/JS SDK，提供 LLM 抽象、Prompt 模板、Tools、Memory、Chains、Agents、Retrievers 等积木块——**让你 5 分钟用代码搭一个 RAG 或 Agent**
- **LangGraph**：LangChain 团队后来推出的**状态图编排框架**，**核心是 `StateGraph`**：把 Agent 当作显式状态机——**节点是函数、边是控制流、状态是显式 dict/Pydantic**
- **为什么会有 LangGraph**：LangChain 早期的 `AgentExecutor` 黑盒太多——长流程 / 多 Agent / 错误恢复 / 人在回路都做不了；LangGraph 把控制流和状态显式化，让生产 Agent 可控
- **关键能力**：checkpoint（断点恢复）、interrupt（人在回路）、subgraph（嵌套）、multi-agent 编排（supervisor / swarm）

### 一句话区分

```
   Dify       = 给业务方的 BaaS 平台，可视化拖拉
   LangChain  = 给开发者的积木 SDK，写代码组装
   LangGraph  = 给开发者的状态机框架，写代码 + 状态显式
```

---

## 对比表（核心产物）

| 维度 | Dify | LangChain | LangGraph | 备注 |
|------|------|-----------|-----------|------|
| **本质定位** | BaaS 平台 / 产品 | SDK / 库 | 状态图编排库 | Dify 是产品，后两者是代码 |
| **使用人** | 业务方 + 平台工程师 | 开发者 | 开发者 | 用户群完全不同 |
| **抽象层次** | 高（拉节点） | 中（写代码 + 链式 API） | 中低（显式 StateGraph） | 越低越可控 |
| **Agent 能力** | Agent 节点（ReAct / Function Calling 风格）+ tool 调用 | `AgentExecutor` 已 deprecated；推荐 LangGraph | 内置 ReAct / 自定义 graph | LangChain 的 Agent 已让位 LangGraph |
| **多 Agent 协作** | 支持但简单（节点串联） | 不原生 | Supervisor / Swarm / Subgraph | LangGraph 强项 |
| **状态管理** | 节点变量 + 会话 | Memory 类（黑盒） | StateGraph + checkpoint | LangGraph 状态最显式 |
| **错误恢复 / 重试** | 节点级 retry | try/except 自己写 | checkpoint + retry policy + interrupt | LangGraph 是产品级 |
| **工具调用** | dify_plugin / API 工具节点 | LangChain Tools / Function Calling | 同 LangChain，可用 ToolNode | 工具生态相通 |
| **MCP 支持** | 平台从 1.0 起支持 MCP server | 通过 langchain-mcp-adapters 接 | 同 LangChain | 三者都跟得上 MCP |
| **RAG / 知识库** | 内置数据集 + 检索节点（开箱即用） | Retriever 抽象（自己拼） | 同 LangChain | Dify 最省事 |
| **Prompt 管理** | 平台级版本化 + AB | 代码内 PromptTemplate | 同 LangChain，靠 LangSmith | Dify 平台化最强 |
| **评测 / 回放** | 平台内置评测后台 | LangSmith（外挂） | LangSmith（原生集成） | LangSmith 全家桶或 Dify 内置 |
| **可观测性** | 平台监控 + 日志 | LangSmith | LangSmith / OpenTelemetry | 取决于挂什么 |
| **多租户 / 权限** | 平台一等公民 | 自己造 | 自己造 | 平台 vs 库的本质差距 |
| **部署形态** | 自建 BaaS / 云服务 | 嵌入式 lib（pip install） | 嵌入式 lib | Dify 是服务，后两者是代码 |
| **学习曲线** | 业务方 0 → 1 快 | 开发者中等 | 开发者中等偏上 | LangGraph 状态机心智模型有门槛 |
| **可控性 / 可调** | 受平台抽象限制 | 高 | 高（状态完全自己定） | 越底层越可调 |
| **适合的业务形态** | 多业务方自助、SaaS、企业内多应用并发 | 单应用、单流程、原型 | 复杂 Agent / 长流程 / 多 Agent / 人在回路 | 三者最大差异点 |

---

## 何时选哪个（决策树）

```
需要做的事是什么？
├── 业务方自助配置应用、需要平台运营 / 多租户 → Dify
├── 工程师写一个固定流程的 LLM 应用（RAG / 单 Agent）→ LangChain
├── Agent 流程长、需要 checkpoint、人在回路、多 Agent 协作 → LangGraph
├── 已经有 Dify 但单点能力不够（如多 Agent / 长流程）→ Dify Workflow + LangGraph 子服务（混合）
└── 具身 Agent / VLA 上线（长流程 + 错误恢复 + 多 Agent）→ 大概率 LangGraph + 自家 skill API
```

**经验法则**：

- 业务方多 + 应用浅 → **Dify**
- 业务深 + 单应用 → **LangChain**
- 业务深 + 状态机复杂 + 多 Agent → **LangGraph**
- **具身 Agent 几乎一定是 LangGraph**——因为它的长流程、错误恢复、HITL 是 Dify 当前抽象 cover 不了的

---

## 横向对比的实战视角

> **要点**：从「平台型工具 vs 代码框架」的角度看双方的差距与互补——这是工程师在选型时最常遇到的真问题。

### 1）平台型抽象 vs 库型抽象的取舍

```
   Dify (平台抽象)
   ✅ 业务方自助、降本快
   ✅ 多租户、运营后台一站式
   ❌ 单应用复杂度上限低（节点抽象层级粗）
   ❌ 想做 LangGraph 那种状态机 / 多 Agent / HITL，平台节点 cover 不了
   
   LangGraph (库抽象)
   ✅ 单应用深度无上限
   ✅ 状态机 / 多 Agent / 长流程随便玩
   ❌ 平台化运营得自己造（多租户 / 灰度 / 评测后台）
   ❌ 业务方接入门槛高
```

### 2）"Dify + LangGraph 混合"的真实场景

很多团队的实践：

```
   ┌────────────────────────────────────────┐
   │ 用户层（业务方拉的工作流）              │
   │     ↓ 在 Dify 里                         │
   │ HTTP 节点 / dify_plugin                  │
   │     ↓ 调用                               │
   │ 自家服务（用 LangGraph 实现复杂 Agent）  │
   │     - 多 Agent 协作                       │
   │     - checkpoint                          │
   │     - HITL                                │
   └────────────────────────────────────────┘
```

**思路**：用 Dify 做"业务方接入 + 运营后台"，复杂逻辑退出到 LangGraph 服务。

### 3）Agent 平台化的难点（LangGraph 单独不解决的）

- Prompt 版本管理 / AB
- 模型切换 / 多供应商
- Badcase 回放
- 多租户成本核算
- 业务方权限隔离
- 灰度发布

→ 这些都是**生产级运营能力**，LangGraph 是写应用的库，不是运营平台。**要么用 Dify 一站式，要么自家造平台 + 用 LangGraph 写应用。**

### 4）具身场景的落点

```
   大脑层（任务规划、多 Agent、错误恢复、HITL）
       ← LangGraph 是当前最合理选择
   
   业务侧（远程操控、任务下发、运营后台、客户对接）
       ← Dify 的产品形态值得参考，可作前端
   
   底层 skill / 控制
       ← 不是 LangGraph 也不是 Dify，是机器人厂商自家的 skill API
```

---

## 延伸追问

- **Q：Dify 已经能做 Agent 了，为什么还需要 LangGraph？两者是替代关系吗？**  
  → 不是替代是互补。Dify 的 Agent 节点更像 ReAct 的"产品化封装"——工具调用、记忆、单步推理；做不了**长流程、多 Agent、checkpoint、HITL**。LangGraph 把状态机暴露给开发者，可控性和深度完全不同。所以 **Dify = 业务自助 + 浅应用，LangGraph = 工程深度 + 复杂 Agent**。

- **Q：Dify 的 Agent 节点和 LangGraph 的 ReAct 实现，本质差别在哪？**  
  → 三点：① **状态可见性**：LangGraph 状态显式 dict，可观测可调试；Dify 节点变量黑盒 ② **控制流灵活度**：LangGraph 支持任意分支/循环/嵌套；Dify 节点是 DAG 心智 ③ **可编程能力**：LangGraph 节点是 Python 函数，能力无限；Dify 节点的能力受平台抽象限制。

- **Q：给具身 Agent 选编排层，应该选哪个？为什么？**  
  → LangGraph。原因：① 具身任务长流程（任务规划 → skill 调用 → observe → re-plan，多步）需要 checkpoint ② 具身需要 HITL（操作员介入）—— LangGraph 的 interrupt 是为这设计的 ③ 多机器人 / 多模块协作天然适合多 Agent ④ 错误恢复要求高，retry policy + checkpoint 是刚需 ⑤ skill API 经常需要复杂参数和返回处理，Python 函数比 Dify 节点灵活得多。但 **Dify 仍可以做"运营前端"**——业务方在 Dify 里拉一个简单 chatflow 调用 LangGraph 服务。

- **Q：LangGraph 的 StateGraph 和事件驱动调度有什么相同 / 不同？**  
  → 相同：都是状态流转 + 事件触发的心智。**不同**：① LangGraph 状态全局共享（一个 dict），事件驱动可能每个事件携带数据 ② LangGraph 是单进程内同步状态机，事件驱动常常跨进程 ③ LangGraph 决定下一节点的是模型/边逻辑，事件驱动决定下一处理者的是消息 topic。**事件驱动经验可以直接迁移**——理解状态流转的工程师上手 LangGraph 很快。

- **Q：LangChain 为什么后来推出了 LangGraph？AgentExecutor 有什么问题？**  
  → 三大痛点：① **黑盒**——`AgentExecutor.invoke()` 内部调用流程不可见，调试靠看 verbose log ② **缺状态**——只有 chat history 这一种"记忆"，复杂任务的中间状态没地方放 ③ **不能停**——一旦开跑要么跑完要么报错，没法在中间 interrupt（HITL）/ 暂存（checkpoint）/ 分叉。LangGraph 把这些都做了。

- **Q：怎么评测一个 LangGraph Agent？**  
  → 4 层：① **端到端任务成功率**（任务给定 → 是否完成）② **轨迹评估**（每一步走对没，模型选 tool 选对没）③ **单步评估**（具体某个节点输出质量）④ **运行指标**（延迟、token 成本、retry 次数）。**工具**：LangSmith trace + dataset + evaluator + 人工标注；RAGAS 用于检索评估；LLM-as-Judge 用于开放式质量评估。

---

## 我的记法

- **三者定位**：Dify = 业务方拖拉 BaaS；LangChain = 开发者搭积木 SDK；LangGraph = 开发者写状态机
- **谁强在哪**：Dify 强**业务自助 + 多租户**；LangChain 强**快速搭单应用**；LangGraph 强**长流程 + 多 Agent + HITL**
- **互补不替代**：Dify 做前端运营 + LangGraph 做后端复杂 Agent，是常见组合
- **具身大脑层 → LangGraph**：因为 checkpoint / HITL / 多 Agent / 错误恢复都是刚需
- **AgentExecutor 已 deprecated**：黑盒 + 没状态 + 不能停——这就是 LangGraph 出现的原因
- 一句话：**「Dify 解决"业务方怎么进来"，LangGraph 解决"工程师怎么写复杂 Agent"——具身 Agent 几乎一定走 LangGraph 路线」**

---

## 状态
- [x] 已背速记
- [x] 能讲通俗版
- [x] 能填完整张对比表
- [x] 能答 6 个追问
- [ ] 标签从 `#生疏` 改 `#能讲`

---

## 深研动作清单（决定深研此题时再用）

> **使用场景**：通识阶段不用做这些。等扫完所有题、决定要深研此题时，再按这清单走。

- [ ] 1. 看 LangChain 官方 quickstart（chat_models / prompts / tools），跑通 hello world
- [ ] 2. 看 LangGraph 官方 quickstart，跑通 ReAct 默认 demo
- [ ] 3. 跑通 LangGraph 的「**human-in-the-loop**」+「**checkpoint**」教程 ← 直接对应具身场景
- [ ] 4. 写一个 mini demo：LangGraph 调一个 mock 工具（模拟「机器人去拿杯子」任务图）
- [ ] 5. 在本地起 Dify，拉一个 chatflow，看节点抽象的边界
- [ ] 6. 写一个 LangGraph 服务，用 Dify HTTP 节点调用——体会"混合架构"

---

## 参考资料

- [LangChain 官方文档](https://python.langchain.com/) — 入门 SDK
- [LangGraph 官方文档](https://langchain-ai.github.io/langgraph/) — 重点看 StateGraph / checkpoint / multi-agent
- [LangGraph multi-agent 教程](https://langchain-ai.github.io/langgraph/tutorials/multi_agent/multi-agent-collaboration/)
- [Dify 官方文档](https://docs.dify.ai/) — 平台抽象与节点 / dify_plugin
- [AgentExecutor → LangGraph 迁移指南](https://python.langchain.com/docs/how_to/migrate_agent/)
