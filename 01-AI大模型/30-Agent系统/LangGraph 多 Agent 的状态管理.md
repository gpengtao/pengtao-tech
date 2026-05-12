---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---
# LangGraph 多 Agent 的状态管理

## 一句话速记

LangGraph 多 Agent 的核心问题是：**多个 Agent 共享状态时谁能写、怎么合并、谁路由**。三种主流模式：① **Supervisor**（一个领导 Agent 把消息派发给各专家，专家干完返回，领导决定下一步）② **Subgraph**（每个 Agent 是一个独立子图，有自己的 state schema，主图通过转换函数桥接）③ **Network/Handoff**（Agent 之间用 `Command` 互相 transfer 控制权 + 部分 state）。**reducer + state schema 设计**是不踩坑的关键。

## 通俗解释（5 分钟版）

**单 Agent 的 state 很简单**：一个 `messages` list 大家追加。多 Agent 一上来就有几个尴尬：

1. **每个 Agent 看到的"对话历史"不一样**——专家 A 的工具调用日志，专家 B 不需要看，否则 prompt 爆炸
2. **多个 Agent 并发执行**时，各自更新 state 同一字段会冲突
3. **谁有权决定下一个谁说话**——是固定路由还是 LLM 决定？
4. **失败时哪个 Agent 的状态要回滚**

LangGraph 的解法是：**把"谁动什么字段"显式写进 state schema 和 reducer**，而不是隐式约定。

### 三种主流多 Agent 拓扑

#### 模式 1：Supervisor（监督者）

```
        ┌──────────────┐
        │  Supervisor  │◄──────┐
        └──────┬───────┘       │
       routes to next agent    │ 各 agent 干完回到 supervisor
       ┌──────┼──────┐         │
       ▼      ▼      ▼         │
   ┌─────┐┌─────┐┌─────┐       │
   │ A1  ││ A2  ││ A3  │───────┘
   └─────┘└─────┘└─────┘
```

最经典也最稳。**Supervisor 看完前一个 Agent 的输出，决定下一个**：

```python
class State(TypedDict):
    messages: Annotated[list, add_messages]
    next: str   # supervisor 写入：下一个 agent 名字

def supervisor(state):
    decision = llm.invoke([{"role":"system","content":"决定下一个agent"}, *state["messages"]])
    return {"next": decision.parsed_agent_name}

def route(state):
    if state["next"] == "FINISH":
        return END
    return state["next"]

graph.add_conditional_edges("supervisor", route)
graph.add_edge("agent_a", "supervisor")
graph.add_edge("agent_b", "supervisor")
```

#### 模式 2：Subgraph（子图嵌套）

每个 Agent 是一个**独立的 LangGraph**——有自己的 state schema、自己的节点、自己的 checkpointer。主图把它当成一个**节点**调用，桥接靠转换函数。

```python
class TeamState(TypedDict):    # 主图的 state
    task: str
    final_report: str

class ResearcherState(TypedDict):  # 子图自己的 state
    messages: list
    sources: list

researcher_subgraph = build_researcher()  # 独立编译

def call_researcher(state: TeamState):
    sub_input = {"messages": [...]}              # 主→子的转换
    sub_output = researcher_subgraph.invoke(sub_input)
    return {"final_report": sub_output["report"]} # 子→主的转换
```

**好处**：每个 Agent 团队独立演进、独立测试、独立 checkpoint。**代价**：要自己写转换函数、跨子图共享 state 不便。

#### 模式 3：Network / Handoff（去中心化交接）

LangGraph 0.2+ 的 `Command` 让一个 Agent 直接把控制权 + 部分 state 转交给另一个，不必经过 supervisor。

```python
from langgraph.types import Command

def agent_a(state):
    # ... 干完自己活 ...
    if need_help_from_b:
        return Command(
            goto="agent_b",
            update={"task_for_b": "..."}
        )
    return Command(goto=END)
```

适合**P2P 协作**场景，但调试比 supervisor 难。具身场景慎用。

### State schema 设计的 3 条原则

