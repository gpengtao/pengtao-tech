---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/_MOC]]"
---

# Agent 的错误恢复与 checkpoint 怎么做

## 一句话速记

**Agent 的可靠性 ≠ 模型聪明，而是工程兜底**：每个节点完成后落 **checkpoint**（状态 + 历史），失败时按错误类型分级恢复——**幂等错误重试、确定性错误兜底、模型幻觉换 prompt、未知错误升级人工**。具身场景额外要求：**断电不丢任务、人审才能动**，所以 checkpoint 不是可选项。

## 通俗解释（5 分钟版）

**Agent 失败的几种典型方式**：

| 失败类型 | 例子 | 怎么处理 |
|---|---|---|
| 网络抖动 / 限流 | OpenAI 5xx、429 | **指数退避重试** |
| 工具参数幻觉 | LLM 把 `user_id=123` 写成 `user_id="abc"` | **不能盲重试**（会再幻觉），重新生成 + schema 校验 |
| 工具业务报错 | 库存不足、权限拒绝 | 把错误**回喂**给 LLM 让它换路径 |
| 模型死循环 | 同一个工具调用 5 次还失败 | **熔断**，跳到 fallback 或升级人工 |
| 进程崩溃 / 重启 | k8s 滚动、OOM | **从 checkpoint 续跑** |
| 上下文超长 | message 撑爆 32K | **窗口/摘要压缩** |

**核心思想**：把 Agent 当作**长事务工作流**对待——不能假设一路顺利，每一步都要可中断、可重放。

**Checkpoint 落点**：

```
   每个节点结束        每次工具调用前后        每轮 LLM 调用后
        ▼                    ▼                       ▼
   ┌──────────────────────────────────────────────────────┐
   │   checkpointer (SQLite/Postgres/Redis)               │
   │   thread_id → [v1, v2, v3, ...] (state snapshots)    │
   └──────────────────────────────────────────────────────┘
                        ▲
                        │
   崩溃恢复 / HITL 续跑 / 时间旅行调试 / 多分支探索
```

**LangGraph 提供的能力**（也是其他框架的参照系）：
- `checkpointer=...`：每个节点跑完自动 dump state
- `interrupt_before=[...]` / `interrupt_after=[...]`：自动暂停等外部 resume
- `app.get_state(config)`：读历史状态
- `app.update_state(config, values)`：手动改状态再续跑（**HITL 编辑**）
- 多版本：每次状态变更都有版本号，可以回到任一版本「重新分支」

## 关键细节 / 数学直觉

### 1）错误分类决策树

```python
def classify_error(exc, context) -> ErrorClass:
    if isinstance(exc, (RateLimitError, APIConnectionError, TimeoutError)):
        return RETRY_WITH_BACKOFF       # 网络/限流：指数退避
    if isinstance(exc, ToolValidationError):
        return REGENERATE_NO_RETRY      # schema 不对：让 LLM 重新生成（不喂错误参数）
    if isinstance(exc, BusinessError):
        return FEED_BACK_TO_LLM         # 业务错误：把错误信息变 observation 喂回去
    if exc.is_safety_violation:
        return ESCALATE_TO_HUMAN        # 安全：直接停，人工介入
    return ESCALATE_TO_HUMAN            # 兜底：未知错误升级
```

**重点**：**幻觉参数不能盲重试**。例子：

```
LLM: call_tool(user_id="abc")  → ValidationError: user_id 必须是整数
[盲重试场景] 把错误信息塞回历史，LLM 大概率还会写错，浪费 token
[正确做法] 在 system prompt 里强化 schema 描述 + 加个 example，重新生成
```

### 2）重试策略要带「成本意识」

```python
@retry(
    retry=retry_if_exception_type((RateLimitError, ConnectionError)),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(5),
    reraise=True,
)
def call_llm(...):
    ...
```

**坑**：不要无脑给整个 Agent 加 `@retry(stop_after_attempt=10)`——一个 Agent step 失败重试 10 次 = 10 次 LLM 调用 = 10 倍成本。重试应该**分层**：

