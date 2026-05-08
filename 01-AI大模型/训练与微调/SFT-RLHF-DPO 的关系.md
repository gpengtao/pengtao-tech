---
tags: [P1, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---

# SFT-RLHF-DPO 的关系

## 一句话速记

**LLM "对齐"三阶段**：① **SFT（Supervised Fine-Tuning）**：用 (instruction, response) 数据教模型"格式 + 知识"——最简单也最常用；② **RLHF（PPO）**：先训 reward model，再用强化学习把模型行为推向 reward 高的方向，工程复杂、显存爆、调参难；③ **DPO（Direct Preference Optimization）**：直接用 (chosen, rejected) 偏好对优化，**绕过 reward model 和 RL**，等价于 RLHF 但工程上简单 10 倍——**现在多数偏好学习选 DPO，不再上 PPO**。

## 通俗解释（5 分钟版）

**为什么需要这三个阶段**：
- 预训练（PT）：让模型学会语言（无监督，next token prediction）
- 但 PT 完的模型是"补全机"，不会按指令回答——给它 "1+1=" 可能续写 "2 是一个偶数..."
- **要让它"听话"，需要对齐**

**三阶段对齐 = 三个不同形态的数据 + 三个不同 loss**：

```
┌────────────────────────────────────────────────────────────────┐
│                                                                  │
│  PT（预训练，先有这个）                                          │
│       数据：互联网爬的纯文本                                     │
│       学：next token                                              │
│       结果：会说话，但不会按指令做事                             │
│                                                                   │
│  ▼                                                                │
│                                                                   │
│  SFT（监督微调）                                                  │
│       数据：(instruction, response) 对                           │
│       例：("写一首关于猫的诗", "白毛浮绿水...")                   │
│       学：让模型见到 instruction 时复现 response                 │
│       Loss：cross-entropy on response token                      │
│       结果：会按指令回答，但回答可能不够好/不安全/瞎说          │
│                                                                   │
│  ▼                                                                │
│                                                                   │
│  RLHF (PPO) 或 DPO （偏好对齐）                                   │
│       数据：(prompt, chosen response, rejected response)         │
│       例：("如何造炸弹", chosen="不能教这", rejected="先准备...")│
│       学：让模型多输出像 chosen 的、少输出像 rejected 的          │
│       Loss：RLHF 用 PPO 复杂；DPO 直接用偏好数据                  │
│       结果：模型更安全、更有用、更"和人类口味对齐"               │
│                                                                   │
└────────────────────────────────────────────────────────────────┘
```

### SFT —— 学格式和知识

**数据格式**（chat template）：

```json
{
  "messages": [
    {"role": "system", "content": "你是有用助手"},
    {"role": "user", "content": "1+1 等于几"},
    {"role": "assistant", "content": "1+1 等于 2"}
  ]
}
```

模型见到 user message 后，目标是输出和 assistant 一样。Loss 只对 assistant token 算（`mask` 掉前面的 instruction 部分）。

**踩坑点**：
- chat template 跟 base 模型必须对齐（Llama-3 用 `<|begin_of_text|>...<|eot_id|>`，Qwen 用 `<|im_start|>...<|im_end|>`），格式错就退化
- 数据质量比数量重要——10K 高质量 > 100K 一般
- 必有 eval set，过拟合表现得很微妙（loss 还在降，输出已经退化）

### RLHF —— 难度大、显存爆

经典 RLHF 三步走（OpenAI ChatGPT 那篇论文）：

```
   step 1: SFT（先做）
   step 2: 训 Reward Model
       数据：(prompt, response_a, response_b, label="a 好" or "b 好")
       Loss：让 RM 给 chosen 的 score > rejected 的 score
   step 3: PPO 优化 SFT 模型
       同时跑：
           policy（要训的模型，初始 = SFT model）
           reference（冻结的 SFT model 副本，防止跑偏）
           reward model（冻结，给打分）
           value model（critic，估计未来 reward）
       PPO loss = max reward - β·KL(policy || reference)
```

**为什么难**：
- **同时驻 4 个模型显存** = 4x 内存 → 必须分布式
- 强化学习训练**不稳定**（reward hacking、KL 爆炸）
- **超参敏感**：β（KL 惩罚权重）、learning rate、batch size 都难调
- 工程链条长 → 不少团队尝试后放弃

### DPO —— 直接绕过 RL

**Rafailov et al., 2023 的核心洞察**：

> 数学上可以证明：用 PPO + reward model 解 RLHF 的最优解，**等价于** 直接用 **(chosen, rejected) 偏好数据 + 一个简单 loss** 优化。

DPO loss（直觉版）：

```
   L_DPO = -log σ( β · [ log(π(chosen|prompt) / π_ref(chosen|prompt)) 
                        - log(π(rejected|prompt) / π_ref(rejected|prompt)) ] )
   
   人话：
       让 policy 给 chosen 的概率比 ref 高
       让 policy 给 rejected 的概率比 ref 低
       两者 gap 越大，loss 越小
```

**带来的好处**：
- 不需要训 reward model
- 不需要跑 RL（PPO）
- **只需要 2 个模型在显存**（policy + reference frozen），比 PPO 省一半
- 训练稳定、超参少、收敛快

**代价**：
- 需要高质量偏好数据对（chosen/rejected）—— 数据是核心难度
- 极端场景（reward 设计很复杂的）DPO 表达力略弱，但绝大多数场景够用

**当前业界共识**：
- 中小团队 / 学术 / 大多数产品：**DPO 是默认选择**
- 大模型公司核心模型：仍可能用 RLHF（更精细控制）+ DPO 后期补充

## 关键细节 / 数学直觉

### 1）数据规模典型量级

| 阶段 | 典型数据量 |
|---|---|
| SFT | 1K-100K 样本（小项目几千够用） |
| Reward Model | 10K-100K 偏好对 |
| RLHF (PPO) | 用 RM 给奖励，prompt 数千-数万 |
| DPO | 5K-50K 偏好对 |

### 2）DPO 简化代码

```python
from trl import DPOTrainer, DPOConfig

config = DPOConfig(
    output_dir="./dpo-out",
    beta=0.1,            # KL 惩罚强度
    num_train_epochs=1,
    learning_rate=5e-7,  # DPO 通常很小
)

trainer = DPOTrainer(
    model=policy_model,
    ref_model=ref_model,   # 冻结的 SFT model
    args=config,
    train_dataset=preference_dataset,  # 含 prompt/chosen/rejected
    tokenizer=tokenizer,
)
trainer.train()
```

### 3）超参敏感度

| 超参 | 推荐 | 影响 |
|---|---|---|
| `beta`（KL 强度） | 0.1（DPO） / 0.01-0.1（PPO） | 大 → 模型变化小，安全；小 → 变化大，可能跑偏 |
| `learning_rate` | DPO 5e-7 ~ 1e-6 | 比 SFT 小 100-1000x！否则灾难遗忘 |
| `epochs` | DPO 1-3 | 多轮容易过拟合偏好数据 |

### 4）DPO 的变体

业界已经有一堆 DPO 变体：
- **IPO**（Identity Preference Optimization）：解决 DPO 在偏好"明确"时容易过拟合
- **KTO**（Kahneman-Tversky Optimization）：不需要 (chosen, rejected) 对，单条带"好/坏"标签即可
- **ORPO**：把 DPO 和 SFT 合到一个 loss，省一步
- **SimPO**：去掉 reference model，进一步省显存

**选哪个**：实战首选 **DPO**，遇到问题再调研变体。

### 5）Constitutional AI / RLAIF

不依赖人类标注，而是**用 AI 标注偏好**：
- 给一个原则 prompt（"宁可拒绝也不给暴力建议"）
- 让一个强模型当裁判生成 (chosen, rejected) 对
- 然后跑 DPO

适合**安全对齐**（数据可大量生成）；事实精度类任务还是要人工。

### 6）和 SFT 怎么搭

实操典型流水线：

```
   base 模型
      │
      ▼
   SFT (1-3 轮高质量数据)  ← 必做
      │
      ▼
   DPO (1 轮偏好数据)      ← 强烈推荐做
      │
      ▼
   线上部署 → 拿用户反馈 → 加入新一批偏好数据 → 再 DPO
```

**只 SFT** 通常已经能上线 demo；**SFT+DPO** 是生产级常见组合；**RLHF/PPO** 留给最大型项目。

## 延伸追问

- **Q：** SFT 完直接 DPO 还是先 reward model？
  → DPO 不需要 RM，直接训。**RM 在 RLHF 路线才用**——除非你想做 BoN（Best-of-N）推理时 rerank。
- **Q：** DPO 会不会遗忘 SFT 学到的能力？
  → 会一些。`beta` 大一点（0.1-0.3）+ learning rate 小（5e-7）能缓解。也可以混入一部分 SFT 数据一起训（"DPO+SFT"）。
- **Q：** 偏好数据从哪来？
  → ① 人工标注（贵但准）② AI 标注（RLAIF，便宜但有偏见）③ 用户日志（用户点赞/踩、A/B test）④ 公开数据集（HH-RLHF、UltraFeedback）。
- **Q：** 微调 vs 提示工程的边界？
  → SFT/DPO 适合：① 输出**格式稳定** ② 领域**知识/语料**有量 ③ prompt 已经很长。**只是改语气、加示例、限制行为** → 优先 prompt 工程 + few-shot，便宜快。

## 我的记法

- **三阶段**：PT → SFT → 偏好对齐（RLHF 或 DPO）
- **SFT 学格式 + 知识**；**RLHF/DPO 学"啥更好"**
- **RLHF 复杂**（4 个模型 + RL 不稳）；**DPO 简单**（2 个模型 + 监督 loss）
- 当下默认：**SFT + DPO**，RLHF 留给大型项目
- 数据：**高质量 > 大量**，**chat template 必须对齐**
- 一句话：**「DPO 是 RLHF 的简化数学等价物，工程上 10 倍简单」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 trl 跑通过 SFT 和 DPO 的 demo 训练

## 参考资料
- [InstructGPT 论文（RLHF 经典）](https://arxiv.org/abs/2203.02155)
- [DPO 论文 (Rafailov et al., 2023)](https://arxiv.org/abs/2305.18290)
- [TRL 库文档](https://huggingface.co/docs/trl/)
- [RLHF / DPO 对比综述](https://huggingface.co/blog/dpo-trl)
