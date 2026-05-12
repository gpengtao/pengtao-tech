---
tags: [MOC, AI方向]
priority: P0
---
# 01 · AI 大模型 · 内容地图

> **定位**：P0 学习重点：Transformer 原理 / 训练微调 / Agent 系统。

---

## 子模块导航

### Transformer 与注意力
_原理层 · 高频考点 · **建议按下列顺序逐个补全（学完一题再进下一题）**_

0. [[01-AI大模型/10-Transformer与注意力/RNN 是什么|RNN 是什么]] #生疏 ← **零基础从这开始**
1. [[01-AI大模型/10-Transformer与注意力/Transformer 是什么|Transformer 是什么]] #生疏
2. [[01-AI大模型/10-Transformer与注意力/为什么 attention 要除以 √dk|为什么 attention 要除以 √dk]] #已背熟
3. [[01-AI大模型/10-Transformer与注意力/Transformer 为什么比 RNN 快|Transformer 为什么比 RNN 快]] #生疏
4. [[01-AI大模型/10-Transformer与注意力/多头注意力为什么比单头好|多头注意力为什么比单头好]] #生疏
5. [[01-AI大模型/10-Transformer与注意力/Decoder 的 Mask 为什么要下三角|Decoder 的 Mask 为什么要下三角]] #生疏
6. [[01-AI大模型/10-Transformer与注意力/Self-Attention 与 Cross-Attention 的区别|Self-Attention 与 Cross-Attention 的区别]] #生疏

_待补_
7. Position Encoding 的几种实现（Sinusoidal / RoPE / ALiBi）
8. LayerNorm 在 Pre-LN 和 Post-LN 里的区别

---

### 训练与微调
_高频考点 · 纯应用侧最容易被戳穿_

1. [[01-AI大模型/20-训练与微调/LoRA 和 QLoRA 的区别|LoRA 和 QLoRA 的区别]]
2. [[01-AI大模型/20-训练与微调/SFT-RLHF-DPO 的关系|SFT / RLHF / DPO 的关系]]
3. [[01-AI大模型/20-训练与微调/什么时候微调 什么时候 RAG 什么时候 prompt|什么时候微调 / RAG / prompt]]

_待补_
- 学习率怎么选 / warmup 的意义
- loss 怎么看 / 什么是 loss 异常
- 数据集构建的关键步骤
- Instruction Tuning 和 In-Context Learning 的区别

---

### Agent 系统
_规划 · 工具 · 记忆 · 多智能体 · 与固定编排的边界 —— **子地图**：[[01-AI大模型/30-Agent系统/index|Agent系统/index]]_

**核心原理**
1. [[01-AI大模型/30-Agent系统/Agent 的基本抽象是什么|Agent 的基本抽象是什么]]
2. [[01-AI大模型/30-Agent系统/ReAct 的核心思想是什么|ReAct 的核心思想是什么]]
3. [[01-AI大模型/30-Agent系统/Planning 类 Agent 有哪些模式|Planning 类 Agent 有哪些模式]]
4. [[01-AI大模型/30-Agent系统/Reflection 与 Self-Critique 模式|Reflection 与 Self-Critique 模式]]
5. [[01-AI大模型/30-Agent系统/Agent 的记忆如何分层|Agent 的记忆如何分层]]
6. [[01-AI大模型/30-Agent系统/Multi-Agent 有哪些协作范式|Multi-Agent 有哪些协作范式]]
7. [[01-AI大模型/30-Agent系统/固定编排与 LLM Agent 的边界是什么|固定编排与 LLM Agent 的边界是什么]]

**LangGraph 工程实现**
8. [[01-AI大模型/30-Agent系统/LangGraph 是什么 与 LangChain 的关系|LangGraph 是什么 / 与 LangChain 的关系]]
9. [[01-AI大模型/30-Agent系统/Dify 与 LangChain-LangGraph 的对比|Dify vs LangChain vs LangGraph 对比]]
10. [[01-AI大模型/30-Agent系统/LangGraph 多 Agent 的状态管理|LangGraph 多 Agent 的状态管理]]
11. [[01-AI大模型/30-Agent系统/LangGraph Multi-Agent Supervisor vs Swarm|LangGraph Multi-Agent：Supervisor vs Swarm]]
12. [[01-AI大模型/30-Agent系统/LangGraph 里如何接入长期记忆|LangGraph 里如何接入长期记忆]]
13. [[01-AI大模型/30-Agent系统/Agent 的错误恢复与 checkpoint 怎么做|Agent 的错误恢复与 checkpoint 怎么做]]

**Agent 框架对比**
14. [[01-AI大模型/30-Agent系统/AutoGen 与 CrewAI 的差异|AutoGen 与 CrewAI 的差异]]

**Agent 评测**
15. [[01-AI大模型/30-Agent系统/Agent 评测怎么做 LangSmith 与 RAGAS|Agent 评测怎么做：LangSmith 与 RAGAS]]
16. [[01-AI大模型/30-Agent系统/AgentBench-GAIA-WebArena 是什么|AgentBench / GAIA / WebArena 是什么]]

