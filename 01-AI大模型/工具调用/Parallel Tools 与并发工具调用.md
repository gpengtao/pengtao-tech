---
tags: [P1, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---

# Parallel Tools 与并发工具调用

## 一句话速记

`parallel_tool_calls=True`（OpenAI/Claude 默认开启）让模型一轮可以同时输出**多个 tool_calls**，**调用方有义务并发执行所有调用、再按 `tool_call_id` 一一回喂**。串行执行 = 浪费一半延迟。但要防三个坑：① 工具间有依赖时模型不该 parallel ② 副作用工具并发要保证幂等 ③ 上下文成本会涨（多个工具结果同时回喂）。

## 通俗解释（5 分钟版）

**为什么需要 parallel tools**：
- 用户："帮我查一下北京、上海、深圳三个城市的天气"
- 早期 Function Calling：LLM 串行调 3 次 `get_weather`，每次一来一回 = **3 次 LLM 调用 + 3 次工具调用** = 总延迟 6 跳
- 现在：LLM 一次输出 3 个 `tool_calls`，调用方并发执行 = **2 次 LLM 调用 + 1 次并发** = 总延迟 3 跳

```
   [串行]
   user → LLM → tool A → LLM → tool B → LLM → tool C → LLM → reply
   总延迟 ≈ 4·LLM + 3·tool

   [并行]
   user → LLM → ┐tool A
                ├tool B → LLM → reply
                └tool C
   总延迟 ≈ 2·LLM + max(tool A, B, C)
```

**响应里长这样**：

```json
{
  "tool_calls": [
    {"id": "c1", "function": {"name": "get_weather", "arguments": '{"city":"Beijing"}'}},
    {"id": "c2", "function": {"name": "get_weather", "arguments": '{"city":"Shanghai"}'}},
    {"id": "c3", "function": {"name": "get_weather", "arguments": '{"city":"Shenzhen"}'}}
  ]
}
```

**正确的执行方式（Python async）**：

```python
import asyncio

async def execute_one(call):
    args = json.loads(call.function.arguments)
    result = await tools[call.function.name](**args)
    return {"role": "tool", "tool_call_id": call.id, "content": json.dumps(result)}

if msg.tool_calls:
    # asyncio.gather 并发执行所有 tool_calls
    results = await asyncio.gather(*(execute_one(c) for c in msg.tool_calls))
    messages.extend(results)
```

**串行实现就是反模式**：

```python
# 反模式
for call in msg.tool_calls:
    result = sync_tool(call)   # 一个一个等，浪费
    messages.append(result)
```

## 关键细节 / 数学直觉

### 1）开关与默认值

OpenAI：
```python
client.chat.completions.create(
    ...,
    parallel_tool_calls=True,  # GPT-4 系列默认 True
)
```

Anthropic Claude：默认就支持 parallel tool use（无需开关），可以通过 prompt 提示模型尽量并发。

### 2）什么时候应该关掉并行

并行不是任何场景都更优。**关掉的两个场景**：

**a) 工具间有数据依赖**：

```
任务：查一下我账户余额，然后转 100 给 Alice
   step1: get_balance() → 1500
   step2: transfer(to=Alice, amount=100)   ← 必须等 step1 结果

如果 LLM 把这俩 parallel 调用，transfer 时就还不知道余额够不够 ── 错误
```

**对策**：在工具 description 里**明确写**"先调 X，再调 Y"，引导模型生成串行 tool_calls。

**b) 副作用 + 不幂等的工具**：

并发 fire 多个 `send_email()` 没问题（幂等性自己处理）；但并发 `transfer()`、`create_order()` 容易踩坑——除非每个调用带不同 idempotency_key。

### 3）回喂顺序的坑

```python
messages = [
  ...,
  assistant_message_with_tool_calls,   # 一条 assistant 消息含 N 个 tool_calls
  {"role":"tool","tool_call_id":"c1","content":...},
  {"role":"tool","tool_call_id":"c2","content":...},
  {"role":"tool","tool_call_id":"c3","content":...},
  # 必须每个 tool_call_id 都有对应一条 tool 消息
]
```

