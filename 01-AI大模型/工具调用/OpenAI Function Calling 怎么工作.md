---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: [[_专题-具身Agent/_MOC]]
---

# OpenAI Function Calling 怎么工作

## 一句话速记

**Function Calling = 把工具签名（JSON Schema）塞进 prompt，让模型用结构化 JSON 输出"我要调谁、参数是啥"**。模型本身**不调工具**——它只产 `tool_calls` 字段，**真正执行靠你**。然后把结果（`role: tool`）回喂给模型继续生成。底层就是「**结构化输出 + 约定字段名**」，不是什么黑魔法。

## 通俗解释（5 分钟版）

**先纠正一个普遍误解**：很多人以为 Function Calling 是模型"自己调用了 API"——**不是**。模型只是输出一段 JSON 说「我想调 `get_weather(city='Beijing')`」，**真正发请求的是你的代码**。整个交互长这样：

```
   ┌─────────────────────────────────────────────────────────────┐
   │  Round 1                                                     │
   │  你 ─┐                                                        │
   │     │ messages: [{"role":"user","content":"北京天气"}]        │
   │     │ tools: [{"name":"get_weather","parameters":{...}}]      │
   │     ▼                                                          │
   │   OpenAI                                                       │
   │     │                                                          │
   │     │ 输出 message: tool_calls=[{"id":"c1","name":"get_weather"│
   │     │                            ,"args":{"city":"Beijing"}}]  │
   │     ▼                                                          │
   │   你 ── 你的代码执行 get_weather("Beijing") → "10°C"           │
   └─────────────────────────────────────────────────────────────┘
   ┌─────────────────────────────────────────────────────────────┐
   │  Round 2                                                     │
   │  你 ─┐                                                        │
   │     │ messages: [user, assistant(tool_calls), tool(result)]  │
   │     ▼                                                          │
   │   OpenAI                                                       │
   │     │                                                          │
   │     │ 输出: "北京现在 10°C"                                    │
   │     ▼                                                          │
   │   返回用户                                                      │
   └─────────────────────────────────────────────────────────────┘
```

**两个核心字段**：

1. 请求里的 **`tools`**：一个数组，每项是一个工具的 JSON Schema 描述
2. 响应里的 **`tool_calls`**：模型决定要调用哪些工具，参数是什么

**为什么是 JSON Schema 而不是自然语言**：
- 自然语言描述工具，模型生成时偏差大、参数易错
- JSON Schema 给模型一个**严格的语法 grammar**——很多推理引擎（vLLM/SGLang）会用 grammar-constrained decoding 强制输出符合 schema 的 token
- 调用方拿到 JSON 直接 `json.loads()`，不用正则匹配自然语言

## 关键细节 / 数学直觉

### 1）最小例子（OpenAI SDK，2024+）

```python
from openai import OpenAI
client = OpenAI()

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "查询某城市天气",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "城市名"},
                "unit": {"type": "string", "enum": ["celsius","fahrenheit"]}
            },
            "required": ["city"]
        }
    }
}]

resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role":"user","content":"北京天气如何"}],
    tools=tools,
    tool_choice="auto",   # 也可以 "required" 强制必调，或 {"type":"function","function":{"name":"get_weather"}} 指定
)

msg = resp.choices[0].message
if msg.tool_calls:
    for call in msg.tool_calls:
        args = json.loads(call.function.arguments)
        result = my_tools[call.function.name](**args)
        # 把 result 以 role=tool 回喂
```

### 2）回喂时的 message 结构

```python
messages = [
    {"role":"user","content":"北京天气如何"},
    {"role":"assistant","content": None,
     "tool_calls":[{
         "id":"call_abc",
         "type":"function",
         "function":{"name":"get_weather","arguments":'{"city":"Beijing"}'}
     }]},
    {"role":"tool",
     "tool_call_id":"call_abc",          # 必须对应 id
     "content":'{"temp":10,"unit":"C"}'}
]
```

**`tool_call_id`** 是关键——模型多次调用时，要靠这个 id 把每次结果对回去。

### 3）`tool_choice` 三种模式

