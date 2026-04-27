---
tags: [MOC, 专题, P0, AI方向, 具身方向, 真盲区]
priority: P0
主题: 具身 AI Agent 工程能力图谱
创建日期: 2026-04-27
---

# 专题 · 具身 AI Agent · 工程知识地图

> **定位**：梳理「具身 AI Agent 工程」方向所需的完整知识图谱——从 Agent 框架、工具调用、推理服务化，到 VLA 模型与具身常识。**侧重工程视角**（部署、可观测、评测、稳定性），算法部分点到为止。
>
> **学习路径**：**先扫一遍全部知识点建坐标系，再决定哪些点需要深研**，比逐个攻克更高效。

---

## 一、知识盘点（按熟悉度归类）

### ✅ 工程师常见已有底子
- 分布式系统、消息队列（Kafka / NATS / 自研 MQ）、异步、高并发后端服务
- 大模型应用平台：异步任务、回执协议、优先级队列、监控、灰度
- Prompt 版本化、回放评估、Badcase 闭环、模型迭代闭环
- 多环境部署、可观测性、SOP、文档协作
- RAG 基础流程（chunking / embedding / 向量库 / rerank）

### 🟡 概念听过、缺实操
- 工具调用 / Function Calling / MCP 协议
- 任务规划 / 推理决策（事件驱动调度 ≠ ReAct/Plan-and-Execute）
- 多智能体协作（多服务编排 ≠ AutoGen/CrewAI/LangGraph）
- Python 工程化（async、FastAPI、Pydantic）

### ❌ 全新陌生区
- LangChain / LangGraph / AutoGen / LlamaIndex
- PyTorch、LoRA/QLoRA/SFT/DPO、分布式训练
- VLM / VLA 模型谱系与部署方式
- 推理服务化：vLLM、SGLang、KV cache、连续批处理
- 长上下文记忆架构（Mem0 / MemGPT 思路）
- Agent 评测：LangSmith、AgentBench、GAIA、WebArena
- 具身专属：分层规划、感知-决策-执行闭环、Sim2Real

---

## 二、优先级清单（学什么 / 不学什么）

> 标记说明：✅ 已有 · 🆕 待建 · 🔁 链向现有

> **落点说明**：所有 🆕 待建题**直接落在本专题目录** `_专题-具身Agent/`（按主题子目录组织），不再迁回主体系。🔁 已有题仍在主体系下，用 wikilink 引用即可。

### P0 ── 必须补，4–6 周内动手

#### 1) Python 工程化
> **目的**：让 Python 不再是瓶颈；能写、能读、能 debug 现代 Python LLM 应用代码。

**核心知识点**：
- `async / await` 语法 + `asyncio` 事件循环（重点：和 Java 线程模型的差别）
- 协程 vs 线程 vs 进程（Java 出身**最容易绊倒的地方**）
- 异步并发原语：`asyncio.gather` / `Semaphore` / `TaskGroup` / `Queue`
- 异步 HTTP 客户端：`httpx` / `aiohttp`
- **FastAPI**：路由、依赖注入、`Depends`、`BackgroundTasks`、流式响应（SSE/WS）
- **Pydantic v2**：`BaseModel` / `Field` / `validator` / `Settings`（**LLM 应用里 Pydantic 是核心**：工具签名、结构化输出、配置）
- 类型提示进阶：`Optional` / `Union` / `Literal` / `Generic` / `Protocol`
- 包管理与项目结构：`uv` 是新趋势、`poetry` / `pip-tools` / `pyproject.toml` / `src layout`
- 日志与可观测：`logging` / `structlog` / OpenTelemetry
- 测试：`pytest` / `pytest-asyncio` / `respx`

**对应题目**：
- 🆕 [[_专题-具身Agent/Python工程化/Python async 与 FastAPI 入门]] #未动 #P0
- 🆕 [[_专题-具身Agent/Python工程化/Pydantic 与类型提示在 LLM 应用里的用法]] #未动 #P0
- 🆕 [[_专题-具身Agent/Python工程化/Python 项目结构与 uv-poetry-pip 选型]] #未动 #P1

---

#### 2) Agent 框架与设计模式
> **目的**：能在面试白板上画出 Agent 的执行图，能解释为什么这样设计。

