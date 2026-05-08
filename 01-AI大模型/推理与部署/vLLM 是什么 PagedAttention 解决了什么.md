---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---

# vLLM 是什么 PagedAttention 解决了什么

## 一句话速记

**vLLM = UC Berkeley 出的开源 LLM 推理引擎，核心创新是 PagedAttention**——把 LLM 推理的"显存大户" KV cache **按操作系统虚拟内存的方式分页管理**，解决了 KV cache 内存碎片导致的"显存看着够但批不起来"的痛点。**结果**：相比朴素 HuggingFace transformers，**吞吐提升 10-24 倍**，是当前生产级 LLM 推理的事实标准之一。

## 通俗解释（5 分钟版）

**先理解 KV cache 为什么是显存大户**：
- LLM 自回归生成：每个新 token 要看前面所有 token 的 K/V 矩阵
- 如果不缓存，每次都重新算前面所有 token 的 K/V → O(n²) 计算爆炸
- 所以**缓存 K/V**：每生成一个 token，把 K/V 写下来；下次直接用
- 一条 7B 模型 + 1024 上下文的请求 KV cache ≈ **数百 MB**——一张 A100 80G 装不了多少条

**朴素实现的痛**：
- 朴素方式：给每条请求 malloc 一块连续显存（按"最大可能长度"预留）
- 用户输入 500 token，预留了 4096 → **浪费 80% 显存**
- 多条请求并发时：长的占大块、短的占小块，**碎片化**——看着空闲 30G，但没一块连续 4G 装新请求 → 拒绝服务
- 这就是为什么"GPU 利用率 30% 但显存爆了"的悖论

**PagedAttention 怎么解**：

```
   朴素方案（每请求一段连续显存）：
   GPU 显存：[req1: ████████ 闲闲闲闲][req2: ███ 闲闲闲闲闲]...
            ▲ 大量碎片，看着空但插不进新请求 ▲
   
   PagedAttention（分页 + 间接寻址）：
   GPU 显存：[ block_0 | block_1 | block_2 | block_3 | ... ]
            ↑          每个 block 是固定大小的 KV 槽位（如 16 token）
            req1 的 KV 占 [block_3, block_7, block_12]  ← 链表式不连续
            req2 的 KV 占 [block_5, block_8]
            新请求来 → 找几个空 block 分配 → 0 碎片
```

**类比操作系统**：
- 朴素 LLM = 给每个进程预留连续物理内存（DOS 时代）
- PagedAttention = OS 虚拟内存分页（Linux/Windows）——每个进程看着连续，物理上是分散的页

**带来什么**：
- 显存利用率 **30% → 96%**（论文数据）
- 同样的 GPU 能批更多请求 → 吞吐 **10-24x**
- **prefix sharing**：多个请求共享同一段 system prompt 的 KV → 只算一次（**对 Agent 大 system prompt 场景巨省**）

## 关键细节 / 数学直觉

### 1）KV cache 显存估算

公式：

```
KV_size = 2 × num_layers × num_heads × head_dim × seq_len × dtype_bytes × batch_size

例：Llama-3-8B
  num_layers = 32
  num_heads = 8 (GQA, 不是 attention head 数 32)
  head_dim = 128
  fp16: 2 bytes
  
  per token per layer = 2 × 8 × 128 × 2 = 4 KB
  per token = 4KB × 32 layers = 128 KB
  
  4096 token 一条请求 KV ≈ 4096 × 128 KB ≈ 512 MB
  100 并发 4096 长度 ≈ 50 GB
```

**含义**：A100 80G 跑 Llama-3-8B，模型本身吃 16G，剩 64G 给 KV—— 理论上能容纳几百条短请求或几十条长请求，**前提是没碎片浪费**。

### 2）PagedAttention 算子

朴素 attention：`Attn(Q, K, V) = softmax(QK^T / √d) V`，K/V 是连续大矩阵

PagedAttention：
- K/V 拆成多个 page（比如每 page 16 token）
- 每条请求维护一个 **block_table**（页号 → 物理 block id）
- attention kernel 通过 block_table 间接寻址，从分散的 block 里读 K/V

底层实现是定制 CUDA kernel（vLLM 团队写的，后来贡献回 PyTorch 生态）。

### 3）Prefix Caching（vLLM 0.4+）

vLLM 进一步加了 prefix caching——不同请求**前缀相同**的部分共享 KV：

