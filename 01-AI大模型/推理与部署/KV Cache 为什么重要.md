---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/_MOC]]"
---

# KV Cache 为什么重要

## 一句话速记

**KV Cache = 自回归生成时把每个 token 的 K/V 矩阵缓存下来**——避免每次 decode 都重算前面所有 token 的 attention。**没有 KV cache，生成 N 个 token 是 O(N²) 计算 + O(N²) 内存读取**；**有了 KV cache 是 O(N) 计算 + O(N) 内存读取**。代价：显存暴涨——KV cache 是 LLM 推理"显存大户"，比模型权重还多。**几乎所有推理优化都围着 KV cache 转**：PagedAttention、Prefix Caching、量化、多卡分摊。

## 通俗解释（5 分钟版）

**先看 attention 的本质**：

```
   生成第 N+1 个 token 时，要做：
   
   query_N = W_q · h_N             ← 当前 token 的 query
   K = [k_0, k_1, ..., k_N]        ← 所有历史 token 的 key
   V = [v_0, v_1, ..., v_N]        ← 所有历史 token 的 value
   
   scores = softmax(query_N · K^T / √d)
   output = scores · V
```

**关键观察**：
- `k_i` 和 `v_i` 是 token i 的 hidden state 通过 W_k / W_v 投影得到的
- **token i 的 K/V 跟生成第 N+1 个 token 时是否产生**完全无关
- 那么——**为什么要每生成一个新 token 都重算前面所有 K/V**？

**KV cache 的洞察**：算过的 K/V 存下来。生成下一个 token 只需要：
1. 算当前新 token 的 q/k/v（O(1)）
2. 把新的 k/v append 到 cache（O(1)）
3. 用新 q 跟整个 cache K/V 做 attention（**注意力计算还是 O(N)**，但比"重算+计算" O(N²) 已经省了一半工作量）

**没 cache 是 O(N²)**：第 1 个 token 算 1 次 K/V，第 2 个算 2 次，第 N 个算 N 次 → 总共 N(N+1)/2 = O(N²)

**有 cache 是 O(N)**：每个 token 只算一次 K/V，append 即可

```
   prefill 阶段 (一次性)：处理整个输入 prompt
       prompt: "你好世界"  →  [k_0, k_1, k_2, k_3]  存入 cache
   
   decode 阶段 (一个一个生成)：
       生成 token 4 → 算 k_4, v_4 → append → cache=[k_0..k_4]
       生成 token 5 → 算 k_5, v_5 → append → cache=[k_0..k_5]
       ...
```

### KV cache 的代价：显存巨大

**显存公式**：

```
KV size (per req) = 2 × num_layers × num_kv_heads × head_dim × seq_len × dtype_bytes
                    │   │            │              │          │         └─ fp16=2, int8=1
                    │   │            │              │          └─ 当前序列长度
                    │   │            │              └─ 每个 head 的维度
                    │   │            └─ KV 头数（GQA 后远少于 attention head 数）
                    │   └─ 模型层数
                    └─ K 和 V 各一份
```

**实际数字**（Llama-3-8B）：
- `num_layers = 32`, `num_kv_heads = 8` (GQA), `head_dim = 128`
- per token = `2 × 32 × 8 × 128 × 2 = 131072 bytes = 128 KB`
- **每 1K context 占 128 MB**
- **8K context 一条请求占 1 GB**
- **100 个 8K 并发请求 = 100 GB**——A100 80G 装不下！

**这就是为什么显存往往成了 LLM 服务的瓶颈，比 FLOPs 还紧。**

## 关键细节 / 数学直觉

### 1）Prefill vs Decode 的工作模式差异

```
   Prefill: 一次性处理 N 个 token (来自 prompt)
   - 工作量: N 次 attention 计算
   - 是 compute-bound（GPU 算得满）
   - 时间≈ N × t_one_token
   
   Decode: 一次生成 1 个 token
   - 工作量: 1 次 attention（read 全部 cache）
   - 是 memory-bound（HBM 读 KV cache 是瓶颈）
   - 时间≈ KV_size / HBM_bandwidth
```

**含义**：
- Prefill 阶段你能堆并发（compute 资源富裕）
- Decode 阶段并发被 HBM bandwidth 限死——这就是 LLM 推理"加 GPU 提升不大"的根因

### 2）KV cache 优化技术总览

| 技术 | 出发点 | 节省 |
|---|---|---|
| **GQA / MQA**（架构层） | 多个 attention head 共享一组 KV head | KV size 砍 4-8x |
| **PagedAttention** | KV cache 分页管理 | 解决碎片，显存利用率 30%→96% |
| **Prefix Caching** | 相同前缀共享 KV | 重复 system prompt 的 prefill 耗时几乎 0 |
| **KV cache 量化** | int8 / int4 存 KV | KV size 砍 2-4x |
| **Tensor Parallel** | KV 沿 head 维度切给多卡 | 单卡显存压力降 |
| **Sliding Window Attention** | 只关注最近 N 个 token | KV 不再无限增长（如 Mistral） |