**核心知识点**：
- Agent 抽象：**感知-思考-行动循环（Sense-Think-Act）** + 外部反馈
- **ReAct**：Reasoning + Acting，每步「Thought → Action → Observation」
- **Plan-and-Execute**：先生成 task graph、再分步执行（解决 ReAct 步数爆炸）
- **Reflexion / Self-Critique**：自我反思 → 修正下一步
- **LangChain**：`LCEL` 链式 API、`Tool` / `AgentExecutor`（黑盒、难调试，被 LangGraph 取代）
- **LangGraph**：核心是 `StateGraph`——节点是函数、边是控制流、状态显式 dict / Pydantic
- **Checkpoint / Interrupt**：断点续跑、人在回路（HITL）—— **具身场景刚需**
- **Subgraph**：嵌套子图、模块化复用
- 错误恢复：retry policy、fallback edge、escalation 到人工
- 与 Dify 工作流的同异：节点抽象层级、状态/变量、灰度/版本

**对应题目**：
- 🔁 [[01-AI大模型/Agent系统/Agent 的基本抽象是什么]]
- 🔁 [[01-AI大模型/Agent系统/ReAct 的核心思想是什么]]
- 🔁 [[01-AI大模型/Agent系统/Planning 类 Agent 有哪些模式]]
- 🆕 [[_专题-具身Agent/Agent框架/LangGraph 是什么 与 LangChain 的关系]] #未动 #P0
- 🆕 [[_专题-具身Agent/Agent框架/Reflection 与 Self-Critique 模式]] #未动 #P0
- 🆕 [[_专题-具身Agent/Agent框架/Agent 的错误恢复与 checkpoint 怎么做]] #未动 #P0
- 🆕 [[_专题-具身Agent/Agent框架/Dify 与 LangChain-LangGraph 的对比]] #未动 #P0 ← **平台 vs 库的横向对比，深研优先**

---

#### 3) Function Calling / MCP / 工具调用
> **目的**：能把任意业务能力暴露给 Agent；能讲清失败、重试、权限怎么做。

**核心知识点**：
- **OpenAI Function Calling**：`tools` / `tool_choice` / `parallel_tool_calls`
- **JSON Schema**：工具签名定义；为什么不是自然语言
- **Anthropic Tool Use** 协议（和 OpenAI 的细微差别）
- **MCP（Model Context Protocol）协议**：Server / Client / `Tool` / `Resource` / `Prompt` 三种暴露形式
- MCP transport：`stdio` / `HTTP+SSE` / `WebSocket`
- **dify_plugin 与 MCP 的对应关系**（平台插件机制 vs 通用协议的横向对比）
- 工具调用失败模式：timeout / schema mismatch / 模型幻觉参数 / 业务侧错误
- 重试与退避：是模型重试还是 framework 重试，**幻觉参数不能盲重试**
- 工具白名单与权限隔离（多租户、敏感操作护栏）
- 工具调用日志、可观测、审计

**对应题目**：
- 🆕 [[_专题-具身Agent/工具调用/OpenAI Function Calling 怎么工作]] #未动 #P0
- 🆕 [[_专题-具身Agent/工具调用/MCP 协议是什么 与 dify_plugin 的关系]] #未动 #P0
- 🆕 [[_专题-具身Agent/工具调用/Tool Calling 的失败处理与重试设计]] #未动 #P0
- 🆕 [[_专题-具身Agent/工具调用/Parallel Tools 与并发工具调用]] #未动 #P1

---

#### 4) 多 Agent 协作
> **目的**：能为「具身机器人多任务多模块」场景画出多 Agent 编排图。

**核心知识点**：
- 协作范式：**Supervisor**（领导-下属）/ **Hierarchical**（多层级）/ **Network**（去中心化）/ **Swarm**（群体）
- **AutoGen**：`ConversableAgent`、`GroupChat`、role play、code execution
- **CrewAI**：`Task` / `Crew` / `Agent`、顺序 vs 并行
- **LangGraph multi-agent**：Supervisor pattern、Handoff、消息路由
- Agent 间通信：消息格式、共享状态、事件总线
- 任务分配 / 投票 / 协商策略
- 并行成本与延迟：每个 Agent 一次 LLM 调用，**很容易超预算**
- 失败传播与隔离：一个 Agent 出错，整体怎么处理
- 与传统服务编排（Dubbo / RPC / 工作流引擎）的同异：**核心差别在控制流是否由模型决定**