```
   req1: "你是有用助手。请回答：什么是 RAG？"
   req2: "你是有用助手。请回答：什么是 vLLM？"
                                   ↑
   蓝色部分 KV 完全一样 ── PagedAttention 让两条 req 共享同样的物理 page
   
   结果：第二条请求的 prefill 几乎不耗时（hit cache）
```

**Agent 场景超级有用**：system prompt + tool descriptions 经常 10-50K tokens，每条请求都重算 = 巨浪费。开启 prefix caching 后**首字延迟（TTFT）大降**。

### 4）vLLM 起服务最简命令

```bash
# 安装
pip install vllm

# 启动 OpenAI 兼容 API server
python -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Meta-Llama-3-8B-Instruct \
    --dtype auto \
    --tensor-parallel-size 1 \
    --gpu-memory-utilization 0.9 \
    --max-model-len 8192 \
    --enable-prefix-caching
```

立即就有一个 `localhost:8000/v1/chat/completions` 端点，OpenAI SDK 直接连。

### 5）关键参数旋钮

| 参数 | 含义 | 调优思路 |
|---|---|---|
| `--tensor-parallel-size` | 多卡切模型 | 7B 单卡，70B 必须 4-8 卡 |
| `--max-model-len` | 上下文上限 | 越大越占显存，按业务设 |
| `--gpu-memory-utilization` | 显存预算比例 | 0.9 较平衡，太高易 OOM |
| `--max-num-seqs` | 最大并发请求数 | 默认 256，结合 KV 显存调 |
| `--max-num-batched-tokens` | 单 batch token 上限 | prefill 长 prompt 关键 |
| `--enable-prefix-caching` | 开 prefix cache | Agent 场景必开 |
| `--quantization` | 量化方式 | AWQ/GPTQ 省显存 |

### 6）和别的引擎对比一句话

| 引擎 | 一句话 |
|---|---|
| **vLLM** | 通用、生态最广、PagedAttention 标杆 |
| **SGLang** | RadixAttention（更狠的 prefix tree 共享），结构化生成快 |
| **TensorRT-LLM** | NVIDIA 自家，单卡极致性能，但环境复杂 |
| **Text Generation Inference (TGI)** | HuggingFace 出，集成好，性能比 vLLM 慢一些 |
| **llama.cpp** | CPU/Mac/边缘设备首选，但企业生产较少 |

## 延伸追问

- **Q：** vLLM 为什么不能给我 X 倍提升（实测才 3 倍）？
  → 几个常见原因：① 你的 baseline 已经是优化过的 ② batch 上不去（请求量本就少）③ 模型太小（小模型 attention 不是瓶颈）④ 输出 token 多于输入（PagedAttention 优势在 KV cache 管理，对 decode 阶段帮助有限）。
- **Q：** Continuous batching 和 PagedAttention 是什么关系？
  → 互补不可分。Continuous batching 解决的是「每步都拉新请求进 batch」（**调度问题**），PagedAttention 解决的是「KV cache 碎片」（**内存问题**）。vLLM 两个都做。
- **Q：** vLLM 在 CPU 上能跑吗？
  → 0.6+ 版本支持 CPU 后端，但不是主战场——CPU 推理首选 llama.cpp。vLLM 的优势依赖 GPU 的 attention kernel。
- **Q：** 具身机器人能用 vLLM 吗？
  → 云上规划 LLM 用 vLLM 没问题。本机端如果是 NVIDIA Jetson 这类 GPU 嵌入式，可以跑（有专门的 ARM 构建）；普通边缘 CPU 设备就用 llama.cpp + 量化模型更现实。

## 我的记法

- **vLLM = LLM 的 nginx**——开源、好用、生产标杆
- 杀手锏：**PagedAttention**（KV cache 分页 → 显存碎片归零）
- 三大特性：**PagedAttention / Continuous Batching / Prefix Caching**
- KV size 公式：`2 × layers × heads × head_dim × seq_len × dtype × batch`
- Agent 场景必开：**`--enable-prefix-caching`**（system prompt 共享）
- 一句话：**「PagedAttention = LLM 显存的虚拟内存」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 在云 GPU 起过一次 vLLM 服务做 QPS 测试

## 参考资料
- [vLLM 官方文档](https://docs.vllm.ai/)
- [PagedAttention 论文 (Kwon et al., 2023)](https://arxiv.org/abs/2309.06180)
- [vLLM GitHub](https://github.com/vllm-project/vllm)
