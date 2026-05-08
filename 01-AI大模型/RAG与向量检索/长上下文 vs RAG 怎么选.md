---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---

# 长上下文 vs RAG 怎么选

## 一句话速记

**长上下文（200K-2M）没有"杀死 RAG"——只是把"小知识库塞进 context"变成可行**。三个核心权衡：① **成本**：长 context 单次贵 10-100 倍 ② **延迟**：prefill 时间随 context 长度近线性 ③ **质量**：lost-in-the-middle 让模型对中段内容回忆精度下降。**经验决策**：< 50K + 单次问答 + 高准确性需求 → 长 context；多用户 / 大语料 / 频繁查询 → RAG；**绝大多数生产系统是混合**——RAG 取 top-K + 长 context 容纳完整段落。

## 通俗解释（5 分钟版）

**为啥这是个问题**：
- 2023 年前：context 8K-32K，**塞不下知识库**，RAG 是必选
- 2024+：Claude 200K、Gemini 1M-2M、GPT 128K-1M，**很多人开始问"还要 RAG 吗"**

**两种范式的本质对比**：

```
   [长 context]                          [RAG]
                                          
   user query                              user query
       │                                       │
       ▼                                       ▼
   ┌─────────────────────┐              ┌─────────────┐
   │ 全部知识 + query    │              │ embed query │
   │ → 喂给 LLM          │              └──────┬──────┘
   └──────────┬──────────┘                     │
              │                                 ▼
              ▼                          ┌─────────────┐
            output                       │ vector DB   │
                                         │ top-K chunks│
                                         └──────┬──────┘
                                                │
                                                ▼
                                         ┌─────────────┐
                                         │ chunks +    │
                                         │ query → LLM │
                                         └──────┬──────┘
                                                │
                                                ▼
                                              output
```

### 五个维度对比

| 维度 | 长 context | RAG |
|---|---|---|
| **成本** | 每次输入 token 都计费，大 prompt 单次贵 10-100x | embed 只算一次，每次只喂 top-K |
| **延迟** | prefill 随 context 增长近线性增长（200K 可达 5-30s） | 检索 100ms + 短 prompt prefill 快 |
| **质量** | lost in the middle、文档间干扰 | 检索准的话精度更高，错的话直接漏 |
| **可解释** | 模型黑盒看了什么 | 检索结果可见、可审计 |
| **更新** | 每次都要全量喂入 | 改向量库即可，模型不动 |

### 决策树

```
                          要让 LLM 用一份文档回答
                                │
                       ┌────────┴─────────┐
                       │ 文档总量 < 50K?  │
                       └─┬──────────────┬─┘
                  yes    │              │ no
                         ▼              ▼
                   单次 query?      文档量很大
                   ┌─────┴─────┐         │
              yes  │           │ no      │
                   ▼           ▼         ▼
              长 context    RAG / 混合   一定 RAG
              （成本一次）              （成本可控）

       高准确性 / 不容许漏检的场景：
            → 长 context（直接看全部）
            → RAG 要 hybrid + rerank 才能逼近

       多用户 / 多租户隔离强：
            → RAG（向量库自然隔离）

       数据频繁更新（实时新闻、监控日志）：
            → RAG（embed 增量加，不用重塞 prompt）
```

## 关键细节 / 数学直觉

### 1）lost in the middle 是什么

> Liu et al., 2023 — "Lost in the Middle: How Language Models Use Long Contexts"

测试：在 30 个文档中藏一个答案，问模型这个答案。结果：
- 答案在**最前面**：召回 ~75%
- 答案在**最后面**：召回 ~70%
- 答案在**中间**：召回 ~50% 甚至更低

**含义**：单纯堆长 context 不能保证模型一定看到中段内容。新模型（Claude 3.5、GPT-4o、Gemini 1.5 Pro）在这一点上有改善但**未根除**。

**对策**（如果走长 context）：
- 重要内容放头/尾
- 给每段加显式 marker（"以下是核心文档 X..."）
- 关键信息重复一次（首尾）

