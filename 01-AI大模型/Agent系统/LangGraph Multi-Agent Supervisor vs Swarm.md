---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: [[LangGraph 是什么 与 LangChain 的关系]] [[Multi-Agent 有哪些协作范式]]
---

# LangGraph Multi-Agent：Supervisor vs Swarm

## 一句话速记

**LangGraph 多 Agent 两大范式**：
- **Supervisor（监督者）**：一个 orchestrator LLM 决定"该调哪个子 Agent"，子 Agent 完成后结果汇报给 supervisor，由 supervisor 决定下一步。适合**任务有明确分工、需要集中调度**的场景。
- **Swarm（群体）**：Agent 之间直接"转交"（handoff），没有中心调度者，当前 Agent 判断任务该由谁接着做就 handoff 过去。适合**动态路由、Agent 之间边界清晰**的场景。

## 通俗解释

**先问个问题**：如果你要做一个"客服 + 专家转介绍 + 回访"的 Agent 系统，怎么设计？

```
用户: "我的设备坏了"
    ↓
情况 A（Supervisor 模式）:
  Supervisor 判断 → "这是售后问题，找 repair_agent"
  repair_agent 完成 → 汇报 Supervisor
  Supervisor 判断 → "要不要安排回访？找 followup_agent"
  followup_agent 完成 → 汇报 Supervisor → 结束

情况 B（Swarm 模式）:
  reception_agent 接待 → "这是售后，转 repair_agent"（handoff）
  repair_agent 处理 → "需要回访，转 followup_agent"（handoff）
  followup_agent 完成 → 结束
```

---

## Supervisor 模式（代码骨架）

```python
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.types import Command
from typing import Literal

# 1. 定义子 Agent（每个是一个 node）
def research_agent(state):
    # 执行搜索/研究任务
    result = do_research(state["task"])
    return {"research_result": result}

def writer_agent(state):
    # 执行写作任务
    result = do_writing(state["research_result"])
    return {"draft": result}

# 2. Supervisor：LLM 决定下一步调哪个
supervisor_prompt = """
你是一个任务协调者。根据当前状态，决定下一步：
- "research"：需要研究
- "writer"：需要写作
- "FINISH"：任务完成

当前状态：{state}
"""

def supervisor(state) -> Command[Literal["research", "writer", END]]:
    response = llm.invoke(supervisor_prompt.format(state=state))
    next_step = parse_next(response)   # 解析 LLM 输出决定路由
    
    if next_step == "FINISH":
        return Command(goto=END)
    return Command(goto=next_step)

# 3. 组装图
graph = StateGraph(State)
graph.add_node("supervisor", supervisor)
graph.add_node("research", research_agent)
graph.add_node("writer", writer_agent)

graph.set_entry_point("supervisor")
graph.add_edge("research", "supervisor")   # 子 Agent 完成后都回 supervisor
graph.add_edge("writer", "supervisor")

app = graph.compile()
```

**关键特征**：
- 子 Agent 执行完都**回到 supervisor**，由 supervisor 决定下一步
- 控制流集中在 supervisor，类似"项目经理分配任务"
- 容易在 supervisor 处加监控、审计、人工审核

---

## Swarm 模式（代码骨架）

```python
from langgraph.prebuilt import create_react_agent
from langchain_core.tools import tool

# 1. 定义 handoff 工具（Agent 用来"转交"给其他 Agent）
@tool
def transfer_to_repair_agent():
    """当问题涉及维修时，转交给维修专员"""
    pass

@tool  
def transfer_to_followup_agent():
    """当需要安排回访时，转交给回访专员"""
    pass

# 2. 每个 Agent 有自己的工具集 + handoff 工具
reception_agent = create_react_agent(
    llm,
    tools=[answer_faq, transfer_to_repair_agent],
    state_modifier="你是前台接待，处理通用问题。遇到维修问题转 repair。"
)

repair_agent = create_react_agent(
    llm,
    tools=[check_warranty, schedule_repair, transfer_to_followup_agent],
    state_modifier="你是维修专员，处理设备问题。处理完安排回访。"
)

followup_agent = create_react_agent(
    llm,
    tools=[schedule_callback, send_survey],
    state_modifier="你是回访专员，负责跟进和满意度调查。"
)

# 3. LangGraph prebuilt swarm 组装
from langgraph_swarm import create_swarm

app = create_swarm(
    agents=[reception_agent, repair_agent, followup_agent],
    default_active_agent="reception"
)
```

**关键特征**：
- Agent 通过 `handoff` 工具主动转交，不需要中心调度者
- 当前活跃 Agent 完全接管对话，直到它决定转交
- 更灵活，但调试复杂（不知道谁在处理）