**铁律**：
- 每个 `tool_call_id` 都要有对应一条 `role=tool` 的回喂——少一个就 400 报错
- 回喂消息的**顺序无所谓**（OpenAI/Anthropic 都按 id 匹配）
- 失败的 tool 也要回喂一条（content 写 error message），**绝不能漏**

### 4）超时与失败聚合

并发执行时，要不要等所有都结束才回喂 LLM？还是有一个超时就走？

```python
async def execute_all_with_timeout(calls, timeout=20):
    tasks = [execute_one(c) for c in calls]
    results = []
    done, pending = await asyncio.wait(tasks, timeout=timeout)
    for task in pending:
        task.cancel()
        results.append({"role":"tool", "tool_call_id":..., "content":"timeout"})
    for task in done:
        results.append(task.result())
    return results
```

经验：**所有都等到结束**（成功 or 失败 or 超时），让 LLM 看到完整画面再决定下一步。

### 5）成本 / 上下文影响

并行的隐藏代价：
- N 个 tool 同时回喂 = N 个工具结果都进 context = **下一次 LLM 调用的输入暴涨**
- 工具结果如果是大对象（图像/长文档），**很容易把 context 撑到上限**

**对策**：
- 工具结果做摘要再回喂（特别是大对象）
- state 里只存"有用的几条"，对 LLM 隐藏完整结果，只把必要 summary 喂入

### 6）和 Multi-Agent 的关系

多 Agent supervisor 模式下，supervisor 决定**同时 dispatch 给多个专家**就是高级版 parallel——每个专家是一个独立 LangGraph 节点。LangGraph 的 `Send` 原语就是干这事：

```python
def supervisor(state) -> list[Send]:
    return [
        Send("researcher_agent", {"task": "查 A"}),
        Send("researcher_agent", {"task": "查 B"}),
        Send("researcher_agent", {"task": "查 C"}),
    ]
```

三个分支并发跑，结果通过 reducer 合回主 state。

## 延伸追问

- **Q：** 模型会不会"该并行不并行"或"不该并行硬并行"？
  → 都会。**该并行不并行**：prompt 里写"先调 X 后调 Y"——容易被理解成必须串行；**不该并行硬并行**：工具 description 写得太通用——LLM 觉得无依赖。**对策**：description 写清"调用前提条件"，参数依赖关系里显式描述。
- **Q：** Parallel 失败一个怎么办？
  → 失败的也回喂一条 error message，**让 LLM 看到全局**：可能它会基于成功的那两个继续，或者决定重试失败的那个。比静默吞掉好。
- **Q：** 具身机器人的"动作"工具能并行吗？
  → **极度小心**。能解耦的子任务（左手抓 + 右手抓）可以并行，但要严格的 mutex 保证（避免同一执行器并发命令）；规划层一般**强制串行**安全，性能损失换可控。
- **Q：** 怎么测 parallel 的正确性？
  → 单测：mock 工具，断言 N 个调用都被并发触发（用 timing 或 counter）；集成测：跑一段任务，看 trace 里 tool_calls 的并行度统计。

## 我的记法

- **能并行就并行**：默认开，工具结果 `asyncio.gather` 一起拿
- **三个不并行场景**：依赖、不幂等、动作执行
- **回喂铁律**：每个 `tool_call_id` 都要有对应 result，**少一个直接 400**
- **隐藏代价**：context 暴涨——大结果记得做 summary
- 一句话：**「parallel tools 不是模型聪明，是工程同学把 `gather` 写对了」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 在 demo 里跑通过 parallel tool calls 的 asyncio.gather

## 参考资料
- [OpenAI parallel function calling](https://platform.openai.com/docs/guides/function-calling#parallel-function-calling)
- [Anthropic Parallel Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/parallel-tool-use)
- [LangGraph Send / Map-Reduce 模式](https://langchain-ai.github.io/langgraph/how-tos/map-reduce/)
