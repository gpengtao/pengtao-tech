---
tags: [P1, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---

# Agent 评测怎么做 LangSmith 与 RAGAS

## 一句话速记

**Agent 评测 = 在四个层次上同时跑：单步对/错（unit-style）、轨迹对/错（trajectory）、最终结果对/错（end-to-end）、成本/延迟/安全（运营指标）**。**LangSmith** 是 LangChain 团队的**全链路评测+追踪平台**（trace + dataset + evaluator + 标注），生态最全；**RAGAS** 是**专门给 RAG 场景的指标库**（faithfulness、answer relevancy、context precision/recall），轻量、可独立跑。生产 Agent 系统通常**LangSmith 做主**（trace + 灰度回归），**RAGAS 嵌进去**（RAG 子系统的指标计算）。

## 通俗解释（5 分钟版）

**先理解 Agent 评测的难点**：
- 传统 ML 评测：模型输出 vs 标签，accuracy / F1 / RMSE 一刀切
- LLM Agent：① 输出**自由文本** ② 路径**多种合理** ③ 调**工具有副作用** ④ 多轮交互**状态可变** ⑤ 错误**层层叠加**

**所以 Agent 评测要分层考察**：

```
┌──────────────────────────────────────────────────────┐
│  四层评测金字塔                                        │
│                                                        │
│  ① End-to-End 输出                                     │
│     "用户问北京天气，最终回答是不是有用？"             │
│     方法：人工标 / LLM-as-judge / 任务成功率          │
│                                                        │
│  ② Trajectory（轨迹）                                  │
│     "Agent 走的步骤合理吗？少调/多调/错调工具？"      │
│     方法：trace 检查 / 轨迹与"理想路径" diff           │
│                                                        │
│  ③ Single Step                                         │
│     "这一步 LLM 输出 / 工具调用对不对？"               │
│     方法：单元测试式 — 给定 input，断言 output 字段    │
│                                                        │
│  ④ 运营指标                                            │
│     成本 / 延迟 (TTFT, P99) / token 消耗 / 失败率      │
│     方法：监控告警，时序看板                            │
└──────────────────────────────────────────────────────┘
```

**只看最终输出**会误诊：模型答对了，但中间多调 5 次工具——成本爆炸；或答错了，但只是工具失败——不是模型笨。**多层评测才能定位"哪一层出问题"**。

### LangSmith 是什么

LangChain 团队的**Agent 全链路平台**，三件套：

```
   ┌────────────────────────────────────────────────────┐
   │  ① Trace（追踪）                                    │
   │     - 每次 Agent 运行的全流程 timeline             │
   │     - 每个 LLM 调用的 prompt/response/token        │
   │     - 每次工具调用的 input/output/duration         │
   │     - 错误堆栈                                      │
   │                                                      │
   │  ② Dataset（数据集）                                │
   │     - 把生产 trace 一键存成 eval dataset            │
   │     - 标注（"这个回答好/坏"）                       │
   │     - Versioning                                    │
   │                                                      │
   │  ③ Evaluator（评估器）                              │
   │     - 跑 dataset → 各种 evaluator 打分              │
   │     - 内置 evaluator：correctness、helpfulness 等   │
   │     - 自定义 evaluator：自己写 LLM-as-judge prompt  │
   │     - 对比两个版本（baseline vs new）               │
   └────────────────────────────────────────────────────┘
```

**和 LangChain/LangGraph 原生集成**——加 `LANGCHAIN_TRACING_V2=true` 和 `LANGCHAIN_API_KEY` 两个环境变量，所有运行自动上传 trace。

### RAGAS 是什么

**专门为 RAG 场景**设计的开源指标库。核心 4 个指标：

| 指标 | 衡量什么 | 是不是要 ground truth |
|---|---|---|
| **Faithfulness** | 回答是否完全依据检索结果（不编造） | 否（只看检索结果 + 回答） |
| **Answer Relevancy** | 回答是否切题 | 否（只看 query + 回答） |
| **Context Precision** | 检索到的 context 是不是都相关（噪声多吗） | 是（要标准答案） |
| **Context Recall** | 标准答案需要的信息是否都被检索到 | 是（要标准答案） |

**实现机制**：每个指标背后是**一段精心设计的 LLM-as-judge prompt**——把 query/context/answer 喂给一个 judge LLM 让它打分。

```python
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy, context_precision

result = evaluate(
    dataset,                    # 含 question, answer, contexts, ground_truth
    metrics=[faithfulness, answer_relevancy, context_precision],
)
print(result)
# faithfulness: 0.85, answer_relevancy: 0.91, context_precision: 0.78
```

## 关键细节 / 数学直觉

### 1）LangSmith 最简代码

```python
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "..."
os.environ["LANGCHAIN_PROJECT"] = "my-agent-prod"

# 然后正常用 LangChain/LangGraph，trace 自动上传

# 跑 evaluation：
from langsmith import Client
from langsmith.evaluation import evaluate

client = Client()
results = evaluate(
    lambda inputs: my_agent.invoke(inputs),
    data="my-eval-dataset",                # 之前在平台上准备的
    evaluators=["qa", "criteria"],          # 内置或自定义
    experiment_prefix="exp-2026-01",
)
```

**实战价值**：
- **生产 trace → eval dataset 一键转换**——把出错的真实 case 直接变成 regression test
- **A/B 对比**：跑两版 agent 同一份 dataset，UI 自动 diff 哪些 case 变好/变坏
- **人工标注**：在线给 trace 打"好/坏"标签，慢慢积累偏好数据 → DPO

### 2）LLM-as-Judge 的坑

LLM 当裁判**便宜但不准**——三大偏置：

| 偏置 | 表现 | 缓解 |
|---|---|---|
| **位置偏置** | 让 judge 比较 A、B 答案，往往偏向先看到的那个 | 随机交换顺序；多次跑取平均 |
| **长度偏置** | 同样质量下，长答案分数高 | judge prompt 明确"不以长度论好坏" |
| **自偏好** | judge 是 GPT-4 → 偏向 GPT-4 风格答案 | 用不同模型当 judge；多模型 ensemble |

经验：**关键决策（线上 vs offline、A/B 上线）一定还要人工 spot check**——不能完全交给 LLM judge。

### 3）评测维度的具体落地

```python
# Correctness（end-to-end）
def correctness(outputs, reference):
    judge = ChatOpenAI(model="gpt-4o").bind(response_format={"type":"json_object"})
    prompt = f"Reference: {reference}\nAnswer: {outputs}\nIs it correct? JSON {{score: 0-1, reason: ...}}"
    return judge.invoke(prompt).parsed

# Trajectory（轨迹）
def trajectory_match(actual_trace, ideal_steps):
    # 检查工具调用顺序是否合理
    actual_tools = [t.name for t in actual_trace.tool_calls]
    return len(set(actual_tools) & set(ideal_steps)) / len(ideal_steps)

# Tool calling correctness
def tool_args_correct(actual, expected_schema):
    try:
        expected_schema(**actual)
        return 1.0
    except ValidationError:
        return 0.0
```

### 4）回归测试（regression test）= Agent 评测的核心价值

```
   生产 trace → 标注 → eval dataset
        ▲
        │ 持续积累
        │
   每次 PR / 每次模型升级 → 跑 eval dataset → 看哪些 case 变差
        │
        ▼
   设 SLA：核心 case 永远不退化（如果退化 → 阻断 deploy）
```

**这是工程师的标准武器**——把 Agent 当一个普通服务，建立"测试套件"思维。

### 5）Agent 评测最容易漏的：成本和延迟

```python
class AgentMetric(BaseModel):
    correctness: float
    total_tokens: int          # input + output
    total_cost: float          # 按价目算
    total_latency_ms: float
    num_llm_calls: int
    num_tool_calls: int
    num_failures: int
```

**坏事**：模型变笨了，"正确率"还是 80%，但每个任务**多调了 5 次工具 + 多 5K token**——成本翻倍，业务侧最先发现。务必把成本/延迟当一等公民评测。

### 6）评测的频率分层

| 层级 | 频率 | 对象 |
|---|---|---|
| **Smoke test** | 每次 commit | 5-10 个核心 case |
| **Regression** | 每次 release | 100-500 个 case |
| **A/B online** | 持续 | 真实流量 5% |
| **Human review** | 每周 | 抽样 50 个 |

## 延伸追问

- **Q：** LangSmith 收费贵不贵？要不要找开源替代？
  → 商业 SaaS 起步免费、量大付费。开源替代：**Langfuse**（自托管）、**Phoenix (Arize)**——都能做 trace + dataset + eval。**对数据敏感不能上 SaaS** 用 Langfuse；其他场景 LangSmith 体验最顺。
- **Q：** RAGAS 的指标用什么模型当 judge？
  → 默认 OpenAI（gpt-4 / 3.5）。可以换 Claude/Gemini/本地模型。**注意**：换便宜模型 judge 会失准，关键场景至少用 gpt-4 级别。
- **Q：** Agent 多步 trajectory 怎么定义"理想路径"？
  → ① 让产品/领域专家手动标注几条 golden trace ② 让强模型（gpt-4）跑一遍当参考 ③ 用 LLM-as-judge 直接评估"轨迹合理性"，不强求与 golden 完全一致。
- **Q：** 具身机器人怎么评测？
  → 加上**物理维度**：动作成功率（任务完成）、安全违规率（碰撞、超速）、人员介入率、动作完成时间。**离线评测 + 仿真器评测 + 真机抽样评测**三层并行——真机评测贵但不能完全替代。

## 我的记法

- 评测分四层：**End-to-end / Trajectory / Single Step / 运营**
- LangSmith = **trace + dataset + evaluator** 一站式
- RAGAS = RAG 专用，**4 大指标**（faithfulness / relevancy / precision / recall）
- LLM-as-judge 三大坑：**位置偏置 / 长度偏置 / 自偏好**——多次随机 + 多模型缓解
- **生产 trace → 一键变 regression case** 是工程师的杀手锏
- 一句话：**「Agent 没评测就是凭感觉迭代——下一次升级模型时你不会知道是变好还是变差」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] LangSmith 跑过一次 evaluation 实验

## 参考资料
- [LangSmith 文档](https://docs.smith.langchain.com/)
- [RAGAS 文档](https://docs.ragas.io/)
- [Langfuse（开源替代）](https://langfuse.com/)
- [LLM-as-judge 偏置研究](https://arxiv.org/abs/2306.05685) — Judging LLM-as-a-Judge