### 3）GQA / MQA 对 KV cache 的影响

- 标准 Multi-Head Attention：每个 head 一组 K/V → KV size 大
- **MQA（Multi-Query Attention）**：所有 head 共享一组 K/V → KV size 砍掉 head 数倍
- **GQA（Grouped-Query Attention）**：几组 head 共享一组 K/V → 折中（Llama-3 用 8 个 KV head 服务 32 个 attention head）

```
   MHA: 32 attention heads, 32 KV heads → 32 组 K/V
   MQA: 32 attention heads, 1 KV head    → 1 组 K/V (砍 32x，但精度有损)
   GQA: 32 attention heads, 8 KV heads   → 8 组 K/V (砍 4x，精度几乎无损)
```

**这就是为什么现代模型几乎都是 GQA**——不是为了精度，是为了 KV cache 显存。

### 4）Prefix Caching 的工程价值（Agent 场景）

```
   request_1: [system: 你是 agent, tools: ...] [user: 查天气]
   request_2: [system: 你是 agent, tools: ...] [user: 算 1+1]
                ↑ 这一段（可能 30K token）完全一样

   Prefix Caching: 第二条请求看到前缀 hash 一样 → 直接复用 cached KV
                   第二条 prefill 几乎不耗时 ── TTFT 大降
```

vLLM 一个开关 `--enable-prefix-caching`。**Agent 服务不开就是浪费**。

### 5）KV cache 量化（实战）

```bash
# vLLM 量化 KV cache 到 fp8
python -m vllm.entrypoints.openai.api_server \
    --model ... \
    --kv-cache-dtype fp8 \
    --max-model-len 32768
```

效果：KV size 砍一半 → 同显存可服务 2x 并发；精度损失通常 <1%。生产环境多数项目都开。

### 6）长 context 时 KV cache 的麻烦

128K context 的请求 KV cache：
- Llama-3-8B：128 KB × 128K = **16 GB 一条请求**
- 一张 80G 卡装满模型 (16G) 后 → 只能放 4 条 128K 请求
- 这就是为什么"长 context 又贵又慢又不能多人用"——**根因是 KV cache 显存**

正在涌现的解决方向：
- **CPU offload**：把不活跃的 KV 移到 CPU 内存（DeepSpeed-Inference）
- **KV cache 压缩**：只保留重要 token 的 KV（StreamingLLM、H2O）
- **架构改进**：Mamba、RWKV 这种 RNN 类，没有 KV cache 概念

## 延伸追问

- **Q：** KV cache 是不是越多 GPU 越好？
  → 是。Tensor parallel 把 KV 沿 head 维度切多卡 → 单卡 KV 压力降。但 inter-GPU 通信开销也涨。综合下来 70B 模型 4-8 卡是实战甜点。
- **Q：** 流式输出（SSE）跟 KV cache 有什么关系？
  → 没有关系。流式只是把每个 decode 出来的 token 立即推给客户端，KV cache 内部该怎么管还是怎么管。
- **Q：** Agent 场景 KV cache 有什么特别要注意？
  → ① 大 system prompt + tool descriptions 反复用 → **必开 prefix caching** ② 多轮对话每轮 messages 都在长——观察 prompt 长度增长趋势，必要时做 message 截断/压缩 ③ 工具调用结果如果是大文本，注入 prompt 前先 summary。
- **Q：** 边缘设备（机器人本机）跑 LLM，KV cache 有招吗？
  → 量化是关键（int4 模型 + int8 KV）；llama.cpp / MLC-LLM 这类专门为端侧优化的引擎；上下文长度严格控制（一般机器人本机 4K-8K 够用，不追长 context）。

## 我的记法

- **没 KV cache：O(N²)；有了：O(N)**——但代价是**显存爆炸**
- KV size 公式：`2 × layers × kv_heads × head_dim × seq_len × dtype × batch`
- LLM 推理瓶颈通常是**显存** > **算力**，KV cache 是显存大户
- **Decode 是 memory-bound**——加 GPU 不一定加吞吐
- 优化七件套：**GQA / PagedAttention / Prefix Cache / KV 量化 / TP 切 / Sliding Window / Offload**
- 一句话：**「LLM 推理优化 = KV cache 优化」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 自己能在白板算 KV size 给定模型参数

## 参考资料
- [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180)
- [GQA: Training Generalized Multi-Query Transformer Models](https://arxiv.org/abs/2305.13245)
- [Anyscale: Continuous Batching benchmark](https://www.anyscale.com/blog/continuous-batching-llm-inference)
