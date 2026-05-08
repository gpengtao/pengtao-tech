---
tags: [P1, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/_MOC]]"
---

# OpenVLA 与 π0 与 RDT-1B 是什么

## 一句话速记

**当前主流的三个开源 VLA 模型，代表三种动作生成范式**：① **OpenVLA**（Stanford 等，2024）= **离散动作 token + autoregressive**——Llama 2 + visual encoder，把动作离散化当 token 预测，开源 + 数据公开是其最大价值；② **π0**（Physical Intelligence，2024）= **flow-matching 生成连续动作 chunk**——更适合精细操控；③ **RDT-1B**（清华，2024）= **Diffusion Transformer 生成动作**——用扩散模型做机器人控制，国内最受关注的开源方案。三者都基于 VLM 做"看图 + 听指令 → 出动作"，差别在**动作 head 的设计**。

## 通俗解释（5 分钟版）

**先把三家放在一张表上**：

| 模型 | 出品 | 时间 | 主干 | 动作生成 | 参数量 | 数据 | 开源 |
|---|---|---|---|---|---|---|---|
| **OpenVLA** | Stanford / Berkeley / TRI / Google | 2024.06 | Llama-2 7B + DinoV2/SigLIP | 离散动作 token (autoregressive) | 7B | OpenX-Embodiment | ✅（权重 + 代码） |
| **π0** | Physical Intelligence | 2024.10 | PaliGemma 3B + flow matching head | 连续动作 chunk via flow matching | ~3B | 自家专属 + OpenX | 部分（推理代码 + ckpt） |
| **RDT-1B** | THU + 大象 | 2024.10 | T5 + DiT-style | 扩散模型预测动作序列 | 1.2B | OpenX + 自家 | ✅（权重 + 代码） |

### 三种"出动作"的范式

```
   ① OpenVLA — Discrete Action Tokens (autoregressive)
   ────────────────────────────────────────────
   image+task ──→ Transformer ──→ token_1, token_2, ..., token_7
                                   ↓ de-tokenize
                       [Δx, Δy, Δz, dRoll, dPitch, dYaw, gripper]
                       
   每个动作维度离散化为 256 bin，用 token 表示
   优点：和 LLM 训练范式一致，可以 leverage VLM 预训练
   缺点：256 bin 精度有限；autoregressive 一步一步出
   
   ② π0 — Flow Matching (continuous action chunk)
   ────────────────────────────────────────────
   image+task+noise ──→ Vision-Language backbone ──→ "Action Expert"
                                                         ↓
                                   连续动作向量 [a_0, a_1, ..., a_H]
                                   一次出 H 步动作（chunk）
                                   
   底子是 flow matching：从噪声到目标动作的连续变换
   优点：连续动作（精度高）+ 一次出多步（高频控制）
   缺点：架构更复杂；训练采样分布要设计
   
   ③ RDT-1B — Diffusion Transformer
   ────────────────────────────────────────────
   image+task+noise ──→ DiT ──> 多步 denoise
                                   ↓
                              连续动作序列
   
   类似 Stable Diffusion 的逻辑用在动作上
   优点：扩散模型表达力强、多模态分布拟合好（同一指令多种动作可能性）
   缺点：推理需要多步去噪，慢
```

### 三者对比的工程视角

```
┌─────────────────┬──────────┬────────┬────────┐
│                 │ OpenVLA  │   π0   │ RDT-1B │
├─────────────────┼──────────┼────────┼────────┤
│ 推理速度        │ 中       │ 快     │ 慢(多步去噪)│
│ 动作精度        │ 中(离散) │ 高     │ 高     │
│ 控制频率        │ 5-10 Hz  │ 50 Hz  │ 取决去噪步│
│ 上手难度        │ 低       │ 中     │ 中     │
│ 开源完备度      │ ✅✅     │ ⚠️     │ ✅     │
│ 中文社区资料    │ 中       │ 少     │ ✅     │
│ 数据透明        │ 完全开放 │ 私有为主│ 部分公开│
└─────────────────┴──────────┴────────┴────────┘
```

## 关键细节 / 数学直觉

### 1）OpenVLA 的动作 token 化

```python
# 把连续动作离散化
action_dim = 7  # x, y, z, roll, pitch, yaw, gripper
n_bins = 256

def discretize(action):
    # 每个维度独立离散到 [0, 255]
    return [int((a - a_min) / (a_max - a_min) * 255) for a in action]

def tokenize(discretized):
    # 占用 LLM vocab 的 256 个保留 token
    return [VOCAB_OFFSET + i for i in discretized]

# 推理：LLM autoregressive 生成 7 个 action token，de-tokenize 得动作
```

**关键**：用了 Llama 2 vocab 中 256 个**频率最低**的 token 当 action token——这样不破坏 LLM 已有的语言能力。

### 2）π0 的 flow matching 直觉

Flow matching 是一类**生成模型**，思路：

```
   t=0: 标准高斯噪声      t=1: 真实动作 chunk
        ε ────────────流场 v(x,t)───────────► a*

   训练目标：学习这个流场 v(x,t)
   推理：从 ε 出发，沿着流场走到 a*
```

