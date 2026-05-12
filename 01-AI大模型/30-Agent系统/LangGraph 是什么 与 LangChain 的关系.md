---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---
# LangGraph 是什么 与 LangChain 的关系

## 一句话速记

**LangGraph = 把 Agent 流程显式画成「状态机/有向图」的框架**：节点是函数、边是控制流（可条件可循环）、状态是显式的 `dict`/Pydantic。它是 LangChain 团队基于过往经验做的「Agent 编排第二代」——把 LangChain 中黑盒的 `AgentExecutor` 拆成你能自己画的图，从而**可调试、可断点、可人在回路（HITL）**。

## 通俗解释（5 分钟版）

**先看 LangChain 第一代的痛**：
- LangChain 早期主推 `LCEL` 链式 API（`prompt | llm | parser`）和 `AgentExecutor`
- 链式 API 适合**线性 pipeline**（RAG、分类、抽取），写起来很顺
- 但是 Agent 是个**循环**——「想 → 调工具 → 看结果 → 再想」要循环 N 次，循环次数模型决定
- LangChain 的 `AgentExecutor` 把这个循环包成了**黑盒**：你给一个 LLM + 一组 Tools，它内部自己 ReAct 循环到结束
- 后果：调试痛苦、想插一段「人工审核才能继续」做不到、想中断后续跑也做不到、错误重试逻辑都长在框架里

**LangGraph 的破局**：把 Agent 重新建模成**有向图**，所有控制流都暴露给开发者。

```
    ┌────────────────────────────────┐
    │           StateGraph            │
    │                                 │
    │   ┌───────┐   工具未结束?       │
    │   │ Agent │◄──────────┐         │
    │   └───┬───┘           │         │
    │       │ tool_calls?   │         │
    │       ▼               │         │
    │   ┌───────┐           │         │
    │   │ Tools │───────────┘         │
    │   └───┬───┘                     │
    │       │ 完成                    │
    │       ▼                         │
    │      END                        │
    └────────────────────────────────┘
```

**核心抽象只有 3 个**：
1. **State**：一个 dict / Pydantic / TypedDict，整个图共享。LLM 输出、工具结果、计数器都塞这里
2. **Node**：一个普通函数 `def node(state) -> partial_state`，干活然后返回要更新的字段
3. **Edge**：节点之间的连线。可以是固定边（A → B），可以是条件边（根据 state 决定下一步去哪）

剩下的**循环、分支、中断、续跑**全部由你画图决定，不再藏在框架里。

**和 LangChain 的关系**：
- LangChain（包括 LCEL）**没死**——做线性 pipeline、做 chain-of-thought 它还是顺手
- LangGraph **复用 LangChain 的工具/模型/向量库抽象**（`ChatOpenAI`、`Tool`、`VectorStore`）
- 但**编排层换掉了**：从「chain」换成「graph」
- 官方现在所有 Agent 教程都基于 LangGraph，`AgentExecutor` 已经是 deprecated 路线

## 关键细节 / 数学直觉

### 1）StateGraph 最小骨架

```python
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages

class State(TypedDict):
    messages: Annotated[list, add_messages]  # reducer：自动 append 而不是覆盖

def call_model(state: State):
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

def call_tool(state: State):
    tool_call = state["messages"][-1].tool_calls[0]
    result = tools[tool_call["name"]].invoke(tool_call["args"])
    return {"messages": [{"role": "tool", "content": result, ...}]}

def should_continue(state: State):
    if state["messages"][-1].tool_calls:
        return "tools"
    return END

graph = StateGraph(State)
graph.add_node("agent", call_model)
graph.add_node("tools", call_tool)
graph.set_entry_point("agent")
graph.add_conditional_edges("agent", should_continue)
graph.add_edge("tools", "agent")
app = graph.compile()
```

### 2）Reducer 是关键概念

`Annotated[list, add_messages]` 这一行是 LangGraph 的精髓：每个 state 字段可以指定一个 **reducer 函数**，告诉 LangGraph 「下一次更新这个字段时怎么合并」。`add_messages` 默认是 append；不写 reducer 就是覆盖。这样多个节点并发更新不同字段也不会冲突。

### 3）Checkpoint 让 Agent 可中断可续跑

```python
from langgraph.checkpoint.sqlite import SqliteSaver

memory = SqliteSaver.from_conn_string(":memory:")
app = graph.compile(checkpointer=memory)

config = {"configurable": {"thread_id": "user-42"}}
app.invoke({"messages": [...]}, config)  # 跑到某个 interrupt 节点暂停
# ... 几小时后 ...
app.invoke(None, config)  # 从断点继续
```

每个节点跑完后状态被 dump 到 checkpointer。**具身场景的硬刚需**——机器人要等用户确认才能动，不可能让 Python 进程一直跑着。

### 4）Interrupt：人在回路

```python
graph.compile(checkpointer=memory, interrupt_before=["dangerous_action"])
```

跑到 `dangerous_action` 之前自动停。外部系统可以审 state、改 state、再 resume。

## 延伸追问

- **Q：** LangGraph 和你熟悉的 Dify 工作流本质差别是什么？
  → Dify 是**平台**（GUI 编排 + 多租户 + 灰度 + 审计）；LangGraph 是**库**（代码即图，工程侧灵活但什么都自己搭）。Dify 节点是「黑盒能力」，LangGraph 节点是「任意 Python 函数」，控制流自由度更高。
- **Q：** 为什么 LangChain 的 `AgentExecutor` 被取代？
  → 黑盒循环、不能加自定义控制流、调试困难、不支持 HITL/checkpoint、错误重试策略写死。第一代框架的典型问题：抽象太高，需求一发散就漏。
- **Q：** State 用 TypedDict 还是 Pydantic？
  → TypedDict 轻量、运行时不校验；Pydantic 重一点但运行时校验 + IDE 提示更好。生产建议 Pydantic，原型可以 TypedDict。
- **Q：** 什么时候不用 LangGraph 而用纯代码？
  → 流程极简（一次 LLM 调用 + 一次工具）、性能极敏感（每次 graph 启动有 overhead）、或者你想完全自己控制 trace。

## 我的记法

- **LangChain ≈ Spring 那种功能全家桶**（链、工具、向量库、加载器都有）
- **LangGraph ≈ Spring StateMachine / 工作流引擎**（专注编排）
- **State / Node / Edge** 三件套——和你画过的工作流图一一对应
- **Reducer = state 字段的合并函数**，是 LangGraph 区别于普通状态机的精髓
- 一句话：**「LangChain 是积木，LangGraph 是把积木拼起来的胶水」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 跑通过 LangGraph hello world

## 参考资料
- [LangGraph 官方文档](https://langchain-ai.github.io/langgraph/)
- [LangGraph: Multi-Agent Workflows](https://blog.langchain.dev/langgraph-multi-agent-workflows/)
- [LangGraph vs LangChain 设计哲学](https://blog.langchain.dev/langgraph/)
