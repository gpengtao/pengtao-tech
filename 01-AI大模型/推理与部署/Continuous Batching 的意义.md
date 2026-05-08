---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/_MOC]]"
---

# Continuous Batching 的意义

## 一句话速记

**Continuous Batching = 每步生成完都重新组 batch**——新请求随时进、完成的请求随时出，不再等"整批结束"。对比 static batching（攒满 batch → 跑完 → 下一批），continuous batching 把 GPU 利用率从 ~30% 提到 ~80%+，**吞吐 10-23 倍**，是 vLLM/TGI/SGLang 的共同基石。

## 通俗解释（5 分钟版）

**先看 Static Batching 的痛**：

```
   t=0     t=1     t=2     t=3     t=4
   ┌───────────────────────────────────┐
   │ req A: ████████ done             │  ← A 输出 4 token 就完了
   │ req B: ██████████████████ done   │  ← B 输出 8 token，但 A/C 还在等
   │ req C: ███████████ done          │  ← C 完了也要等 B
   └───────────────────────────────────┘
              ▲
              A 已经空转，但 GPU 整 batch 在跑 B
              新来的 req D 必须等整 batch 结束才能进
```

**Static batching 的两个问题**：
1. **木桶效应**：batch 内最慢的一条决定整 batch 用时——快完成的请求白白占着 GPU 资源
2. **无法插队**：新请求要等整批跑完才能加入，导致**延迟极不友好**——最坏情况新请求要等几秒

LLM 输出长度是**完全不可预测**的（用户问"你好"输出 5 token，问"写一篇 1000 字作文"输出 1500 token），所以 static batching 在 LLM 上的木桶效应**特别严重**。

**Continuous Batching 的核心一句话**：

> **每个 decode step（生成一个 token）结束后，立刻重新组 batch**——已完成的请求踢出，pending 队列里的新请求加入。

```
   t=0     t=1     t=2     t=3     t=4     t=5    
   ┌────────────────────────────────────────────┐
   │ req A: ████████ done                      │
   │ req B: ██████████████████ done            │
   │ req C: ███████████ done                   │
   │              req D: ███████████ done      │  ← A 一完成就插进来
   │                       req E: ████ ...     │  ← C 一完成就插进来
   └────────────────────────────────────────────┘
              ▲
              GPU 始终满载，无空转
```

**为什么 LLM 推理特别适合这玩法**：
- 每生成一个 token 是一次"独立 step"——只要 KV cache 在，可以随便加新请求
- attention kernel 现在支持 **variable length batching**（不同请求长度不同也能一起算，每条请求自己长度）
- KV cache 用 PagedAttention 管理后，加入新请求不用整体 reshape，直接申请新 page

**注意**：continuous batching 主要影响 **decode 阶段**。**Prefill 阶段**（处理新请求的 prompt）是另一回事——通常单独 fan-out 一下，跟 decode 错峰，避免 prefill 大请求拖累整批 decode（这就是 vLLM 的 chunked prefill 等技术）。

## 关键细节 / 数学直觉

### 1）Static vs Continuous 性能差距来源

| 指标 | Static | Continuous |
|---|---|---|
| GPU 平均利用率 | 20-40% | 70-90% |
| 单请求 TTFT | 等 batch fill 满（很慢） | 立即 prefill |
| 吞吐 (token/s) | 1x | 10-23x |
| 长尾延迟 | 跟着木桶（最长那条） | 各自结束 |

vLLM 论文测试：Llama-13B 在 A100，**static 30 token/s/GPU vs continuous 700+ token/s/GPU**。

### 2）Iteration-level scheduling（核心算法）

每个 decode step 后跑一遍 scheduler：

```python
# 伪代码（vLLM 大致逻辑）
while not all_done:
    # 1) 完成的请求出去
    finished = [r for r in running if r.is_done()]
    for r in finished:
        send_response(r)
        running.remove(r)
        free_kv_cache_pages(r)
    
    # 2) 等待队列里的新请求挤进来（如果显存够）
    while waiting_queue and have_kv_pages(waiting_queue[0]):
        new_req = waiting_queue.pop(0)
        prefill(new_req)            # 算它的 prompt KV
        running.append(new_req)
    
    # 3) 整个 running 一起跑一个 decode step
    decode_step(running)
```