### 2）成本测算

假设 GPT-4o：input \$2.50 / 1M tokens

| 场景 | input tokens | 单次 cost |
|---|---|---|
| RAG，5 个 chunk × 500 = 2.5K | 2.5K | \$0.006 |
| 长 context，整本说明书 100K | 100K | \$0.25 |
| 1M 全 context（Gemini） | 1M | \$1.25 |

100 万次 QPS 跨度：RAG vs 长 context = **\$6K vs \$250K** 量级差。

### 3）延迟（prefill）

LLM 推理分两阶段：**prefill**（处理 prompt 算每个 token 的 KV）+ **decode**（一个个生成）。Prefill 时间几乎随 input length 线性涨——
- 5K input：~300ms（取决于 GPU + 模型）
- 100K input：可能 3-15s
- 1M input（Gemini）：可能 30s+

**结论**：实时交互场景（chat、机器人响应），**长 context 是用户体验杀手**。

### 4）context caching（关键变量）

Anthropic / Google / OpenAI 现在都支持 **prompt caching**：
- 第一次发 100K prompt：贵
- 第二次同样的前缀 + 不同的 query：缓存命中，**input cost 砍 90%、prefill 几乎不耗**
- TTL 5-60 分钟（各家不同）

**这极大缩小了长 context 的成本/延迟劣势**，对于"系统 prompt 大但 query 多变"的场景（agent system prompt + tool descriptions 几十 K）尤其有用。

### 5）混合方案（业界主流）

```
   query
     │
     ├── coarse-filter ── 关键词 / 元数据筛选
     │
     ▼
   top-100 candidates
     │
     ├── vector similarity（dense）
     ├── BM25（sparse）
     │
     ▼
   top-30 (hybrid score)
     │
     ├── rerank（cross-encoder）
     │
     ▼
   top-5
     │
     ├── + 长 context 容纳完整章节而不只是 chunk
     │
     ▼
   LLM
```

「**RAG 选取相关章节 + 长 context 完整保留章节细节**」是当前最稳的工程方案。

## 延伸追问

- **Q：** 给我个真实场景说明长 context 一定输 RAG / 反之？
  → 长 context **优**：法律合同审查（30 页文档 + 多轮问答，需要看上下文，少出错）。**输**：电商客服（百万 SKU 商品库，每次只查 1 个商品 → RAG）。
- **Q：** 长 context 能解决"知识时效"问题吗？
  → 不能。无论 context 多长，模型权重还是训练截止时间的。要新数据还是要 RAG/工具调用拉新数据。
- **Q：** Gemini 1M context 实测好用吗？
  → 看场景。视频/图书摘要类，1M 一次读进去效果好；问答类还是会有 lost in the middle；**延迟 + 成本**是最大障碍。
- **Q：** 在 Agent 场景哪种用得多？
  → Agent 系统中：① 系统 prompt + tools description 通常长（10-50K，**走 prompt caching**）② 业务知识 → RAG ③ 最近对话 → 短期 message ④ 用户长期偏好 → 记忆抽取。**典型组合 = 缓存系统 prompt + RAG + 短期 message + 记忆**，而非纯长 context。

## 我的记法

- **长 context 没杀死 RAG**——成本、延迟、隔离三个理由
- **lost in the middle**——长 context 中段精度会掉
- **prompt caching** 大幅降低长 context 劣势
- 决策三问：**多大 / 多频繁 / 多用户**
- 主流是**混合方案**——RAG 取章节，长 context 保留细节
- 一句话：**「context 越长越贵越慢越糊涂——选短的，除非有理由选长的」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 测过自己场景下长 context vs RAG 的成本-延迟差

## 参考资料
- [Lost in the Middle 论文](https://arxiv.org/abs/2307.03172)
- [Anthropic Prompt Caching](https://www.anthropic.com/news/prompt-caching)
- [Google Vertex AI Context Caching](https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache)
- [Long Context vs RAG 综述](https://arxiv.org/abs/2407.16833)
