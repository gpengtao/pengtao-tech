---
tags: [P1, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/_MOC]]"
---

# LoRA 和 QLoRA 的区别

## 一句话速记

**LoRA = 给原模型每层 attention 加一对低秩矩阵 A/B（A: d×r、B: r×d，r 远小于 d），只训练这俩，原参数冻结**——可训参数从全模型的 100% 降到 < 1%；**QLoRA = LoRA + 把 base 模型量化到 4-bit + 再加几个工程 trick（NF4、双重量化、paged optimizer）**——让单张 24GB 消费级 GPU 能微调 7B 甚至 13B 模型。**结论**：LoRA 是数学方法，QLoRA 是工程优化方案，**生产/学习场景几乎都用 QLoRA**。

## 通俗解释（5 分钟版）

**先看全量微调的痛**：
- 7B 模型 fp16 ≈ 14 GB；fp32 ≈ 28 GB；加上 optimizer state（Adam 一份 fp32 weight + fp32 m + fp32 v ≈ 模型 4x） + gradient（同模型大小） + activation
- **训练 7B 全量微调实际显存 ≈ 80-150 GB**，单卡 A100 80G 都吃力
- 70B 更夸张，要 8 卡 A100/H100 起步

**LoRA 的核心 idea**（Hu et al., 2021）：

不改原权重 `W`（冻结它），在 attention 层加一个**旁路**：

```
   原始：    h = W · x                         (W: d×d)
   
   LoRA：    h = W · x + (B · A) · x            (A: r×d, B: d×r,  r << d)
                  ^^^^^                  
                  冻结        ^^^^^^^
                              只训练这俩
```

**关键观察**：
- `W` 是 d×d = d² 参数（d=4096 时 1600 万）
- `A·B` 一共 d×r + r×d = 2dr 参数（r=8 时 65K，**减少 250 倍**）
- 训练时只算 A、B 的梯度 → optimizer state 砍 99%
- 推理时可以**把 BA 加回 W**（`W' = W + BA`）→ **零延迟开销**

**直觉**：研究发现微调时权重的"实际变动"是低秩的——10 层 transformer 的 4096×4096 权重矩阵，做完任务微调后，**真正变了的部分用秩 r=8 就能很好近似**。所以训练全量是浪费。

```
   "全量微调" = 训 16M 参数
        ▼
   "LoRA r=8" = 训 65K 参数, 占内存 250x 少
        ▼ 效果几乎等价（任务迁移这种 narrow 调整）
   "QLoRA" = LoRA + base 模型 4-bit 量化, 再砍内存 4x
        ▼ 24G 卡跑 7B 微调
```

### QLoRA 的三个工程 trick

```
   ┌────────────────────────────────────────────┐
   │  ① NF4 (NormalFloat4) 量化                  │
   │     base 模型权重存成 4-bit, 推理时反量化  │
   │     7B fp16 (14G) → 7B NF4 (3.5G)          │
   │                                              │
   │  ② Double Quantization                       │
   │     量化用的 scale 也再量化一次             │
   │     省 ~0.5GB                                │
   │                                              │
   │  ③ Paged Optimizer (NVIDIA UVM)              │
   │     optimizer state 在显存不够时 page out CPU│
   │     防止 OOM 而非增加速度                    │
   └────────────────────────────────────────────┘
   
   结果：7B 模型微调实战显存 = ~16 GB（包括激活）
        24GB RTX 4090 / 3090 / A4000 都能跑
```

## 关键细节 / 数学直觉

### 1）LoRA 的关键超参

| 参数 | 含义 | 推荐值 |
|---|---|---|
| `r`（rank） | 低秩矩阵的秩 | 8 / 16 / 32 / 64（任务越复杂越大） |
| `alpha` | scale 系数（实际更新 = α/r × BA） | 通常 2r（如 r=16 → α=32） |
| `target_modules` | 哪些层加 LoRA | 经验：q_proj, k_proj, v_proj, o_proj 全加；MLP 层选加 |
| `dropout` | LoRA 矩阵的 dropout | 0.05-0.1 |
| `learning_rate` | 学习率 | 1e-4 ~ 5e-4（比全量大 10x，因为只动一小部分） |

**经验法则**：
- 简单任务 / 风格化（语气、格式）：r=8 够
- 中等复杂度 / 领域适配：r=16-32
- 高难度（代码、数学）：r=64+，甚至全量微调

### 2）最简代码（Hugging Face PEFT + bitsandbytes + transformers）

