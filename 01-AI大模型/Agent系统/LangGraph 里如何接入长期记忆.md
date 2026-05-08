---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[LangGraph 是什么 与 LangChain 的关系]] [[Mem0 与 MemGPT 长期记忆思路]] [[Agent 的记忆如何分层]]"
---

# LangGraph 里如何接入长期记忆（工程实现）

## 一句话速记

**LangGraph 的记忆分两层**：① **checkpointer**（会话内记忆，自动）= 把 state 存到 SQLite/Postgres，会话中断可续跑；② **store**（跨会话长期记忆，手动读写）= 用 `InMemoryStore` / `AsyncRedisStore` 等存跨用户、跨会话的事实，节点里手动 `store.get/put`。**一句话：checkpointer 管"上下文断点"，store 管"跨会话记得你"。**

## 通俗解释（5 分钟版）

**为什么需要两层**：

```
用户 A 今天的第 1 次对话:
  消息 1: "我叫 Alice"
  消息 2: "给我推荐一本书"
  ------- 会话结束 -------

用户 A 明天的第 2 次对话（新的 thread_id）:
  消息 1: "我上次找你聊天，你推荐了什么？"
```

- `checkpointer` 解决的是**同一个 thread 里中断续跑**——用户 A 的会话因为网络断了，10 分钟后回来继续。
- `store` 解决的是**跨 thread、跨会话的信息持久化**——用户 A 明天开新对话，Agent 还记得她叫 Alice。

## 核心代码骨架

### 1）checkpointer —— 会话内短期记忆（自动）

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver
# 生产可换成 langgraph.checkpoint.postgres import PostgresSaver

memory = SqliteSaver.from_conn_string("checkpoints.db")
app = graph.compile(checkpointer=memory)

# 每次调用带同一个 thread_id = 同一个会话上下文
config = {"configurable": {"thread_id": "user-alice-session-001"}}
result = app.invoke({"messages": [...]}, config)

# 断点续跑：同一 thread_id 再调就自动从上次暂停处继续
```

**checkpointer 存的是什么**：每个节点跑完后的完整 state snapshot（messages 列表、所有自定义字段）。

**thread_id 的设计**：
- 一个 thread = 一个完整的对话会话
- 不同 thread_id = 完全隔离的状态
- 跨会话的记忆不在这里，在 store

---

### 2）store —— 跨会话长期记忆（手动）

**InMemoryStore（开发用）**：

```python
from langgraph.store.memory import InMemoryStore

store = InMemoryStore()
app = graph.compile(checkpointer=memory, store=store)
```

**节点里读写 store**：

```python
from langchain_core.runnables import RunnableConfig
from langgraph.store.base import BaseStore

def agent_node(state: State, config: RunnableConfig, store: BaseStore):
    # 从 config 拿到当前用户 id（由上层注入）
    user_id = config["configurable"].get("user_id", "anonymous")
    
    # 读取用户的长期记忆
    namespace = ("memories", user_id)   # 命名空间设计：按用户隔离
    memories = store.search(namespace, query=state["messages"][-1].content)
    
    # 整理成 context 注入 prompt
    memory_context = "\n".join([m.value["content"] for m in memories])
    
    # 正常调 LLM
    response = llm.invoke([
        SystemMessage(f"用户历史信息：\n{memory_context}"),
        *state["messages"]
    ])
    return {"messages": [response]}

def save_memory_node(state: State, config: RunnableConfig, store: BaseStore):
    """对话结束后抽取事实存入 store"""
    user_id = config["configurable"].get("user_id", "anonymous")
    namespace = ("memories", user_id)
    
    # 让 LLM 从对话中抽取值得记住的事实
    facts = extract_facts_from_conversation(state["messages"])
    
    for i, fact in enumerate(facts):
        store.put(namespace, key=f"fact-{user_id}-{i}", value={"content": fact})
```

**调用时传入 user_id**：

```python
config = {
    "configurable": {
        "thread_id": "alice-session-002",   # 新的会话 thread
        "user_id": "alice"                   # 但用户还是 alice → store 里能读到上次的记忆
    }
}
result = app.invoke({"messages": [user_message]}, config)
```

---

### 3）生产用 store —— Redis 后端

```python
# pip install langgraph-checkpoint-redis
from langgraph.store.redis import AsyncRedisStore