**对应题目**：
- 🔁 [[01-AI大模型/Agent系统/Multi-Agent 有哪些协作范式]]
- 🆕 [[_专题-具身Agent/Agent框架/AutoGen 与 CrewAI 的差异]] #未动 #P0
- 🆕 [[_专题-具身Agent/Agent框架/LangGraph 多 Agent 的状态管理]] #未动 #P0

---

#### 5) RAG 与记忆
> **目的**：能从「单轮 RAG」升到「Agent 长期记忆」，能讲选型权衡。

**核心知识点**：
- RAG 基本流程：**切块 → embedding → 向量检索 → rerank → 拼上下文 → 生成**
- Chunking 策略：fixed / recursive / semantic / late chunking；什么场景用哪个
- Embedding 选型：BGE-M3 / Qwen-Embedding / OpenAI text-embedding-3 ← 维度、多语言、长度
- 向量库：Milvus / Qdrant / pgvector / Chroma / Weaviate（**pgvector 适合中小规模**）
- **混合检索**：BM25 + 向量；为什么纯向量经常翻车
- Reranker：bge-reranker-v2 / cohere-rerank（**质量提升的关键一步**）
- 评估指标：Recall@K、MRR、nDCG、Hit Rate
- **Agent 记忆分层**：工作记忆 / 短期记忆（会话）/ 长期记忆（跨会话）/ 反思记忆（学习）
- **Mem0 / MemGPT** 思路：把记忆当 RAG、按重要性排序、自动遗忘
- **长上下文 vs RAG 选型**：上下文 200K 时还要不要 RAG？成本、可控性、可解释性

**对应题目**：
- 🔁 [[01-AI大模型/RAG与向量检索/RAG 的基本流程与局限]]
- 🔁 [[01-AI大模型/RAG与向量检索/Chunking 有哪些常用策略]]
- 🔁 [[01-AI大模型/RAG与向量检索/为什么 RAG 还需要 Rerank]]
- 🔁 [[01-AI大模型/Agent系统/Agent 的记忆如何分层]]
- 🆕 [[_专题-具身Agent/RAG与记忆/Mem0 与 MemGPT 长期记忆思路]] #未动 #P0
- 🆕 [[_专题-具身Agent/RAG与记忆/长上下文 vs RAG 怎么选]] #未动 #P0

---

#### 6) 推理服务化（让大模型跑得稳跑得快）
> **目的**：能起一个生产级推理服务，能聊性能优化的关键旋钮。

**核心知识点**：
- **vLLM** 核心：**PagedAttention**（KV cache 分页管理，解决显存碎片）
- **Continuous Batching**：和 Static Batching 的差别，为什么吞吐能涨 10x
- **KV Cache**：是什么、为什么重要、显存怎么估算（每 token × 层数 × 头数 × 维度 × 2）
- **Prefill 阶段 vs Decode 阶段**：计算瓶颈不同
- 关键指标：**TTFT**（首 token 延迟）/ **TPOT**（每 token 延迟）/ **吞吐**（token/s）/ **并发** / **显存占用**
- 取舍：低延迟 vs 高吞吐 vs 显存（不可三全）
- **SGLang**：RadixAttention、结构化生成（JSON / 工具调用更快）
- 量化：AWQ / GPTQ / INT8 / INT4，精度损失与速度收益
- 并行：Tensor Parallel（多卡跑大模型）vs Pipeline Parallel
- 流式输出：SSE / WebSocket、和 FastAPI 的对接
- 推理监控：GPU 利用率、KV cache 占用率、QPS、p99

**对应题目**：
- 🆕 [[_专题-具身Agent/推理服务化/vLLM 是什么 PagedAttention 解决了什么]] #未动 #P0
- 🆕 [[_专题-具身Agent/推理服务化/Continuous Batching 的意义]] #未动 #P0
- 🆕 [[_专题-具身Agent/推理服务化/KV Cache 为什么重要]] #未动 #P0
- 🆕 [[_专题-具身Agent/推理服务化/SGLang 与 vLLM 的差异]] #未动 #P1

---

### P1 ── 强烈建议（让你不止能讲还能秀）

