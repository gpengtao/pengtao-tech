---
tags: [MOC, AI方向]
priority: P0
---

# 01 · AI 大模型 · 内容地图

> **定位**：P0 学习重点：Transformer 原理 / 训练微调 / Agent 系统。

---

## 子模块导航

### Transformer 与注意力
_原理层 · 面试兜底问常考 · **建议按下列顺序逐个补全（学完一题再进下一题）**_

0. [[01-AI大模型/Transformer与注意力/RNN 是什么|RNN 是什么]] #生疏 ← **零基础从这开始**
1. [[01-AI大模型/Transformer与注意力/Transformer 是什么|Transformer 是什么]] #生疏
2. [[01-AI大模型/Transformer与注意力/为什么 attention 要除以 √dk|为什么 attention 要除以 √dk]] #已背熟
3. [[01-AI大模型/Transformer与注意力/Transformer 为什么比 RNN 快|Transformer 为什么比 RNN 快]] #生疏
4. [[01-AI大模型/Transformer与注意力/多头注意力为什么比单头好|多头注意力为什么比单头好]] #生疏
5. [[01-AI大模型/Transformer与注意力/Decoder 的 Mask 为什么要下三角|Decoder 的 Mask 为什么要下三角]] #生疏
6. [[01-AI大模型/Transformer与注意力/Self-Attention 与 Cross-Attention 的区别|Self-Attention 与 Cross-Attention 的区别]] #生疏

_待补清单（按推荐顺序）_
7. Position Encoding 的几种实现（Sinusoidal / RoPE / ALiBi）
8. LayerNorm 在 Pre-LN 和 Post-LN 里的区别

### 训练与微调
_面试高频 · 纯应用侧最容易被戳穿_

_待补清单_
- 学习率怎么选 / warmup 的意义
- loss 怎么看 / 什么是 loss 异常
- LoRA 和 QLoRA 的区别
- SFT / RLHF / DPO 的关系
- 数据集构建的关键步骤
- Instruction Tuning 和 In-Context Learning 的区别

### Agent 系统
_规划 · 工具 · 记忆 · 多智能体 · 与固定编排的边界 —— **子地图**：[[01-AI大模型/Agent系统/_MOC|Agent系统/_MOC]]_

1. [[01-AI大模型/Agent系统/Agent 的基本抽象是什么|Agent 的基本抽象是什么]]
2. [[01-AI大模型/Agent系统/ReAct 的核心思想是什么|ReAct 的核心思想是什么]]
3. [[01-AI大模型/Agent系统/Planning 类 Agent 有哪些模式|Planning 类 Agent 有哪些模式]]
4. [[01-AI大模型/Agent系统/Agent 的记忆如何分层|Agent 的记忆如何分层]]
5. [[01-AI大模型/Agent系统/Multi-Agent 有哪些协作范式|Multi-Agent 有哪些协作范式]]
6. [[01-AI大模型/Agent系统/固定编排与 LLM Agent 的边界是什么|固定编排与 LLM Agent 的边界是什么]]

### RAG 与向量检索
_稠密/稀疏/混合 · 切块 · 向量库 · Rerank · 指标 —— **子地图**：[[01-AI大模型/RAG与向量检索/_MOC|RAG与向量检索/_MOC]]_

1. [[01-AI大模型/RAG与向量检索/RAG 的基本流程与局限|RAG 的基本流程与局限]]
2. [[01-AI大模型/RAG与向量检索/Chunking 有哪些常用策略|Chunking 有哪些常用策略]]
3. [[01-AI大模型/RAG与向量检索/Embedding 模型怎么选|Embedding 怎么选]]
4. [[01-AI大模型/RAG与向量检索/向量库与 pgvector 类方案怎么选|向量库与 pgvector 类方案怎么选]]
5. [[01-AI大模型/RAG与向量检索/为什么 RAG 还需要 Rerank|为什么 RAG 还需要 Rerank]]
6. [[01-AI大模型/RAG与向量检索/检索与排序效果怎么评（Recall、MRR、nDCG）|检索与排序效果怎么评（Recall、MRR、nDCG）]]

### 推理与部署
_算力与线上形态；被问概率随岗位升高_

_待补清单_
- vLLM 的 PagedAttention 解决了什么
- Continuous Batching 的意义
- 量化（INT8 / INT4 / AWQ / GPTQ）对比
- KV Cache 为什么重要
- TGI / Triton / ONNX Runtime 的定位差异

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