store = AsyncRedisStore.from_url("redis://localhost:6379")
await store.setup()   # 创建索引

app = graph.compile(checkpointer=postgres_checkpointer, store=store)
```

**store 支持语义搜索（需要 embed 函数）**：

```python
from langchain_openai import OpenAIEmbeddings

store = InMemoryStore(
    index={
        "embed": OpenAIEmbeddings(model="text-embedding-3-small"),
        "dims": 1536,
    }
)

# 存入时自动 embed
store.put(("memories", "alice"), key="pref-1", value={"content": "不喜欢辣的"})

# 查询时做语义搜索（不只关键词匹配）
results = store.search(("memories", "alice"), query="推荐一道菜", limit=3)
```

---

## 两层记忆的完整架构图

```
一次对话请求
    │ user_id = "alice"
    │ thread_id = "session-003"（新会话）
    ▼
┌──────────────────────────────────────────────────────────┐
│                     LangGraph App                         │
│                                                           │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────┐  │
│  │ retrieve │──▶│  agent   │──▶│  save_memory         │  │
│  │ memories │   │  (LLM)   │   │  (抽取事实 → store)  │  │
│  └──────────┘   └──────────┘   └──────────────────────┘  │
│       ↑                                      ↓            │
│       │         ┌────────────────────────────┐            │
│       └─────────│  Store（跨会话）            │            │
│                 │  user: alice               │            │
│                 │  facts: ["不吃花生", ...]   │            │
│                 └────────────────────────────┘            │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Checkpointer（会话内）                               │ │
│  │  thread_id = session-003                             │ │
│  │  state snapshot after each node                      │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## 面试常问追问

- **Q：checkpointer 和 store 什么关系？**  
  → checkpointer 是"会话级快照"（同 thread_id 可续跑）；store 是"跨会话共享数据"（不同 thread_id 也能读写同一份数据）。前者自动，后者手动读写。

- **Q：如果不用 LangGraph，自己怎么做跨会话记忆？**  
  → 本质就是：① 每轮对话结束时，LLM 抽取重要事实 ② 存到向量库（按 user_id 做 namespace）③ 下轮对话前，按当前 query 搜相关记忆 ④ 注入 system prompt。这就是 Mem0 做的事，LangGraph 只是把它结构化到 store 里。

- **Q：store 里存什么格式？**  
  → `value` 是任意 dict，`key` 自己设计（可以是 UUID / 时间戳 / 事实分类）。搜索时按 query 做语义检索（如果 store 有 embed 函数）或者按 namespace + key 前缀过滤。

- **Q：用户数据隔离怎么保证？**  
  → namespace 设计是关键：`("memories", user_id)` 这个 tuple 就是隔离边界；应用层确保每个请求传入正确的 user_id，不同用户的 store 搜索不跨 namespace。

- **Q：你们（你们）的 Agent 怎么管记忆的？**  
  → 重新 frame 你的 Dify 经验：「我们在大模型应用平台里用的是会话级 context（相当于 checkpointer 的思路），跨会话的上下文通过业务层的任务 ID 传递，没有做用户级的长期记忆存储。LangGraph 的 store 方案解决的是更通用的跨会话记忆问题，这是我们下一步想引入的方向。」

## 我的记法

- **checkpointer = 断点续跑的快照**（thread_id 隔离，会话内）
- **store = 用户的长期记忆库**（user_id 隔离，跨会话）
- 两个 config key：`thread_id`（会话）+ `user_id`（用户）
- store 操作：`store.put(namespace, key, value)` / `store.search(namespace, query)`
- 一句话：**「checkpointer 让 Agent 不失忆，store 让 Agent 记得你」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版（checkpointer vs store 区别）
- [ ] 能答追问
- [ ] 跑过 LangGraph store hello world

## 参考资料
- [LangGraph Memory 概念文档](https://langchain-ai.github.io/langgraph/concepts/memory/)
- [LangGraph Store API](https://langchain-ai.github.io/langgraph/reference/store/)
- [LangGraph 跨线程持久化教程](https://langchain-ai.github.io/langgraph/how-tos/cross-thread-persistence/)
- [LangGraph Redis Store](https://langchain-ai.github.io/langgraph/reference/store/#langgraph.store.redis.AsyncRedisStore)