---

### 工具调用
_Function Calling · MCP · 并发 · 失败处理_

1. [[01-AI大模型/40-工具调用/OpenAI Function Calling 怎么工作|OpenAI Function Calling 怎么工作]]
2. [[01-AI大模型/40-工具调用/Parallel Tools 与并发工具调用|Parallel Tools 与并发工具调用]]
3. [[01-AI大模型/40-工具调用/Tool Calling 的失败处理与重试设计|Tool Calling 的失败处理与重试设计]]
4. [[01-AI大模型/40-工具调用/MCP 协议是什么 与 dify_plugin 的关系|MCP 协议是什么 / 与 dify_plugin 的关系]]

---

### RAG 与向量检索
_稠密/稀疏/混合 · 切块 · 向量库 · Rerank · 记忆 —— **子地图**：[[01-AI大模型/50-RAG与向量检索/index|RAG与向量检索/index]]_

**RAG 基础**
1. [[01-AI大模型/50-RAG与向量检索/RAG 的基本流程与局限|RAG 的基本流程与局限]]
2. [[01-AI大模型/50-RAG与向量检索/Chunking 有哪些常用策略|Chunking 有哪些常用策略]]
3. [[01-AI大模型/50-RAG与向量检索/Embedding 模型怎么选|Embedding 怎么选]]
4. [[01-AI大模型/50-RAG与向量检索/为什么 RAG 还需要 Rerank|为什么 RAG 还需要 Rerank]]
5. [[01-AI大模型/50-RAG与向量检索/检索与排序效果怎么评（Recall、MRR、nDCG）|检索与排序效果怎么评]]
6. [[01-AI大模型/50-RAG与向量检索/长上下文 vs RAG 怎么选|长上下文 vs RAG 怎么选]]

**向量库选型**
7. [[01-AI大模型/50-RAG与向量检索/向量库与 pgvector 类方案怎么选|向量库选型：FAISS / Chroma / Milvus / pgvector]]

**记忆系统**
8. [[01-AI大模型/50-RAG与向量检索/Mem0 与 MemGPT 长期记忆思路|Mem0 与 MemGPT 长期记忆思路]]

---

### 推理与部署
_算力与线上形态；被问概率随岗位升高_

1. [[01-AI大模型/60-推理与部署/vLLM 是什么 PagedAttention 解决了什么|vLLM 是什么 / PagedAttention 解决了什么]]
2. [[01-AI大模型/60-推理与部署/KV Cache 为什么重要|KV Cache 为什么重要]]
3. [[01-AI大模型/60-推理与部署/Continuous Batching 的意义|Continuous Batching 的意义]]
4. [[01-AI大模型/60-推理与部署/SGLang 与 vLLM 的差异|SGLang 与 vLLM 的差异]]

_待补_
- 量化（INT8 / INT4 / AWQ / GPTQ）对比
- TGI / Triton / ONNX Runtime 的定位差异

---

### 多模态
_VLM · VLA · 主流模型对比_

1. [[01-AI大模型/70-多模态/VLM 与 VLA 的区别|VLM 与 VLA 的区别]]
2. [[01-AI大模型/70-多模态/Qwen-VL 与 LLaVA 的能力差异|Qwen-VL 与 LLaVA 的能力差异]]
3. [[01-AI大模型/70-多模态/OpenVLA 与 π0 与 RDT-1B 是什么|OpenVLA / π0 / RDT-1B 是什么]]

---

### 具身智能
_感知-决策-执行 · 大脑小脑 · Sim2Real · 工程定位_

1. [[01-AI大模型/80-具身/具身智能与人形机器人的区别|具身智能与人形机器人的区别]]
2. [[01-AI大模型/80-具身/大脑-小脑分层架构是什么|大脑-小脑分层架构是什么]]
3. [[01-AI大模型/80-具身/感知-决策-执行闭环里的工程难点|感知-决策-执行闭环里的工程难点]]
4. [[01-AI大模型/80-具身/Sim2Real 是什么 仿真到真机有哪些 gap|Sim2Real 是什么 / 仿真到真机有哪些 gap]]
5. [[01-AI大模型/80-具身/具身公司里后端-平台-数据闭环的位置|具身公司里后端/平台/数据闭环的位置]]

---

### AI 编程方法论
_开发范式 · 人机协作边界_

1. [[01-AI大模型/90-AI编程方法论/Vibe Coding 是什么：适用场景与边界|Vibe Coding 是什么：适用场景与边界]]

---

## 本模块 P0 生疏题（自动）

```dataview
TABLE file.mtime AS "最近更新", tags AS "标签"
FROM "01-AI大模型"
WHERE contains(tags, "P0") AND contains(tags, "生疏")
SORT file.mtime ASC
```

## 本模块未动（催学）

```dataview
LIST
FROM "01-AI大模型"
WHERE contains(tags, "未动")
SORT file.name ASC
```
