---
tags: [P1, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---
# VLM 与 VLA 的区别

## 一句话速记

**VLM (Vision-Language Model) = "看图说话"模型**——输入图像+文本，输出文本（描述、问答、推理）。GPT-4V、Claude、LLaVA、Qwen-VL 都是 VLM。**VLA (Vision-Language-Action Model) = "看图听指令做动作"模型**——输入图像+文本指令，**输出动作 token（关节角/末端位姿/夹爪状态）**。VLA 把"动作"当成另一种 token，让 LLM 直接生成机器人控制信号。**简化记忆**：VLM 的 output 是给人看的文字，VLA 的 output 是给电机执行的数字。

## 通俗解释（5 分钟版）

**先看二者的输入/输出对照**：

```
   ┌─────────────────────────────────────────────────────┐
   │                       VLM                            │
   │                                                       │
   │   image     ┌────────────┐                          │
   │   ─────────▶│            │                          │
   │             │ Vision     │ ──▶ output: 文本          │
   │   text      │ encoder +  │     "图中是只猫"         │
   │   ─────────▶│ LLM        │                          │
   │             └────────────┘                          │
   └─────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────┐
   │                       VLA                            │
   │                                                       │
   │   image     ┌────────────┐                          │
   │   ─────────▶│            │                          │
   │             │ Vision     │ ──▶ output: action token  │
   │   text      │ encoder +  │     [Δx, Δy, Δz, gripper]│
   │   (指令)    │ LLM +      │     翻译成关节命令        │
   │   ─────────▶│ Action head│     ──▶ 电机             │
   │             └────────────┘                          │
   └─────────────────────────────────────────────────────┘
```

**关键差别**：

| 维度 | VLM | VLA |
|---|---|---|
| 输出类型 | 自然语言 | 动作（连续/离散数值） |
| 输出频率 | 一次 / 每秒 | **5-50 Hz**（控制频率） |
| 训练数据 | 图文对（互联网海量） | **机器人动作数据**（极稀缺） |
| 推理延迟约束 | 几秒可接受 | **<100ms 严苛** |
| 应用 | 图像理解、多模态 chat | 机器人操控 |
| 代表模型 | GPT-4V / Qwen-VL / LLaVA | OpenVLA / π0 / RDT-1B / RT-2 |

### VLM 的工作方式（基础）

```
   image ──→ ViT/SigLIP encoder ──→ image patches (token)
                                          │
                                          ▼
   text ──→ tokenizer ──→ text tokens ──→ [image tokens, text tokens]
                                          │
                                          ▼
                                  ┌──────────────┐
                                  │  Transformer  │
                                  │  (LLM 主体)   │
                                  └──────┬───────┘
                                          │
                                          ▼
                                   text tokens（输出）
```

**核心点**：image 通过 encoder（ViT 或 SigLIP）变成 patch token，**和 text token 拼一起**进同一个 transformer。LLM 把图像 patch 当作"特殊 token"对待。

### VLA 的工作方式（在 VLM 基础上做"动作 token 化"）

VLA 最常见的实现思路（如 RT-2、OpenVLA）：

```
   image + 指令 ──→ VLM 主体 ──→ 生成 action token
                                       │
                                       ▼ (de-tokenize)
                              [Δx, Δy, Δz, dRoll, ..., gripper]
                              连续动作向量
                                       │
                                       ▼
                              发给机器人控制器
```

**怎么把动作变成 token**：
- 把每个动作维度（如末端 x 位移）**离散化成 256 个 bin**
- 给每个 bin 分配一个 token id（如 把 vocab 的 256 个低频 token 占用）
- 模型输出这些 token → de-tokenize → 连续动作

**所以 VLA 在架构上 ≈ "VLM + 把 action 当 token 一起训"**——这就是 RT-2 的核心思想。后来的 π0、RDT-1B 在 action head 上有创新（不再纯 token 化，用 flow matching / diffusion），但底子还是"图文进，动作出"。

### 为什么 VLA 是个独立类别

如果只是"VLM + 几行控制代码"，为啥要分类？因为：

1. **数据完全不同**：VLM 用互联网图文，VLA 用专门采集的"图像-动作"数据（远程操控、动作示教）—— **量级差几个数量级**
2. **频率要求**：VLA 要 10-50 Hz 出指令，**推理优化必须做**——不是简单 LLM batch infer
3. **失败代价高**：VLM 答错"那是杯子"没事；VLA 错动作可能撞坏东西/伤人
4. **学术社区不同**：VLM 看 NLP/CV 顶会，VLA 看 RSS / CoRL / ICRA

## 关键细节 / 数学直觉

### 1）Visual encoder 的两条路

```
   ① CLIP-ViT（早期主流）：
      ViT + 对比学习预训练（图文对齐）
      输入 224x224 → 输出 16x16=256 个 patch token
      
   ② SigLIP（当前主流）：
      sigmoid loss + 更大数据 + 更高分辨率
      像 LLaVA-1.6、Qwen-VL 都换 SigLIP，效果好
      
   ③ 任意分辨率 + 多尺度：
      模型支持任意分辨率 → 高分辨率图 → token 暴增
      要做 token compression（如 LLaVA-NeXT 做 patch sub-sampling）
```

### 2）VLA 的离散化挑战

```
   一个动作维度（如 Δx 位移）∈ [-0.05m, +0.05m]
   离散化 256 bin：[每 bin 0.0004m]
   → 控制精度 0.4mm
   
   但这种精度对精细任务（穿针、拧螺丝）可能不够
```

**对策**：
- 增加 bin 数（消耗 vocab）
- 用 **continuous head**（直接回归连续值，不离散化）—— π0 和 RDT 这么做
- **action chunk**：一次预测未来 N 步（4-16 步），减少推理次数提高有效频率

### 3）VLA 推理的频率怎么撑

```
   假设 VLM 在 GPU 上 token decode 速度 = 50 tokens/s
   一个 action chunk = 8 步 × 7 维 = 56 tokens
   一次推理 ~ 1.1 秒 → 等同于 0.9 Hz "指令更新频率"
   
   但 8 步动作可以用 50 Hz 执行 ── 所以"控制频率" 50 Hz 但"指令更新频率" 0.9 Hz
   
   ──> 实战是 高频低层控制 + 低频高层规划 的组合
```

### 4）VLA 模型谱大致

| 模型 | 出品 | 参数量 | 特色 |
|---|---|---|---|
| **RT-1** (2022) | Google | ~35M | 早期 transformer 机器人控制 |
| **RT-2** (2023) | Google | 5B/55B | 把 VLM 和动作 token 共训，提出 VLA 概念 |
| **OpenVLA** (2024) | Stanford 等 | 7B | 开源版 RT-2，Llama 2 + 动作 token |
| **π0** (2024) | Physical Intelligence | 3B | flow matching policy，连续动作 |
| **RDT-1B** (2024) | 清华 | 1B | Diffusion Transformer，开源 |
| **GR-1 / GR-2** | 国内 | -- | 国产开源 VLA |

### 5）数据稀缺是 VLA 最大瓶颈

VLM：互联网海量图文（数十亿规模）
VLA：要"图像 + 动作"对齐数据 —— 必须**真机采集**（远程操控、kinesthetic teaching）或**仿真生成**

最大开源 VLA 数据集 **Open X-Embodiment**：约 1M+ 个 episode（仍远小于 VLM 训练数据）。

**所以 VLA 模型一般都很"小"**（1-7B），训练上靠 VLM 预训练初始化 + 少量动作数据 finetune。

### 6）VLM 在具身里也独立有用

不一定要 VLA——很多具身系统用 **VLM 做规划层 + 经典控制器做执行层**：

```
   VLM ──"指令理解 + 场景描述 + 任务拆解"
            │
            ▼ 输出文本/JSON 任务序列
   skill executor (传统控制 / behavior tree)
            │
            ▼ 关节命令
        机器人
```

这种叫 **"两脑分工"** 架构（也叫"系统 1 / 系统 2"）—— VLM 慢但聪明做规划，专用控制器快做执行。**比端到端 VLA 工程上更稳，是当前产品级落地主流**。

## 延伸追问

- **Q：** VLM 和 LLM 的区别是不是只多一个 visual encoder？
  → 大致对。但还有：① 训练数据要图文对齐 ② 训练 loss 设计要兼顾两个模态 ③ 推理时图像 token 比文本 token 多得多——影响 KV cache 和 context 长度。
- **Q：** VLA 和 RL 训练的策略网络有啥不一样？
  → ① VLA 主要靠**模仿学习**（IL），用人类示范学；强化学习（RL）也用，但环境奖励难定义 ② VLA 用 LLM 主干，能用语言指令泛化，比 RL 的 task-specific 网络通用很多 ③ VLA 推理代价更高。
- **Q：** 端到端 VLA 会不会取代"VLM + 控制器"分层架构？
  → 学术大热，工程未必。**端到端**：泛化好但难调试、难安全审计；**分层**：好控好查，但要工程师写 skill。**短期**分层架构在产品上仍占优；**长期**端到端 VLA 在数据足够后会逼近。
- **Q：** 部署 VLM/VLA 在边缘设备上的难点？
  → 推理速度（边缘 GPU 算力有限）+ 显存（VLA 模型 7B+ 加视觉 encoder 不小）。常用方案：量化（INT4）+ 蒸馏（小模型）+ ONNX/TensorRT 加速。

## 我的记法

- **VLM = 看图说话**（输出文本）
- **VLA = 看图做动作**（输出 action token）
- VLA 实现 ≈ **VLM + action token 离散化 + 动作数据 finetune**
- VLA 数据稀缺、要高频推理、失败代价高 → 工程门槛远高于 VLM
- 产品落地常见架构：**VLM 规划 + 经典控制执行**（端到端 VLA 还在快速发展）
- 一句话：**「VLM 是 ChatGPT 的眼睛，VLA 是机器人的大脑+脊髓」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 跑过一次 VLM demo（Qwen-VL 或 LLaVA）

## 参考资料
- [RT-2 论文（VLA 概念奠基）](https://arxiv.org/abs/2307.15818)
- [OpenVLA 论文](https://arxiv.org/abs/2406.09246)
- [π0 论文（Physical Intelligence）](https://arxiv.org/abs/2410.24164)
- [Open X-Embodiment 数据集](https://robotics-transformer-x.github.io/)