- `"auto"`（默认）：模型自己决定调不调、调谁
- `"required"`：必须调一个工具（无论模型想不想）
- `"none"`：禁止调工具
- `{"type":"function","function":{"name":"X"}}`：强制调指定工具

**应用场景**：
- 路由：先 `tool_choice="required"` 让 LLM 选意图分类工具 → 拿到结果后再 `tool_choice="auto"` 进入业务对话
- 强制结构化输出：把 schema 包成一个 fake 工具 + `required` 调用 = 强制 JSON 输出

### 4）`parallel_tool_calls` —— 一次调多个

GPT-4 后默认开启：模型一次响应可以同时返回**多个 tool_calls**，你应该并发执行所有，再按 `tool_call_id` 一一回喂。

```json
"tool_calls": [
  {"id":"c1", "function":{"name":"get_weather","arguments":'{"city":"Beijing"}'}},
  {"id":"c2", "function":{"name":"get_weather","arguments":'{"city":"Shanghai"}'}}
]
```

**坑**：把它们串行执行 = 浪费一半延迟。务必用 `asyncio.gather` 之类并发。

### 5）和 Anthropic Tool Use 的差别

Anthropic Claude 也支持类似的工具调用，但字段名稍微不同：
- 工具描述字段叫 `tools`（同），但里面每项直接是 `{"name":..., "description":..., "input_schema":...}`，没有 `type:function` 包一层
- 响应里调用块叫 `tool_use`（不是 `tool_calls`），返回时 message role 用 `tool_result`
- 流式协议略不同

**结论**：差别都是包装层的，**核心思路一致**——「JSON Schema in、tool_calls out」。LangChain/LangGraph 帮你抹平了这些差异。

### 6）工具描述的 prompt 工程

模型不会读你的代码，**只看 JSON Schema 里的 `description` 和 `parameters.properties.*.description`**。所以：
- 工具名要清晰（`search_doc` 比 `f1` 好）
- description 写**什么时候用 + 什么时候不要用**
- 参数 description 写格式约束（"日期格式 YYYY-MM-DD"）
- 给关键参数加 `enum` 枚举值，模型不会乱编

## 延伸追问

- **Q：** 模型为什么会"幻觉"参数（瞎编一个不存在的城市名）？
  → 因为 LLM 对 schema 的遵守是软约束（除非引擎做了 grammar-constrained decoding）。**对策**：参数侧加 enum 限制；服务端校验失败时把错误信息回喂让模型重试；或者直接用 vLLM/SGLang 的 structured output 模式。
- **Q：** 工具数量上限是多少？
  → 没有硬上限，但工具一多 prompt 膨胀 + 模型选错。**经验**：超过 20 个工具就要做**两阶段路由**——先选大类，再选具体工具。或者用 RAG 检索相关工具的 schema 注入。
- **Q：** Function Calling 和 JSON mode 有什么关系？
  → JSON mode 只保证输出是合法 JSON，但 schema 不保证；Function Calling 给了**带 schema 约束的 JSON 输出**，是更强的子集。最新模型还有 **Structured Outputs** 模式（2024+），从架构层面 100% 保证 schema 一致。
- **Q：** 工具结果太大（比如 10MB 的 PDF 文本）能直接回喂吗？
  → 不能。要么先用嵌入/摘要预处理 + RAG，要么把全文存外存只回喂引用。回喂大块文本会撑爆 context 而且贵。

## 我的记法

- **模型不调工具，只输出 tool_calls** —— 调用方法是你的代码
- 三个关键字段：`tools` / `tool_calls` / `tool_call_id`
- **JSON Schema 是 grammar**，让模型输出可解析的结构化结果
- `tool_choice` 控制：auto / required / none / 指定
- `parallel_tool_calls` —— 并发执行别串行
- 一句话：**「Function Calling = 给模型一份"菜单"，让它点菜；上菜还是你自己」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 在代码里跑通过一次 tool_calls 闭环

## 参考资料
- [OpenAI Function Calling 官方文档](https://platform.openai.com/docs/guides/function-calling)
- [OpenAI Structured Outputs 公告](https://openai.com/index/introducing-structured-outputs-in-the-api/)
- [Anthropic Tool Use 文档](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
