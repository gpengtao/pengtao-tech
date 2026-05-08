---
tags: [P1, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---

# SGLang 与 vLLM 的差异

## 一句话速记

**vLLM 是通用 LLM 推理"基础设施"**，PagedAttention + Continuous Batching 全场景适用、生态最广；**SGLang 是另一条路线**——核心是 **RadixAttention**（用 radix tree 做更狠的 prefix 共享）+ **结构化生成快**（JSON / 工具调用比 vLLM 明显快），适合 **Agent / 多轮对话 / 重 prefix 重叠** 的场景。**简化结论**：通用服务 vLLM 稳，重 prefix 共享 / 结构化输出 / 多轮对话场景 SGLang 有优势，**两者都是生产级**，能小成本测试谁更适合就测。

## 通俗解释（5 分钟版）

**两个框架的"灵魂差异"**：

| 维度 | vLLM | SGLang |
|---|---|---|
| 出品 | UC Berkeley | UC Berkeley LMSYS（也是 Vicuna 团队） |
| 核心创新 | **PagedAttention** | **RadixAttention** |
| Prefix sharing | 整段前缀匹配（哈希） | radix tree 前缀树（细粒度） |
| 结构化输出 | 支持（vLLM 0.6+ 有 outlines/xgrammar） | **原生强项**（JSON/regex/grammar 编译为 FSM） |
| API 风格 | OpenAI 兼容 | OpenAI 兼容 + 自有 SGLang DSL |
| 生态 | 最广（HuggingFace、Ray、k8s 集成都有） | 后起，但增长快 |
| 文档/调试 | 文档丰富 | 文档相对少 |
| 典型用户 | 通用 LLM 服务、推理平台 | Agent、code interpreter、多轮 chat |

**RadixAttention 是什么**：

vLLM 的 prefix caching 是基于"前缀 hash"的——两条请求**完全一样**的前缀才能共享。SGLang 的 RadixAttention 用 **radix tree（前缀树）** 管理所有 KV cache，做到**细粒度复用**：

```
   场景：多轮对话，user 三次问类似但不同的问题
   
   req1: "你是 agent. ... user: 查北京天气"
   req2: "你是 agent. ... user: 查上海天气"
   req3: "你是 agent. ... user: 查北京 GDP"
   
   vLLM 的 prefix caching：
       三次 prefix "你是 agent..." 完全一样 → 共享
       但 "查北京" / "查上海" 这部分独立算
   
   SGLang 的 RadixAttention：
       Radix tree:
              "你是 agent..."   (共享 KV)
                     │
              "user: 查"        (共享 KV)
                  ┌─┼─┐
            "北京天气" "上海天气" "北京 GDP"
                  │       │           │
                 KV1     KV2         KV3
       
       连"查北京"这个共同前缀也能共享 KV
```

**实际效果**：在 multi-turn chat、tree-of-thought 搜索、多 prompt 评估等"前缀有树形重叠"的场景下，SGLang 的 KV 命中率明显高于 vLLM。

**结构化输出更快**：

LLM 输出 JSON 时，传统做法是生成完文本再 parse；SGLang 把 JSON schema 编译成**有限状态机（FSM）**，每个 decode step 直接限制候选 token 在合法集合内 → 既保证 100% schema 合法、又**省了 token 数**（不会生成无效字符）。

```
   vLLM (用 outlines 等插件): 50% 提速
   SGLang 原生 (xgrammar/sgl): 1.5-3x 提速
```

对 **Function Calling 密集** 的 Agent 服务，这是直接降本。

## 关键细节 / 数学直觉

### 1）RadixAttention 工作机制

LRU 替换的 radix tree：
- 每条请求的 KV 按 token 路径插入 tree
- 命中节点直接复用 KV，不命中节点新分配
- 显存满了按 LRU 踢掉最久未访问的子树
- 共享系数 = (节点 KV size) / (经过该节点的请求数)，越多请求经过越值得保留

性能数据（论文）：
- **Multi-turn chat**：吞吐 vs vLLM 提升 **1.5-3x**
- **Long document QA**（多个 query 同一文档）：**3-5x**
- **Tree-of-Thought**：**5x+**（树状搜索天然有大量前缀重叠）

### 2）SGLang DSL（DSL 是它的特色，但不是必须用）

```python
import sglang as sgl

@sgl.function
def multi_turn(s, question):
    s += sgl.system("你是助手")
    s += sgl.user(question)
    s += sgl.assistant(sgl.gen("answer", max_tokens=200))

# 多个请求自动组合 + 复用 KV
states = multi_turn.run_batch([{"question": q} for q in questions])
```

这套 DSL 是 SGLang 论文展示其威力的方式，但**生产部署时大家依然用 OpenAI 兼容 API**（`/v1/chat/completions`），DSL 是 nice-to-have。

### 3）起服务最简

```bash
# SGLang
pip install "sglang[all]"
python -m sglang.launch_server \
    --model-path meta-llama/Meta-Llama-3-8B-Instruct \
    --port 30000

# 调用（OpenAI 兼容）
curl localhost:30000/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model": "...", "messages": [...]}'
```

### 4）量化 / 多卡 / 长 context

两家都支持得不错：
- **量化**：vLLM 支持 AWQ/GPTQ/FP8/INT4；SGLang 类似覆盖
- **Tensor Parallel**：都支持 `--tp-size N`
- **长 context**：vLLM 支持 PagedAttention 长 context；SGLang 也有 RadixAttention 的长 context 优化（StreamingLLM 风格）

### 5）选型决策表

```
   场景                        建议
   ──────────────────────────────────────
   通用 chat 服务                vLLM（生态/文档）
   多租户大平台                   vLLM（成熟稳）
   重 system prompt（Agent）     vLLM 开 prefix-caching ≈ SGLang
   多轮 chat（user 切换上下文）   SGLang 优势
   ToT / 多分支评估              SGLang 优势
   Function Calling 密集         SGLang 优势（结构化更快）
   Code interpreter / 代码执行    任意（但 SGLang DSL 更顺手）
   边缘设备 / 端侧                 都不主推 → llama.cpp / MLC-LLM
   极致单卡性能                   TensorRT-LLM
   ──────────────────────────────────────
```

### 6）Benchmark 怎么做（自己测）

```bash
# vLLM 自带
python benchmark_serving.py \
    --backend vllm --request-rate 10 --num-prompts 1000

# SGLang
python -m sglang.bench_serving \
    --backend sglang --request-rate 10 --num-prompts 1000
```

**关键**：用**你自己业务的真实 prompt 形态** benchmark——别拿 sharegpt 数据集得出的结论直接迁移到你重 system prompt 的 Agent 场景。

## 延伸追问

- **Q：** 二者会"越来越像"吗？
  → 是。vLLM 0.5+ 加了类似 prefix tree 的优化，SGLang 也在追 vLLM 的部署成熟度。**未来可能两者主要差别只是 API 风格**。但目前 SGLang 在 RadixAttention + 结构化输出仍领先。
- **Q：** 可以用同一套部署架构同时支持 vLLM 和 SGLang 吗？
  → 可以。两者都暴露 OpenAI 兼容接口，应用层完全不用改。**多家平台**（OpenLLM、Ray Serve）都支持两个 backend。
- **Q：** Agent 场景具体能省多少？
  → 实测经验值：① system prompt + tools desc 共 30K，每秒 100 个不同 user query → vLLM 开 prefix-caching 提速 ~2x，SGLang RadixAttention 提速 ~2.5x ② 结构化 JSON 输出（function calling）SGLang vs vLLM 提速 ~1.5x。**真省钱**。
- **Q：** 具身机器人会用哪个？
  → 云端规划层 LLM 大量场景重 prefix（system prompt 描述任务规则、技能列表），SGLang 有优势；本机如果跑小模型，更可能用 llama.cpp / MLC-LLM。

## 我的记法

- **vLLM = LLM 服务的通用底座**，生态宽
- **SGLang = LLM 服务的"prefix 优化版"**，多轮/结构化场景更狠
- 杀手锏对比：**PagedAttention（vLLM）vs RadixAttention（SGLang）**
- 都 OpenAI 兼容、都生产级、**A/B 测试就能选**
- 一句话：**「vLLM 像 nginx，SGLang 像高度优化的 envoy——通用要 vLLM，Agent 重 prefix 试 SGLang」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 SGLang 起过服务并 benchmark 跟 vLLM 对比

## 参考资料
- [SGLang 论文](https://arxiv.org/abs/2312.07104) — RadixAttention 介绍
- [SGLang GitHub](https://github.com/sgl-project/sglang)
- [SGLang vs vLLM benchmark blog](https://lmsys.org/blog/2024-07-25-sglang-llama3/)