类比 diffusion 但**只需要一次或几次推理步**——所以 π0 推理速度快。π0 的核心是把 VLM 后面挂个 "action expert" 模块，专门学 robot action 的流场。

### 3）RDT-1B 的扩散

经典扩散：

```
   forward:  a* + noise → ... → 纯噪声
   reverse:  纯噪声 ← ... ← 学 denoise → a*
   
   推理需要 N 步 denoise（N=10-50）
   每步：predict noise → 去掉一点
```

RDT 把 transformer 做 noise predictor，并加入图像/语言 condition。1.2B 是当前**最大**的开源机器人扩散模型。

### 4）数据：所有人的瓶颈

三家都依赖 **Open X-Embodiment**（OXE）—— 集合 22 家机构、22 种机器人、500+ 个 dataset、~2M episode 的最大开源机器人数据集。

```
   不同机器人有不同的 action space：
       某 7-DoF 机械臂用 [x,y,z,r,p,y,gripper]
       双臂人形用 [arm_l(7), arm_r(7), torso(3), head(3)]
       
   OXE 做了"action 标准化"，让单一模型能学多种机器人
   但有些任务（精细装配）数据**仍然稀缺**
```

数据稀缺 → 模型再聪明也学不会；这是当前 VLA 通用性的最大限制。

### 5）和 RT-2（Google）的关系

RT-2（Google 2023）是**奠基性**的 VLA 论文，引入"动作当 token"的范式。但 **RT-2 不开源**（数据 + 模型都闭）。**OpenVLA 就是想做开源版的 RT-2**——后来训出来效果直接超过 RT-2 在公开任务上（因为 OXE 数据规模更大）。

```
   RT-1 (2022) ──> RT-2 (2023, VLM+VLA) ──> OpenVLA / π0 / RDT (2024, 开源)
       专业           闭源大力出奇迹              开源追赶
```

### 6）实际部署的现实

```
   场景                     推荐
   ─────────────────────────────────────────────
   学习 VLA / 跑 demo       OpenVLA（资料最全）
   想做精细操作研究          π0（连续动作精度高）
   国内场景 / 中文资料       RDT-1B
   产品级真机部署           三者都还**不够稳**
                            产品多用 VLM 规划 + 经典控制
   端侧低算力               都不太行（要量化 + 蒸馏）
```

**重要的现实**：当前所有开源 VLA 的成功率**都不高**——简单家务任务 60-80%，复杂操作 < 30%。**离"接电就能干"还远**。但作为研究/原型，比早期完全没有 VLA 大幅进步。

## 延伸追问

- **Q：** OpenVLA 跟 OpenAI 的 GPT 系列有什么关系？
  → **完全没有关系**。OpenVLA 是 Stanford 等机构的开源 VLA 项目，名字带 Open 表"开源"，跟 OpenAI 一点关系都没有。
- **Q：** 想自己 finetune 一个 VLA 在自己机器人上，怎么做？
  → ① 采集自己机器人的 (image, task_instruction, action) 数据（远程操控或 kinesthetic teaching） ② 标准化 action space ③ 在开源 VLA 基础上 LoRA finetune（OpenVLA 给了完整 fine-tune 脚本）④ 仿真器先验证再上真机。
- **Q：** VLA 模型的 action chunk 是什么？
  → 一次推理预测**未来 H 步动作**（如 H=8）。优点：① 减少推理频次 ② 动作之间有时序一致性 ③ 提高有效控制频率（推理 1Hz × chunk 8 = 8Hz 控制）。π0 / RDT 都用 chunk。
- **Q：** 这三家的论文我应该先读哪个？
  → **OpenVLA**：架构清晰、和 LLM 训练相似、读起来最像 NLP 经验的延伸；之后再读 π0 理解 flow matching；RDT 当扩散模型应用读。

## 我的记法

- **OpenVLA = 离散 token autoregressive**（VLM 的延伸）—— 最易上手
- **π0 = flow matching**（连续动作 chunk + 高频控制）—— 精度+速度
- **RDT-1B = diffusion transformer**（扩散模型做动作）—— 国内开源
- 三家都基于 VLM 做"图+指令 → 动作"，**差别在动作 head**
- 产品级别都还不稳——**当前主流仍是 VLM 规划 + 经典控制**
- 一句话：**「OpenVLA 是 VLA 的 Llama，π0 / RDT 是它的两条改进路线」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 在仿真里跑过一次 OpenVLA 推理（哪怕 huggingface demo）

## 参考资料
- [OpenVLA 论文 + 代码](https://openvla.github.io/)
- [π0 论文 (Physical Intelligence)](https://arxiv.org/abs/2410.24164)
- [RDT-1B 项目主页](https://rdt-robotics.github.io/rdt-robotics/)
- [Open X-Embodiment 数据集](https://robotics-transformer-x.github.io/)
- [RT-2 (奠基论文)](https://arxiv.org/abs/2307.15818)