1. **每个字段写明白 reducer**：append、覆盖、取最新——别让 LangGraph 默认覆盖坑你
2. **大对象不进 state**：图像、点云、长文档存 S3，state 里只放引用 + metadata。state 大了 checkpoint 写入慢、可观测性变差
3. **私有字段加前缀**：`agent_a_scratchpad`、`agent_b_scratchpad`——明确这是某个 Agent 的工作空间，路由时不暴露

## 关键细节 / 数学直觉

### 1）Reducer 是状态合并的核心

```python
from typing import Annotated
from operator import add

class State(TypedDict):
    messages: Annotated[list, add_messages]   # append（识别 message id 去重）
    visited: Annotated[set, lambda x,y: x|y]  # set 并集
    counter: Annotated[int, add]              # 求和
    decision: str                              # 默认覆盖
```

**踩坑**：两个并发节点都更新同一个 list，没指定 reducer → 后写覆盖前写，丢数据。

### 2）私有 / 公开 channel

LangGraph 支持**通道隔离**——某个字段可以是某些节点专属：

```python
class PrivateState(TypedDict):
    scratchpad: str

def agent_a(state: State) -> Command[Literal["agent_b"]]:
    return Command(
        update={"messages": [...]},   # 公共
        goto="agent_b",
        graph=...,                    # 跨子图传递
    )
```

不过这块 API 还在演进，写代码前先看官方最新文档。

### 3）多 Agent 调试三件套

- **LangSmith trace**：每一步看清楚谁动了什么字段、调了什么 LLM、用了多少 token
- **Mermaid 图导出**：`graph.get_graph().draw_mermaid()` 把图可视化
- **State diff**：`app.get_state_history(config)` 拿到所有快照，diff 看每步改了啥

### 4）成本/延迟典型坑

| 反模式 | 现象 | 对策 |
|---|---|---|
| 每个 Agent 都用 GPT-4 主模型 | token 成本 N 倍 | Supervisor 用主模型，专家 Agent 用 mini/Haiku |
| 每个 Agent 都把 messages 全量喂入 | context 膨胀 | 子图入口做 message 摘要 / 截断 |
| 没有 max_iterations | 死循环 | state 加 step_count，超阈值强制 END |
| Subgraph 之间用 state dict 全量传 | 序列化开销大 | 显式转换函数，只传必要字段 |

## 延伸追问

- **Q：** 多 Agent 之间如何共享一份"工作记忆"（比如团队都看到的项目笔记）？
  → 一个公共 channel + reducer = append；每个 Agent 写入有 author 标记。需要长期记忆就走外部 vector store。
- **Q：** 一个 Agent 失败如何不带塌整个团队？
  → 用 `try/except` 包节点 → 错误写入 state 的 `errors` 字段 → supervisor 看到错误决定 fallback / retry / 跳过 / escalate。
- **Q：** 多 Agent 能并发跑吗？
  → 能。LangGraph 支持 fan-out（一个节点可以同时进多个），用 reducer 合回来。但要小心 race condition，对 state 字段必须设好 reducer。
- **Q：** Supervisor 模式 vs Hierarchical（多层 Supervisor）什么时候升级？
  → 当下游团队超过 5-7 个，单 Supervisor 的 prompt 选择就开始翻车——拆成「**总监 → 经理 → 员工**」两层 Supervisor，类比组织架构。

## 我的记法

- 三种拓扑：**Supervisor / Subgraph / Network-Handoff**
- 三条 state 设计铁律：**reducer 写明、大对象走外存、私有字段加前缀**
- 死循环防御：**step_count + max_iterations + supervisor termination 关键词**
- Supervisor 用大模型，专家用小模型——**钱省一半**
- 一句话：**「多 Agent 不是聪明，是组织」——画清楚汇报关系比换更强的模型重要**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 LangGraph 跑通过 supervisor 拓扑

## 参考资料
- [LangGraph Multi-agent 官方教程](https://langchain-ai.github.io/langgraph/concepts/multi_agent/)
- [LangGraph Subgraphs 文档](https://langchain-ai.github.io/langgraph/how-tos/subgraph/)
- [LangGraph Command primitive](https://langchain-ai.github.io/langgraph/concepts/low_level/#command)