#### 7) 微调（点到为止，亲手跑一次即可）
> **目的**：能讲清概念、跑通一次 QLoRA、能选型；**不是要变成训练专家**。

**核心知识点**：
- **SFT（Supervised Fine-Tuning）**：数据格式（instruction / input / output）、loss、典型问题（过拟合、灾难遗忘）
- **LoRA（Low-Rank Adaptation）**：原理（低秩矩阵旁路）、关键超参（rank、alpha、target_modules）
- **QLoRA**：4-bit base + LoRA → **单卡 24G 跑 7B 微调**
- **DPO（Direct Preference Optimization）**：偏好数据、不需要奖励模型
- **RLHF** 总览（流程图能画即可，**不用深入**）
- 数据集构建：清洗、去重、对齐 chat template
- 训练框架：`trl` / `axolotl` / `unsloth`
- **决策树**：何时 prompt、何时 RAG、何时微调（**面试常问**）

**对应题目**：
- 🆕 [[_专题-具身Agent/微调/LoRA 和 QLoRA 的区别]] #未动 #P1
- 🆕 [[_专题-具身Agent/微调/SFT-RLHF-DPO 的关系]] #未动 #P1
- 🆕 [[_专题-具身Agent/微调/什么时候微调 什么时候 RAG 什么时候 prompt]] #未动 #P1

---

#### 8) Agent 评测
> **目的**：能为一个 Agent 项目设计端到端的评测方案——这是平台型工程师的差异化武器。

**核心知识点**：
- 评测维度：**正确性 / 鲁棒性 / 成本 / 延迟 / 安全性**
- **LangSmith**：trace / dataset / evaluator / 人工标注、和 LangGraph 原生集成
- **RAGAS**：faithfulness / answer relevancy / context precision / context recall
- **AgentBench / GAIA / WebArena / SWE-bench**：各自考什么场景
- 单步评估 vs 轨迹评估（trajectory eval）
- **LLM-as-Judge**：怎么用、坑在哪（位置偏置、长度偏置、自偏好）
- Regression test：让某条 trace 永远不退化
- AB / 灰度策略：在 LLM 应用平台里的落地形态
- 数据闭环：数据爬取 → 数据集 → 回放 → 评估 → 灰度的标准链路

**对应题目**：
- 🆕 [[_专题-具身Agent/Agent评测/Agent 评测怎么做 LangSmith 与 RAGAS]] #未动 #P1
- 🆕 [[_专题-具身Agent/Agent评测/AgentBench-GAIA-WebArena 是什么]] #未动 #P1

---

#### 9) VLM / VLA 模型谱（能讲能选型，不背论文）
> **目的**：能在 30 秒内讲清主流 VLM/VLA 的区别和适用场景；**不要求会改模型**。

**核心知识点**：
- **VLM（Vision-Language Model）**：CLIP / BLIP / LLaVA / Qwen-VL / GPT-4V
- VLM 输入结构：image patch（ViT/SigLIP encoder）+ text token，进同一个 transformer
- 视觉 encoder：ViT / SigLIP / CLIP-ViT，分辨率与 token 数的取舍
- **VLA（Vision-Language-Action）**：把 action 当 token，**输出动作序列**
- **OpenVLA**：Llama2 + visual encoder + action head；7B 量级，端到端
- **π0**：flow-matching policy，更适合连续动作
- **RDT-1B**：Robotics Diffusion Transformer，扩散模型做动作生成
- **Octo**：开源 generalist robot policy
- 部署关注点：模型大小、推理延迟、动作频率（10–50Hz）、多 camera 输入
- VLA 数据集：**Open X-Embodiment**、LeRobot
- VLA 在产品里的落点：通常是「**大脑层**」之下的一层，和 LLM 规划解耦

**对应题目**：
- 🆕 [[_专题-具身Agent/多模态/VLM 与 VLA 的区别]] #未动 #P1
- 🆕 [[_专题-具身Agent/多模态/Qwen-VL 与 LLaVA 的能力差异]] #未动 #P1
- 🆕 [[_专题-具身Agent/多模态/OpenVLA 与 π0 与 RDT-1B 是什么]] #未动 #P1

---

### P2 ── 具身专属（差异化加分项）
> **目的**：能跟具身公司 CTO 平视对话；不假装是机器人专家，但能聊清楚自己在产业链的位置。