- **L1 网络层**：HTTP client 自带的重试（毫秒级）
- **L2 工具层**：单个工具调用 1-2 次（秒级）
- **L3 节点层**：节点函数 0-1 次（基本不重试，靠 graph 改 state 重走）
- **L4 流程层**：整个 graph 不自动重试，只让人/上层系统决定

### 3）熔断 + Fallback（具身刚需）

死循环防御：state 里加个 `step_count` 和 `tool_failure_count`，路由判断：

```python
def route_after_tool(state):
    if state["tool_failure_count"] >= 3:
        return "human_handoff"      # 失败太多升人工
    if state["step_count"] >= 30:
        return "summarize_and_stop" # 步数爆了停下总结
    if has_pending_tool_calls(state):
        return "tools"
    return END
```

具身场景要更狠：「**安全边界违反 → 立即停止 + 复位本体**」是硬约束，不是 best-effort。

### 4）Checkpoint 存储选型

| 后端 | 适用 | 性能 | 备注 |
|---|---|---|---|
| InMemorySaver | 调试 / 单进程 demo | 最快 | 重启丢 |
| SqliteSaver | 单机 / 边缘设备（具身机器人本机） | 快 | 无并发问题 |
| PostgresSaver | 生产 / 多租户 | 中 | 推荐生产首选 |
| RedisSaver | 高并发短任务 | 最快 | 持久化要配置好 |

具身场景如果机器人本身要跑 agent，本地 SQLite 是务实选择——断网也能续跑。

### 5）HITL（Human-in-the-Loop）的标准模式

```python
graph.compile(
    checkpointer=memory,
    interrupt_before=["robot_actuate"],   # 真正动机器人前必停
)

# 跑到 robot_actuate 前自动暂停
result = app.invoke({...}, config)

# 把 state 推到前端给操作员看
state = app.get_state(config)
# 操作员说"这步不对，先去做 X"
app.update_state(config, {"plan": "modified plan"})

# 续跑
app.invoke(None, config)
```

## 延伸追问

- **Q：** 重试和 idempotency 是什么关系？
  → 重试**只能用于幂等操作**。「转账 100 块」不幂等，重试可能扣两次；得在工具侧加 idempotency_key（业务侧去重）。Agent 框架要把这一点暴露给开发者，而不是无脑 retry。
- **Q：** Checkpoint 数据怎么治理（隐私 / 数据保留）？
  → state 里大概率有用户输入、工具返回、LLM 中间思考，要有 TTL；按租户隔离；脱敏字段（PII）落库前过滤。这块大体系工程师反而比 LLM 工程师更敏感。
- **Q：** Agent 节点是否要做 timeout？
  → 必做。每个节点设 timeout（含 LLM 调用 + 工具调用），超时落败转入错误分类树。LLM 在 long-context 下偶发 30s+，**不设 timeout 整个 graph 就卡死**。
- **Q：** 怎么调试 checkpoint 引发的"诡异"问题？
  → state 字段没设对 reducer，并发节点相互覆盖；或者 state 太大导致 checkpoint 写入慢。**对策**：state 字段都打类型 + reducer 写明确，超过 KB 级数据放外存（S3）只在 state 里存 reference。

## 我的记法

- 错误分类四象限：**网络 / 幻觉 / 业务 / 未知** —— 处理策略不一样
- 重试**分层**：L1 网络 / L2 工具 / L3 节点 / L4 流程，**不要叠加**
- Checkpoint 三件套：**state 落库 + interrupt 暂停 + update_state HITL**
- 具身场景：**断电不丢任务、人审才动作**——checkpoint 是硬要求不是 nice-to-have
- 一句话：**「Agent 的鲁棒性靠的是兜底，不是聪明」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 LangGraph 跑通过一次 checkpoint + interrupt

## 参考资料
- [LangGraph Persistence 文档](https://langchain-ai.github.io/langgraph/concepts/persistence/)
- [LangGraph Human-in-the-loop 教程](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/)
- [Tenacity 重试库文档](https://tenacity.readthedocs.io/en/latest/)