**关键观察**：scheduler 不基于"时间片"，而是基于"step"——LLM 每个 step 是固定的工作量（一次 forward pass）。

### 3）Prefill 与 Decode 的冲突

新请求挤进来需要 **prefill**（一次性算它整个 prompt 的 KV），如果 prompt 长（比如 10K），prefill 一次吃几百毫秒——会**阻塞**所有正在 decode 的请求。

**对策**（vLLM 0.5+）：
- **Chunked prefill**：长 prompt 拆成小块，每个 step 只处理一小块 prefill + 全量 decode。让 decode 不至于卡几百 ms
- **Prefill / decode 分离部署**：两组节点，prefill 节点专门处理新请求并算好 KV → 传给 decode 节点。Disaggregation 是 2024+ 的新方向

### 4）和 Throughput / Latency 取舍

continuous batching 默认是吞吐优先：
- batch size 越大 → 吞吐越高，**单请求延迟越长**（GPU 同时跑更多请求会变慢一点）
- batch size 限制可以拧紧 → 吞吐降，单请求延迟降

vLLM 参数：`--max-num-seqs`（最大并发请求数）、`--max-num-batched-tokens`（每 step 总 token 上限）。要低延迟场景（比如机器人交互），把这俩拧小。

### 5）实战测试方法

```bash
# 用 vLLM 自带 benchmark 脚本
python benchmark_serving.py \
    --backend vllm \
    --model meta-llama/Meta-Llama-3-8B-Instruct \
    --dataset-name sharegpt \
    --request-rate 10 \
    --num-prompts 1000

# 关键指标看：
# - Total Throughput (token/s)
# - Mean TTFT (ms)
# - Mean TPOT (ms)
# - p99 latencies
```

## 延伸追问

- **Q：** Static batching 现在还有用吗？
  → 离线/批处理场景仍可用——比如夜间批量跑数据集 evaluate。本质是**吞吐优先 + 没有延迟约束**。在线服务一律 continuous。
- **Q：** Continuous batching 对短请求 vs 长请求公平吗？
  → 不那么"公平"。长请求生成期间会一直占 KV cache page，挤占新请求的空间。**对策**：scheduler 加优先级（短请求或 SLA 严的优先 schedule）；或者按 user/token quota 限流。
- **Q：** GPU 利用率 100% 一定好吗？
  → 不一定。GPU "compute utilization" 100% 可能 memory bandwidth 被打满了；要看 nvidia-smi DCGM 里的 SM activity / memory bandwidth / NVLink util 才能下结论。LLM 推理 decode 阶段经常 **memory-bound**——SM 利用率不到 50% 就达到 memory bandwidth 上限。
- **Q：** 具身场景对 continuous batching 有什么特殊要求？
  → 机器人对**单请求延迟**敏感（动作要 10-30Hz 出指令），而非吞吐。所以 batch size 要拧小、prefill 单独做、考虑 prefill/decode 分离。极致场景甚至单批单实例（batch=1）牺牲吞吐换延迟。

## 我的记法

- **Static = 等整批结束 vs Continuous = 每步重组 batch**
- **GPU 利用率 30% → 80%+**，吞吐 **10-20x**
- 不解决长请求挤短请求的"公平"问题——靠 scheduler 加优先级
- Prefill / decode 是两件事，**继续分离是 2024+ 趋势**
- 一句话：**「continuous batching 是 LLM 服务从'实验室能跑'到'能上生产'的最大变量」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 vLLM benchmark 工具测过 throughput

## 参考资料
- [Orca 论文 (Yu et al., 2022)](https://www.usenix.org/conference/osdi22/presentation/yu) — continuous batching 概念起源
- [vLLM 论文](https://arxiv.org/abs/2309.06180)
- [vLLM Continuous batching 文档](https://docs.vllm.ai/en/latest/dev/sampling_params.html)