**核心知识点**：
- 具身 vs 人形机器人 vs 自动驾驶 vs 工业机器人 的关系
- **大脑（LLM/VLA）— 小脑（controller / motor）— 本体** 三层架构
- 任务规划层级：自然语言指令 → 高阶 task graph → 中阶 skill → 低阶 trajectory → 关节力矩
- 感知模态：RGB / Depth / Point Cloud / Force-Torque / Tactile / IMU；不同模态适合什么任务
- 动作空间：joint space / Cartesian space / end-effector / gripper
- **安全护栏**：力反馈、关节限位、紧急停止、速度限幅、碰撞检测——**家庭/康养场景刚需**
- **Sim2Real gap**：物理引擎差异、渲染差异、传感器噪声、动作延迟
- 仿真器：**Isaac Sim/Lab**（NVIDIA）、MuJoCo（DeepMind）、Gazebo（ROS 系）
- 数据采集范式：远程操控（teleoperation）/ 动作示教（kinesthetic）/ 视频学习
- **模仿学习（IL）vs 强化学习（RL）**：为什么具身公司多数用 IL
- 「**后端 / 平台 / 数据闭环**」在具身公司架构里的具体位置：工程师常见落点

**对应题目**：
- 🆕 [[_专题-具身Agent/具身/具身智能与人形机器人的区别]] #未动 #P2
- 🆕 [[_专题-具身Agent/具身/大脑-小脑分层架构是什么]] #未动 #P2
- 🆕 [[_专题-具身Agent/具身/感知-决策-执行闭环里的工程难点]] #未动 #P2
- 🆕 [[_专题-具身Agent/具身/Sim2Real 是什么 仿真到真机有哪些 gap]] #未动 #P2
- 🆕 [[_专题-具身Agent/具身/具身公司里后端-平台-数据闭环的位置]] #未动 #P2

### P3 ── 不投入（投入产出比差）

- ❌ 从头训练大模型 / DeepSpeed-FSDP 深度调优 / 写顶会论文
- ❌ 控制论 / SLAM / 嵌入式 / ROS2 实操
- ✅ 但要**能聊**：知道这些是什么、和你的位置如何衔接（在 P2「具身」专题里覆盖）

---

## 三、学习节奏（两阶段：通识 → 深研）

> **学习哲学**：作为有底子的工程师，**先扫一遍全部知识点建立坐标系，再决定哪些点需要深研**，比逐个攻克更高效。陌生概念的「**知道是什么**」比「**知道得很深**」更优先。

---

### Phase 1 — 通识扫描（建议 1–1.5 周完成）

> **目标**：对 P0/P1/P2 全部知识点做到「**听到不懵 + 能讲个一两句**」，并标好每个题的「难度档」。
>
> **方法**：每题 5–15 分钟，**只读不练，只看不写 demo**。重点是把陌生术语映射到你已有的工程概念上。

#### 通识 SOP（每个题这么处理）

1. 打开题目骨架，看标题 → 自问：**我现在听到这词会不会懵？**
2. **5 分钟搜索 / 阅读**：维基、官方文档首段、知乎/B站速览、Anthropic/OpenAI 博客
3. 在题目骨架的「**一句话速记**」位置写**一句话**（哪怕是粗糙的）
4. 把 YAML 标签从 `#未动` 改成下列之一：
   - `#已懂` ── 已经熟，不用深研，速记够用
   - `#生疏` ── 听过，但不能讲；后续可能要深研
   - `#真盲区` ── 完全空白，**强候选深研**
5. 不动其它 TODO 部分，留着 Phase 2 用

#### 通识扫描 checklist（按主题块）

- [ ] **Python 工程化**（3 题）—— 后端工程师常见 `#已懂` 或 `#生疏`
- [ ] **Agent 框架**（6 题）—— 用过 LLM 平台的常有部分 `#已懂`，LangGraph 多数 `#真盲区`
- [ ] **工具调用**（4 题）—— Function Calling / MCP 常见 `#真盲区`
- [ ] **RAG 与记忆**（6 题，含 4 个🔁现有题）—— 做过 RAG 应用的多 `#已懂`
- [ ] **推理服务化**（4 题）—— 多数后端工程师 `#真盲区`
- [ ] **微调**（3 题）—— 应用工程师常见 `#真盲区`
- [ ] **Agent 评测**（2 题）—— 做过应用平台评测的常 `#生疏`
- [ ] **多模态 VLM/VLA**（3 题）—— 常 `#真盲区`
- [ ] **具身专属**（5 题）—— 常 `#真盲区`

