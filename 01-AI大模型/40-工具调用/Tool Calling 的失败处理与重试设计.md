---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---
# Tool Calling 的失败处理与重试设计

## 一句话速记

工具调用失败的**正确思路是分类处理而不是统一重试**：① **Schema 失配 / 参数幻觉** → 把校验错误回喂 LLM 重新生成，**禁止盲重试** ② **工具内部业务报错**（库存不足等）→ 回喂错误信息让 LLM 换路径 ③ **网络/限流** → 指数退避重试 ④ **死循环 / 步数爆炸** → 熔断 + 升级人工。**重试要分层**（HTTP 客户端 / 工具 / Agent），每层最多 1-2 次，叠加起来不能爆炸。

## 通俗解释（5 分钟版）

工具调用失败有 **5 种典型原因**，对应**完全不同的处理策略**：

```
┌──────────────────────────────────────────────────────────────┐
│  失败类型              典型表现           正确处理策略         │
├──────────────────────────────────────────────────────────────┤
│ ① Schema 失配          类型/必填字段错    回喂 ValidationError │
│   （参数幻觉）          + 报错             让 LLM 重新生成     │
│                                          ❌ 不要盲重试         │
│                                                                │
│ ② 业务错误              "库存不足"        把 error 当          │
│                        "权限拒绝"          observation 回喂    │
│                        "用户不存在"        让 LLM 换路径        │
│                                                                │
│ ③ 网络/限流              5xx/429/timeout   ✅ 指数退避重试     │
│                        DNS 失败           （HTTP 客户端层）    │
│                                                                │
│ ④ 死循环 / 步数爆炸     同一工具连失 N 次  熔断 → fallback     │
│                                          → 升级人工           │
│                                                                │
│ ⑤ 安全/权限违反         越权访问          直接停 + 不重试      │
│                                          + 告警               │
└──────────────────────────────────────────────────────────────┘
```

**最常踩的坑：把所有失败统一无脑重试**——

- ② 业务错误重试 = 重试还是失败（库存就是没了）
- ① 幻觉参数重试 = 模型可能再幻觉 + 浪费 token
- 重试嵌套（HTTP retry × 工具 retry × Agent retry）= **真实重试次数指数膨胀**，10 倍成本+10 倍延迟+被对方 ban

### 失败处理的标准 SOP

```
   tool_call ──执行──► 成功 ──► 回喂 result ──► LLM 继续
                  │
                  └─失败─┐
                         ▼
                    ┌────────┐
                    │ 分类   │
                    └────┬───┘
                         │
        ┌────────────────┼────────────────────────────┐
        ▼                ▼                            ▼
  网络/限流         schema/业务错                  安全违反
        │                │                            │
   指数退避×N       回喂 LLM                      直接停
        │           （带 try_count）                  │
        ▼                │                            ▼
   仍失败 → 升级    超过 N 次 → 升级              人工介入
```

## 关键细节 / 数学直觉

### 1）幻觉参数的处理（最常见）

```python
def execute_tool(call):
    try:
        validated_args = ToolSchema(**json.loads(call.arguments))  # Pydantic 校验
    except ValidationError as e:
        # 不重试！把错误当 observation 回喂
        return {
            "role": "tool",
            "tool_call_id": call.id,
            "content": f"参数校验失败：{e.errors()}。请按 schema 重新生成参数。"
        }
    return real_tool_execute(validated_args)
```

**为什么不能盲重试**：
- 模型已经"看过"了上一次它生成的错误参数
- 直接重新生成同样 prompt = 大概率同样错误
- 把 error 喂回去 = 模型有了新的 observation，**才有机会改正**

### 2）业务错误的"软失败"模式

```python
try:
    result = my_tool(args)
except BusinessError as e:
    return {
        "role": "tool",
        "tool_call_id": call.id,
        "content": f"工具调用未成功：{e.public_message}。可能的原因：{e.hint}"
    }
```

**关键**：
- `public_message` 不要把内部异常栈直接抛给 LLM（既泄漏信息又不利于模型理解）
- 错误信息要**结构化、人类可读、给出 hint**（"用户不存在 → 请确认 user_id 是否正确，或先调 search_user"）

### 3）网络层重试要在最低层做

```python
import httpx
from tenacity import retry, wait_exponential, retry_if_exception_type, stop_after_attempt

@retry(
    retry=retry_if_exception_type((httpx.TimeoutException, httpx.HTTPStatusError)),
    wait=wait_exponential(multiplier=1, min=1, max=30),
    stop=stop_after_attempt(3),
    reraise=True,
)
async def call_remote_api(...):
    ...
```