---

## Supervisor vs Swarm 对比

| 维度 | Supervisor | Swarm |
|------|-----------|-------|
| **控制流** | 集中（Supervisor 每次决策） | 分散（当前 Agent 自己决定转交） |
| **适用场景** | 任务边界清晰、需要中心调度、需要审计 | 对话路由、角色专业化强、动态转交 |
| **调试难度** | 低（看 Supervisor 决策即可） | 高（需要追踪 handoff 链路） |
| **并行能力** | Supervisor 可派多个子 Agent 并行 | 天然串行（当前 Agent 结束才能转交） |
| **适合结构** | 树形：Supervisor 在顶部 | 网状：Agent 互相转交 |
| **类比** | 项目经理分配任务 | 接力棒，谁来了谁接着跑 |
| **风险** | Supervisor 成为单点瓶颈 | 循环转交、无法终止的 handoff 链 |

---

## 第三种：子图（Subgraph）嵌套

Supervisor 和 Swarm 之外，还有一种常用模式：**把复杂 Agent 做成子图**，被父图调用。

```python
# 子图：一个专门处理"文档分析"的完整 Agent 流程
doc_analysis_subgraph = build_doc_analysis_graph().compile()

# 父图：作为一个节点调用子图
def doc_analysis_node(state):
    result = doc_analysis_subgraph.invoke(state)
    return {"analysis": result["output"]}

parent_graph.add_node("doc_analysis", doc_analysis_node)
```

**什么时候用子图**：
- 某个 Agent 功能本身很复杂（多步骤 + 内部循环），单一节点装不下
- 想复用：同一个子图被多个父图调用
- 想隔离测试：子图可以单独跑

---

## 面试常问追问

- **Q：Supervisor 模式最大的风险是什么？**  
  → Supervisor 本身是 LLM，它也会犯错——路由错了子 Agent、死循环调同一个 Agent。对策：① 给 Supervisor 加步数限制 ② 可以在 Supervisor 前加 interrupt（人工审核这步路由决策）③ 让 Supervisor 输出结构化 JSON 而不是自由文本来控制路由。

- **Q：Swarm 怎么防止循环 handoff？**  
  → ① 给整个 swarm 加 step 上限 ② 记录每个 Agent 被 activate 的次数，超过 N 次熔断 ③ handoff 工具里加"当前已访问 Agent 列表"，不允许再转回已访问的 Agent。

- **Q：什么场景一定要 Supervisor 不能用 Swarm？**  
  → 需要并行调用多个子 Agent 时——Swarm 是串行转交，Supervisor 可以同时派出多个子 Agent 并行跑，最后汇总结果。比如"同时让 research_agent 查三个数据源"。

- **Q：你的项目里有没有 Multi-Agent？**  
  → 重新 frame：「我做的大模型应用平台里，我们用 qmq 的多 topic 做了一个轻量的任务分发——fast/normal 两类，本质上是 pipeline 范式（固定序列的任务流）。严格意义上的 Supervisor/Swarm 模式我在设计层研究过，但在实际场景中觉得 Dify 的 Workflow 已经满足了我们的业务复杂度，没有引入专门的多 Agent 框架。如果场景复杂到需要动态路由，我会优先考虑 LangGraph 的 Supervisor 模式。」

## 我的记法

- **Supervisor = 项目经理**：所有子 Agent 都向他汇报，他决定下一步派谁
- **Swarm = 接力赛**：Agent 自己判断下一棒交给谁，没有裁判
- **Subgraph = 微服务**：复杂 Agent 做成独立子图，被父图当黑盒调用
- 选型规则：**需要并行/审计 → Supervisor；需要动态路由/对话流 → Swarm**
- 一句话：**「Supervisor 控制权集中，Swarm 控制权分散；两种都是用 LangGraph 的 graph 编排出来的」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版（Supervisor vs Swarm 区别）
- [ ] 能答追问
- [ ] 跑过 LangGraph Supervisor demo

## 参考资料
- [LangGraph Multi-Agent 教程](https://langchain-ai.github.io/langgraph/tutorials/multi_agent/multi-agent-collaboration/)
- [LangGraph Supervisor 教程](https://langchain-ai.github.io/langgraph/tutorials/multi_agent/agent_supervisor/)
- [LangGraph Swarm 文档](https://langchain-ai.github.io/langgraph/concepts/multi_agent/#handoffs)
- [Multi-Agent Networks 架构](https://langchain-ai.github.io/langgraph/concepts/multi_agent/)