#### Phase 1 产出

- 31 个题目骨架的「一句话速记」全部填上（哪怕粗糙）
- YAML 标签从 `#未动` 全部更新成 `#已懂` / `#生疏` / `#真盲区`
- 一份**深研候选清单**：所有 `#真盲区` + 重要的 `#生疏`

---

### Phase 2 — 按需深研（灵活，不强制周节奏）

> **目标**：从深研候选清单里挑 5–8 个**对岗位最关键 + 你最空白**的题，按你节奏深研。
>
> **方法**：选定一个题 → 跑 demo → 回填骨架所有 TODO → 标签改 `#能讲` → 进下一题。

#### 深研候选优先级建议（按面试 ROI 排序）

**第一梯队**（必深研，4–5 题）：
- [[_专题-具身Agent/Agent框架/Dify 与 LangChain-LangGraph 的对比]] ← 平台 vs 库的横向对比
- [[_专题-具身Agent/Agent框架/LangGraph 是什么 与 LangChain 的关系]]
- [[_专题-具身Agent/工具调用/MCP 协议是什么 与 dify_plugin 的关系]] ← 平台插件 vs 标准协议
- [[_专题-具身Agent/推理服务化/vLLM 是什么 PagedAttention 解决了什么]]
- [[_专题-具身Agent/具身/大脑-小脑分层架构是什么]]

**第二梯队**（强烈建议，3–4 题）：
- [[_专题-具身Agent/Agent框架/Agent 的错误恢复与 checkpoint 怎么做]]
- [[_专题-具身Agent/工具调用/OpenAI Function Calling 怎么工作]]
- [[_专题-具身Agent/多模态/VLM 与 VLA 的区别]]
- [[_专题-具身Agent/具身/具身公司里后端-平台-数据闭环的位置]]

**第三梯队**（看时间和精力，每题 1–2h 跑通即可）：
- LoRA / QLoRA 实操（亲手跑一次）
- vLLM 起服务做 QPS 测试

#### 深研动作模板（每个题）

1. 该题骨架里如果有「**深研动作清单**」就照着做；没有就自己列 4–6 步
2. 找官方教程 / 高 quality 博客快速跑通 hello world
3. 写一个 minimal demo（30–90 分钟）
4. 回填骨架所有 TODO 段落
5. 标签 `#真盲区/#生疏` → `#能讲`
6. 隔 3 天回看一次「我的记法」段，能不能脱口讲出来；不能就 `#能讲` → `#生疏`

#### Phase 2 产出

- 5–8 篇深研笔记，每篇都能脱口讲 3–5 分钟
- 一份「Agent 工程能力地图」（深研笔记的整合版）
- 1–2 个能演示的 demo（简单的 LangGraph + 工具调用即可）

---

## 四、学完之后的能力自检

学完 P0/P1 之后，应该能讲清楚的核心问题（每条都对应路线图里某个题或某组题）：

- **Agent 工程**：能在白板上画出 Agent 的执行图，能讲清 ReAct / Plan-and-Execute / Reflexion 的差异
- **框架取舍**：能讲清「平台型（Dify）vs 库型（LangChain/LangGraph）」的本质差异，以及具身场景的合理选型
- **工具调用**：能讲清 Function Calling、MCP、JSON Schema 的关系，以及失败处理与重试设计
- **多 Agent**：能给一个具身机器人多任务场景画出多 Agent 编排图
- **RAG 与记忆**：能讲清单轮 RAG 升到 Agent 长期记忆的层级，以及长上下文 vs RAG 的选型
- **推理服务化**：能讲清 vLLM 的 PagedAttention、Continuous Batching、KV Cache 解决了什么
- **微调**：能讲清 SFT/LoRA/QLoRA/DPO 的关系，能讲清「何时 prompt、何时 RAG、何时微调」的决策树
- **Agent 评测**：能为一个 Agent 项目设计端到端评测方案
- **VLM/VLA**：能讲清主流 VLM/VLA 的差异，以及 VLA 在产品里的落点
- **具身专属**：能讲清「大脑-小脑-本体」三层架构、Sim2Real gap、感知-决策-执行闭环