**坑**：
- `HTTPStatusError` 要分 4xx 和 5xx——4xx 多是参数问题不该重试，5xx/429 才重试
- 限流要看 `Retry-After` header，**别用固定 backoff**（被对方继续 ban）
- 重试要带 jitter（`wait_exponential_jitter`），避免雪崩同步

### 4）幂等性是重试的前提

```
转账 100 块（不幂等） → 重试可能扣两次 → 真实事故
查询余额（天然幂等） → 随便重试

不幂等的工具一定要 idempotency_key（业务侧去重）：
  tool_call(transfer, amount=100, idempotency_key="abc-123")
  服务端：见过 abc-123 就直接返回上次结果
```

LangGraph 的工具节点重试逻辑**对此不感知**——是工具实现侧要保证幂等。Agent 框架文档普遍弱化这点，但生产事故大多源于此。

### 5）熔断与步数爆炸

```python
class State(TypedDict):
    messages: Annotated[list, add_messages]
    tool_failures: dict[str, int]   # 每个工具的失败计数
    step_count: int

def should_continue(state):
    if state["step_count"] >= 30:
        return "summarize_and_stop"  # 步数硬上限
    last_call = get_last_tool_call(state)
    if last_call and state["tool_failures"].get(last_call.name, 0) >= 3:
        return "fallback_or_human"   # 同工具连失 3 次熔断
    if state["messages"][-1].tool_calls:
        return "tools"
    return END
```

**典型阈值**（产品经验值）：
- 单 Agent step 上限：**20-30**（含 LLM + tool 各一次算一步）
- 单工具连失上限：**3 次**
- 整个 Agent 任务总 token 上限：项目里**先估算**，超过就杀

### 6）重试分层（最易混淆的部分）

| 层 | 重试对象 | 重试次数 | 策略 |
|---|---|---|---|
| **L1 HTTP 客户端** | 单次 HTTP 请求 | 2-3 | 指数退避（毫秒级） |
| **L2 工具适配器** | 单次工具调用（含转换） | 0-1 | 仅幂等工具 |
| **L3 Agent 节点** | 单个图节点 | **0**（基本不重试） | 失败抛 → 路由处理 |
| **L4 Agent 流程** | 整个任务 | **0**（不自动） | 人/上层系统决定 |

**铁律**：每层独立看似各只重试 2 次，**叠加** = 2×2×2×2 = **16 倍真实调用**。一定要审视全链路。

## 延伸追问

- **Q：** Function Calling 的 `tool_calls` 顺序错了 / id 对不上怎么办？
  → 服务端实现要做防御：① `tool_call_id` 严格匹配 ② 缺失 result 的 call 要补一条 "tool execution skipped" 而不是直接漏 ③ 顺序通常无所谓但要保证 message 数量配齐。
- **Q：** Streaming 模式下工具调用怎么处理？
  → SSE/streaming 会把 `tool_calls` 分片返回，要在 client 端累积完整再执行。LangChain `bind_tools()` + streaming 已封装好。
- **Q：** 同一个工具被 LLM 反复调（轻微幻觉自循环）怎么破？
  → ① state 里跟踪「(tool_name, args_hash) → count」，相同参数调过 N 次直接拒绝并提示模型 ② prompt 提醒"已经调过 X，结果是 Y，请基于此推进而不是再调"。
- **Q：** 工具调用监控关键指标有哪些？
  → ① 调用成功率（按工具）② 平均调用延迟（p50/p99）③ 调用次数分布（看看哪些工具被滥用）④ 平均每任务 step 数（涨了说明任务复杂或模型变笨）⑤ 失败分类比例（schema/business/network/safety）。

## 我的记法

- **5 类失败、5 种处理**：schema → 回喂 / 业务 → 回喂 / 网络 → 退避 / 熔断 → fallback / 安全 → 停
- **盲重试是反模式**——参数幻觉、业务错误绝不能盲重
- **重试分 4 层**：HTTP / 工具 / 节点 / 流程，**每层最多 1-2 次**
- **不幂等的工具必须 idempotency_key**——业务侧的责任
- 熔断三件套：**单工具失败次数 / 总 step 数 / 总 token 数**
- 一句话：**「Agent 的稳定性取决于失败处理的颗粒度，不是模型能力」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 在自己 demo 里实现过一次完整失败分类处理

## 参考资料
- [Tenacity 重试库](https://tenacity.readthedocs.io/)
- [LangGraph 错误处理与回退](https://langchain-ai.github.io/langgraph/how-tos/tool-calling-errors/)
- [Idempotency Patterns (Stripe Engineering)](https://stripe.com/blog/idempotency)