```python
from transformers import AutoModelForCausalLM, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model

# QLoRA 量化配置
bnb = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_use_double_quant=True,
    bnb_4bit_compute_dtype=torch.bfloat16,
)
model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-3-8B", quantization_config=bnb)

# LoRA 配置
lora = LoraConfig(
    r=16, lora_alpha=32, lora_dropout=0.05,
    target_modules=["q_proj","k_proj","v_proj","o_proj"],
    bias="none", task_type="CAUSAL_LM",
)
model = get_peft_model(model, lora)
model.print_trainable_parameters()
# trainable: 0.5%

# 然后用 trl SFTTrainer / unsloth / axolotl 训练即可
```

### 3）训练框架对比

| 工具 | 一句话 |
|---|---|
| **HF PEFT + transformers** | 标杆，生态最全 |
| **TRL** | HF 出，集成 SFT/DPO/PPO/RM trainer |
| **Axolotl** | 配置文件驱动，一个 yaml 跑 SFT/LoRA/QLoRA |
| **Unsloth** | 优化版 PEFT，**速度 2-5x**，显存还省，但只支持单卡 |
| **LLaMA-Factory** | 国内活跃，支持 GUI 配置，对中文友好 |

**学习路径建议**：先 Axolotl 或 LLaMA-Factory 跑通一个，再回头看 PEFT 源码理解原理。

### 4）LoRA 多任务的杀手锏：可拆可插

```python
# 训完两个不同任务的 LoRA
lora_chat = "./lora-chat-style"
lora_code = "./lora-code"

# 推理时按需加载/卸载
model.load_adapter(lora_chat, adapter_name="chat")
model.load_adapter(lora_code, adapter_name="code")
model.set_adapter("chat")  # 切换不同 adapter

# 也可以多 adapter 并存（适合 SaaS 多租户）
```

**生产价值**：base 模型一份，每个客户一个 LoRA adapter，**显存只多一点**，能服务 N 倍租户。vLLM 也支持 LoRA adapter dynamic loading。

### 5）合并 LoRA 进 base 模型

训完想推理：
```python
merged = model.merge_and_unload()  # BA 加进 W
merged.save_pretrained("./merged-model")
# 然后这个 merged 模型可以直接用 vLLM 部署，不需要 PEFT 依赖
```

merged 后**推理零额外开销**，跟原 base 模型完全一样。

### 6）QLoRA 的精度损失

QLoRA 论文（Dettmers et al., 2023）测试：
- NF4 量化的 base 模型 + LoRA 微调
- 在 vicuna eval 等 benchmark 上**和 fp16 全量微调精度差距 < 0.1%**

但**强 reasoning 任务**（数学、编程）有时会有 1-3% 差异——这块要自己实测。

## 延伸追问

- **Q：** LoRA 推理快还是慢？
  → 不合并：每次 forward 多算一遍 BA，**慢 5-10%**；合并后：**和原模型完全一样**。生产部署一定要 merge 后再起服务。
- **Q：** 哪些层加 LoRA 最有效？
  → attention 的 q/k/v/o 是标配；FFN（gate_proj/up_proj/down_proj）加上效果一般会更好但显存↑。**追求效果可以全加**（QLoRA 论文推荐）。
- **Q：** LoRA 适合学新知识还是改风格？
  → 改风格 / 改格式 / 改语气 / 学指令格式 → **LoRA 拿手**；学新事实知识 → **LoRA 较弱**，建议 RAG。
- **Q：** Loss 看着降但效果不对怎么办？
  → 经典 SFT 翻车——往往是 **数据格式不对**（chat template 没对齐）、**eval set 跟训练集分布不一致**、**LR 太大灾难遗忘**。一定要训前做几条人工标注样本走一遍 forward 对照 eval。

## 我的记法

- **LoRA = 数学**（低秩矩阵旁路），节省 99%+ 训练参数
- **QLoRA = 工程**（LoRA + 4-bit base + 三个 trick），单卡 24G 跑 7B 微调
- 关键超参：**r / alpha / target_modules / lr**
- 训完**合并** LoRA 进 base，推理零开销
- 多 LoRA adapter 同 base —— **多租户/多任务的杀手锏**
- 一句话：**「想自己跑微调，QLoRA 就够；想理解原理，回头读 LoRA 论文」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 在 24G 卡上跑过一次 QLoRA 7B 微调

## 参考资料
- [LoRA 原论文](https://arxiv.org/abs/2106.09685)
- [QLoRA 论文](https://arxiv.org/abs/2305.14314)
- [HuggingFace PEFT 文档](https://huggingface.co/docs/peft/)
- [Unsloth GitHub](https://github.com/unslothai/unsloth)