---

## 五、动态跟踪（dataview）

> **dataview 范围**：本专题文件主要在 `_专题-具身Agent/` 下；少数 🔁 引用题在主体系，靠 `#具身方向` 标签汇总。

### 本专题所有题（按状态分组）

```dataview
TABLE WITHOUT ID
  file.link AS "题目",
  filter(tags, (t) => contains("P0 P1 P2", t))[0] AS "优先级",
  filter(tags, (t) => contains("未动 生疏 能讲 已背熟", t))[0] AS "状态",
  file.mtime AS "最近更新"
FROM "_专题-具身Agent" OR ("01-AI大模型" AND #具身方向)
WHERE contains(tags, "具身方向") AND file.name != "_MOC"
SORT file.mtime DESC
```

### 本专题「未动」催学清单

```dataview
LIST
FROM "_专题-具身Agent"
WHERE contains(tags, "未动")
SORT file.name ASC
```

### 本周新建/更新的本专题笔记

```dataview
LIST file.mtime
FROM "_专题-具身Agent"
WHERE file.mtime >= date(today) - dur(7 days)
SORT file.mtime DESC
```

---

## 六、目录使用约定（一站式学习模式）

### 本专题目录的子结构
```
_专题-具身Agent/
├── _MOC.md                          ← 路线图（当前文件）
├── Agent框架/
├── Python工程化/
├── 工具调用/
├── RAG与记忆/
├── 推理服务化/
├── 微调/
├── Agent评测/
├── 多模态/
└── 具身/
```

可选辅助文件（按需新建）：
- `周复盘.md`：每周一次的学习复盘
- `demo项目计划.md`：要做的 demo 列表

### 主体系下原有题目仍是引用对象
🔁 标记的已有题目（ReAct / RAG 流程 / Multi-Agent 等）**留在 `01-AI大模型/` 主体系下**，本路线图只通过 wikilink 引用，**不重复造**。

> **YAML 标签约定**：所有本专题题目都加 `tags: [..., 具身方向, ...]`，dataview 才能汇总。

### 专题学习结束后的处理选项
- **选项 A（保守）**：把专题目录里有长期价值的题目**手动迁回**主体系（按技术分类），本目录归档到 `_临时/` 或删除。
- **选项 B（务实）**：本目录整体归档为 `_归档/2026-具身Agent专题/`，下次找笔记直接从主体系搜，本目录作为「**专题快照**」保留。

> 现在不用纠结，**先学完再说**。

## 七、起手式（30 分钟内开干）

> **新思路**：先扫一遍全部知识点，再决定深研哪些。

1. ✅ 已完成：31 个题目骨架 + 9 个子目录 + 路线图
2. **从 Phase 1 通识扫描开始**：按上面「通识 SOP」逐题处理
3. 建议起手顺序（你最熟的开始，建立成就感）：
   - 先扫 **Python 工程化**（3 题，多数已懂，5 分钟一题）
   - 再扫 **RAG 与记忆**（6 题，多数已懂）
   - 再扫 **Agent 框架**（6 题，混合）
   - 把陌生的 4 块（工具调用 / 推理服务化 / 多模态 / 具身）放最后扫，因为是真盲区
4. 第一周末做一次复盘：看看 `#真盲区` 还剩几个，**决定 Phase 2 深研哪 5–8 题**
5. 不要一次开多题深研，**通识阶段同时进行多题反而高效**（5–15 分钟一题，能切换）

---

## 七、自检：这份计划是不是对的

- 学完 P0，**能否清晰阐述 Agent 工程**？ → 应该能
- 学完 P1，**能否和 ML 出身的同行讨论微调与评测**？ → 应该能，不假装是研究者
- 学完 P2，**能否讲清自己在具身工程产业链中的定位**？ → 应该能
- **没**学 P3，**会不会有缺口**？ → 算法岗仍可能不匹配；平台 / 数据 / Agent 工程岗位不应受影响

**如果答案都是「能」**：路径正确，不用扩。  
**如果某条不能**：补哪一条，不要全部加码。
