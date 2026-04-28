---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: [[_专题-具身Agent/_MOC]]
---

# AutoGen 与 CrewAI 的差异

## 一句话速记

**AutoGen ≈ 多 Agent 的"群聊框架"**（微软出品，自由度高，研究友好，控制流靠对话规则）；**CrewAI ≈ 多 Agent 的"项目管理框架"**（轻量、贴合产品场景，Agent 有明确 role + Task 有明确依赖）。一个偏「**对话驱动**」，一个偏「**任务驱动**」。需要严格控制流就用 LangGraph；研究多 Agent 协作就用 AutoGen；产品快速搭线性 multi-agent 就用 CrewAI。

## 通俗解释（5 分钟版）

**为什么需要多 Agent**：
- 单 Agent + 一堆 tools 工程上够用，但 prompt 会越来越臃肿（每个角色塞一段 system 的活儿，干扰严重）
- 拆成多 Agent 后，每个 Agent 有**自己的 system prompt + 自己的工具集合 + 自己的记忆**，关注点清晰
- 缺点：调度变复杂、token 成本指数级、调试更难

**两者的设计哲学差异**：

| 维度 | AutoGen | CrewAI |
|---|---|---|
| 出品 | Microsoft Research | 独立社区 |
| 核心抽象 | `ConversableAgent` + `GroupChat` | `Agent` + `Task` + `Crew` |
| 控制流 | **靠 chat manager 路由消息** | **靠 Task 依赖 + Process（sequential/hierarchical）** |
| 心智模型 | **多人会议** | **项目甘特图** |
| Code execution | 内置 docker/jupyter executor，研究亮点 | 没有内置，要自己挂工具 |
| 学习曲线 | 中-高（chat manager 的策略要懂） | 低（看一遍 README 就能跑） |
| 生产稳定性 | 一般，文档跳跃，API 改动频繁 | 较好，API 较稳 |
| 适合场景 | **研究、复杂讨论型协作、code interpreter** | **产品、线性流水线（如「调研→写稿→审核」）** |

**AutoGen 的世界观**：所有 Agent 进同一个 GroupChat，每轮由一个 `chat_manager`（默认是 LLM）决定下一个发言者是谁，直到达到终止条件（轮数到、关键词命中、某 Agent 说"完成"）。

```
   ┌────────────────────────────────────────────┐
   │            GroupChat                        │
   │   ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐ │
   │   │ User │  │Coder │  │Critic│  │Runner│ │
   │   └──────┘  └──────┘  └──────┘  └──────┘ │
   │       ▲          ▲         ▲        ▲    │
   │       └─── chat_manager 决定下一个 ─┘    │
   └────────────────────────────────────────────┘
```

**CrewAI 的世界观**：Agent 是「**有 role/goal/backstory 的人**」，Task 是「**有 description/expected_output/agent 归属的活儿**」，Crew 把它们组装起来按 sequential 或 hierarchical 跑。

```
   ┌──────────────────────────────────────────────┐
   │                  Crew                         │
   │                                                │
   │  Agent A (Researcher)   Agent B (Writer)      │
   │       │                     │                   │
   │       ▼                     ▼                   │
   │   Task1 ──output──▶ Task2 ──output──▶ Task3   │
   │  (research)         (draft)         (review)   │
   └──────────────────────────────────────────────┘
```

**关键代码对比**（同一场景：研究员→写手）：

```python
# AutoGen
researcher = ConversableAgent("researcher", system_message="...", llm_config={...})
writer = ConversableAgent("writer", system_message="...", llm_config={...})
group = GroupChat(agents=[researcher, writer], messages=[], max_round=10)
manager = GroupChatManager(groupchat=group, llm_config={...})
researcher.initiate_chat(manager, message="...")
# 谁先说、说几次、什么时候停 —— manager 一路决定

# CrewAI
researcher = Agent(role="Researcher", goal="...", tools=[...])
writer = Agent(role="Writer", goal="...", tools=[...])
research_task = Task(description="...", agent=researcher)
write_task = Task(description="...", agent=writer, context=[research_task])
crew = Crew(agents=[researcher, writer], tasks=[research_task, write_task],
            process=Process.sequential)
crew.kickoff()
# Task 顺序就是依赖图，没有"谁先发言"的不确定性
```

## 关键细节 / 数学直觉

### 1）控制流不确定性差很多

- AutoGen 默认 chat manager 是 LLM 选下一个发言者——**控制流也由模型决定**，调试困难
- 可以换成 round-robin / 自定义函数，但默认体验偏研究
- CrewAI Process.sequential = 工作流的有向无环图，**完全确定性**
- CrewAI Process.hierarchical = 一个 manager Agent 在动态分配子任务，又回到不确定

**结论**：要可预测的产品流，CrewAI sequential 或 LangGraph；要灵活讨论协作，AutoGen 或 CrewAI hierarchical。

### 2）Code Execution 是 AutoGen 的杀手锏

```python
from autogen.coding import LocalCommandLineCodeExecutor

executor = LocalCommandLineCodeExecutor(work_dir="./coding")
code_runner = ConversableAgent(
    "code_runner",
    code_execution_config={"executor": executor},
    llm_config=False,  # 不调 LLM，专门跑代码
)
# coder Agent 说出代码块 → code_runner 自动执行 → 结果回到 group
```

类似 ChatGPT 的 Code Interpreter。CrewAI 没有内置，要自己接工具。

### 3）成本控制

多 Agent 系统**每轮都至少一次 LLM 调用**：
- 5 个 Agent 转 10 轮 = **50 次 LLM 调用** + 上下文每轮都在膨胀
- token 成本可能轻松达到单 Agent + tools 的 **10-50x**
- 务必：① 上下文压缩 ② 每个 Agent 用更小模型 ③ 强制 max_turns ④ 单元测试 token 上限

### 4）和 LangGraph 的关系

LangGraph 提供更底层的图编排能力，可以把 AutoGen / CrewAI 都当成 LangGraph 的一种**实现风格**：
- LangGraph + Supervisor 节点 ≈ CrewAI hierarchical
- LangGraph + 多个 Agent 节点 + 路由函数 ≈ AutoGen GroupChat
- 不少团队最终落到 LangGraph，是因为 AutoGen/CrewAI 的高层抽象**漏了边角需求**（自定义重试、checkpoint、HITL）

### 5）哪个适合具身

具身场景一般**不是"多 Agent 群聊"**这种讨论型——而是「**一个规划层 Agent + 多个技能/感知子模块**」的清晰分层。

- ✅ CrewAI 的 sequential / hierarchical 思路合用
- ❌ AutoGen 的 GroupChat 控制流不可预测，安全/实时性场景慎用
- ✅ 真做产品建议直接 LangGraph，把分层架构画成图，不依赖框架的 chat manager

## 延伸追问

- **Q：** 多 Agent 必然比单 Agent 强吗？
  → 不必然。Anthropic 2024 年的工程经验明确说**多 Agent 增加复杂度但精度没明显涨**——只在「**任务可清晰拆分 + 子任务独立**」时多 Agent 才赢。
- **Q：** AutoGen 的 GroupChat 如何避免死循环？
  → ① max_round 兜底 ② termination message（某 Agent 说出关键词触发停止）③ 自定义 chat_manager 函数加路由规则。
- **Q：** CrewAI 的 hierarchical 模式 manager Agent 是不是单点？
  → 是。manager Agent 决策错就整个 Crew 跑偏。同样靠 trace/HITL 兜底。
- **Q：** 这俩框架在中文生态什么状况？
  → AutoGen 中文资料多但偏研究；CrewAI 在国内做 LLM 应用的小团队用得多，文档简单。

## 我的记法

- AutoGen = **群聊**（chat manager 选下一个发言者，对话型）
- CrewAI = **项目甘特图**（Task 依赖 + Agent 角色，工作流型）
- LangGraph = **底层图编排**（自由度更高，适合复杂控制流）
- 具身/产品场景：**优先 LangGraph，CrewAI 次之，AutoGen 慎用**
- 一句话：**「AutoGen 是研究玩具，CrewAI 是产品玩具，LangGraph 是工程底座」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 至少跑通过两者其一的 hello world

## 参考资料
- [AutoGen 官方文档](https://microsoft.github.io/autogen/)
- [CrewAI 官方文档](https://docs.crewai.com/)
- [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents) — 多 Agent 慎用的工程经验
