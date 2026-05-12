---
tags: [P1, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---
# Qwen-VL 与 LLaVA 的能力差异

## 一句话速记

**Qwen-VL = 阿里出品的开源多模态模型系列**（基于 Qwen LLM + 自家视觉 encoder），**中文/中文图像友好、文档/OCR 强、多分辨率支持好、商用 license 友好**；**LLaVA = 学术派开源 VLM 鼻祖**（基于 Llama + CLIP/SigLIP），**架构简单可改、社区生态全、是 VLM 研究的基线**。**简化对比**：要中文/产品落地选 Qwen-VL；要做研究/魔改/对比试验选 LLaVA；学习时**两个都要看**——LLaVA 学架构，Qwen-VL 看工程优化。

## 通俗解释（5 分钟版）

**两条不同的开源 VLM 路线**：

```
   ┌──────────────────────────────────────────────────────┐
   │  LLaVA 路线（学术，2023 起）                         │
   │  ─────────────────────────                           │
   │  Llama / Vicuna  +  CLIP-ViT (后改 SigLIP)           │
   │       ▲                  ▲                            │
   │       └─── 简单的 projector (MLP) 连接 ───┘          │
   │                                                        │
   │  核心理念：用最小架构验证"VLM 怎么能 work"            │
   │  典型版本：LLaVA-1.5 → LLaVA-1.6 → LLaVA-NeXT        │
   │  优势：架构清楚、社区多、可基线                        │
   │  劣势：基础模型 Llama 中文较弱、商用 license 受限     │
   └──────────────────────────────────────────────────────┘
   
   ┌──────────────────────────────────────────────────────┐
   │  Qwen-VL 路线（工业，2023 起）                        │
   │  ─────────────────────────                            │
   │  Qwen LLM  +  自研 ViT (高分辨率支持)                │
   │       ▲              ▲                                 │
   │       └── 专门设计的 cross-attention 桥接 ─┘          │
   │                                                         │
   │  核心理念：在 Qwen 中文 LLM 优势下做强中文/文档/UI VLM│
   │  典型版本：Qwen-VL → Qwen-VL-Chat → Qwen2-VL → Qwen2.5-VL│
   │  优势：中文/中英双语 / OCR / 文档表格 / 视频 / UI 截图│
   │  劣势：架构改动多、不如 LLaVA 简单清晰                 │
   └──────────────────────────────────────────────────────┘
```

**能力差异（实测大致）**：

| 能力 | LLaVA | Qwen-VL |
|---|---|---|
| 英文图像理解 | ✅ 强 | ✅ 强 |
| 中文图像理解 | 一般（Llama 中文能力弱） | ✅✅ 强（中文优势明显） |
| OCR / 文档 | 一般 | ✅✅ 强项 |
| 表格 / 图表 | 一般 | ✅ 强 |
| 高分辨率 | LLaVA-1.6 起改善 | ✅ 原生支持任意分辨率 |
| 视频 | 需要单独版本 | Qwen2-VL 原生支持视频 |
| UI 截图 / GUI 操作 | 一般 | ✅ Qwen2.5-VL 强（专门加 UI 数据） |
| 数学/代码图推理 | 中 | 中 |
| 模型尺寸 | 7B / 13B / 34B | 2B / 7B / 32B / 72B |
| 商用 license | Llama 2 受限 / Llama 3 商用宽松 | Qwen 系列商用宽松 |

## 关键细节 / 数学直觉

### 1）架构差异

**LLaVA 的"简洁版"**：

```
   image ──> CLIP/SigLIP ViT ──> patch tokens  (256 tokens)
                                       │
                                       ▼
                                ┌──────────┐
                                │  MLP     │  ← projector，把 visual dim 映射到 LLM dim
                                │  (2 layer│
                                └──────────┘
                                       │
                                       ▼
   text tokens ─┬───────────────► LLM (Llama)
                │
   (image tokens 拼在 text 前)
```

**优点**：MLP 只多 1-2M 参数，训得快；视觉 token 直接当 LLM token 用。

**缺点**：图像 patch 数固定（不容易支持任意分辨率）；视觉信息和文本 token 平等对待，可能干扰长文本生成。

**Qwen-VL 的设计**：

```
   image ──> 自家 ViT ──> patch tokens (动态数量, 高分辨率多)
                                  │
                                  ▼
                    ┌────────────────────────┐
                    │  Resampler / cross-attn │ ← 把视觉 token 压成固定数量
                    │  (Qwen-VL 用 query token │
                    │   通过 cross-attention)  │
                    └─────────────┬──────────┘
                                  │
                                  ▼ 256 个 visual query token
                    ┌────────────────────────┐
                    │      Qwen LLM           │
                    └────────────────────────┘
```

**优点**：能支持任意分辨率 + 视觉 token 数量可控；Qwen 的中文优势保留。

**缺点**：架构更复杂；resampler 是个"瓶颈"，可能丢细节。

Qwen2-VL 做了进一步改动（**Naive Dynamic Resolution + M-RoPE**）—— 任意分辨率 + 多模态 RoPE 编码（既区分文本、又区分图像 2D 位置）。

### 2）实战使用对比

**LLaVA 部署**（以 LLaVA-1.6 为例）：

```python
from transformers import LlavaNextProcessor, LlavaNextForConditionalGeneration
from PIL import Image

processor = LlavaNextProcessor.from_pretrained("llava-hf/llava-v1.6-mistral-7b-hf")
model = LlavaNextForConditionalGeneration.from_pretrained(...)

image = Image.open("cat.jpg")
prompt = "[INST] <image>\n这张图是什么？ [/INST]"
inputs = processor(prompt, image, return_tensors="pt")
output = model.generate(**inputs, max_new_tokens=200)
print(processor.decode(output[0]))
```

**Qwen-VL 部署**（以 Qwen2.5-VL 为例）：

```python
from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor

model = Qwen2_5_VLForConditionalGeneration.from_pretrained("Qwen/Qwen2.5-VL-7B-Instruct")
processor = AutoProcessor.from_pretrained("Qwen/Qwen2.5-VL-7B-Instruct")

messages = [{
    "role": "user",
    "content": [
        {"type": "image", "image": "cat.jpg"},
        {"type": "text", "text": "这张图是什么？"},
    ],
}]
text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
# ... generate
```

两者 SDK 都是 transformers + 各自 processor，**对外 API 像**。

### 3）视频/多图能力

- LLaVA 原版只支持单图；**LLaVA-Video / VideoLLaVA** 是衍生
- Qwen2-VL / Qwen2.5-VL **原生支持**多图、视频、OCR

视频处理本质是**采样关键帧 → 当多张图喂入**，背后还是 VLM。Qwen2-VL 在 token 层面支持时间编码（M-RoPE）效果更好。

### 4）选型决策

```
   场景                                     推荐
   ──────────────────────────────────────────────────
   中文产品（电商图、文档、海报）             Qwen-VL
   英文研究 / 论文 baseline                   LLaVA-NeXT
   OCR / 表格 / 文档抽取                      Qwen-VL
   视频理解                                    Qwen2-VL
   UI 自动化 / 网页 agent                     Qwen2.5-VL
   想魔改架构 / 加新模态                      LLaVA（更简单）
   超大模型 (70B+)                            LLaVA-1.6 / Qwen-VL-72B 都可
   边缘部署（小模型）                         Qwen2-VL-2B 或 LLaVA-7B+量化
```

### 5）和闭源大模型的差距

```
   能力维度          闭源 SOTA (GPT-4o / Claude)     开源 SOTA (Qwen2.5-VL-72B / LLaVA-NeXT)
   ──────────────────────────────────────────────────────────────────────
   一般图像问答         ★★★★★                            ★★★★ (差距小)
   复杂推理 / 数学      ★★★★★                            ★★★ (差距明显)
   OCR / 文档抽取       ★★★★                              ★★★★ (Qwen-VL 接近)
   GUI 截图 / 操作      ★★★★                              ★★★ (Qwen2.5-VL / Anthropic Computer Use 强)
   超长上下文图文       ★★★★ (Gemini 1M)                   ★★ (开源还在追)
```

**结论**：开源模型在常规 VLM 任务接近闭源；复杂推理、长上下文、Tool Use 还是闭源领先。

### 6）和具身的关系

具身机器人需要 VLM 做的事：
- **场景理解**："客厅里有几把椅子？沙发上有什么？"
- **任务推断**："桌上太乱，需要整理哪些物品？"
- **状态判断**："抓取是否成功？杯子是不是倒了？"
- **失败诊断**："为什么这一步没成功？"

中文环境下 **Qwen-VL 系**优先（特别是 OCR、家庭场景标签理解）；机器人本机部署 **小尺寸 (2B-7B) + 量化** 是务实选择。

## 延伸追问

- **Q：** VLM 是不是越大越好？
  → 一般是，但**边际效益递减**。常规视觉任务上 7B 和 70B 差距没你想的大；**复杂推理 / 长 context** 大模型优势明显。**端侧部署优先 2-7B 量化**。
- **Q：** 现在还推荐用 LLaVA 还是直接 Qwen-VL？
  → 产品落地中文场景：**Qwen-VL 优先**。学习/研究：**先看 LLaVA 架构**理解原理，再看 Qwen-VL 学工程优化。
- **Q：** 训练自己的 VLM 难度多大？
  → 高。① 数据：图文对齐数据要清洗 ② 多阶段训练（pretrain + SFT + visual instruction tuning）③ 分布式训练大显存 ④ 评测要 multimodal benchmark 全面跑。**新手不建议**——直接 finetune 一个开源 VLM 即可。
- **Q：** VLM 部署有什么额外的坑？
  → ① **图像预处理**（resize、归一化）必须和训练时一致 ② vLLM/SGLang 对 VLM 的支持比纯 LLM 晚一些，要看版本 ③ image token 多 → KV cache 显存占用大；高分辨率图模型要小心 OOM ④ 多模态 streaming 协议各家不同。

## 我的记法

- **LLaVA = 学术派**（Llama + CLIP，简单清晰）
- **Qwen-VL = 工业派**（Qwen + 任意分辨率 ViT，**中文/OCR 强**）
- 选型口诀：**中文产品用 Qwen，研究魔改用 LLaVA**
- VLM 在具身里：**做规划层 + 状态判断**，不直接出动作（那是 VLA 的事）
- 一句话：**「Qwen-VL = ChatGPT 多模态版的中文开源平替；LLaVA = 学多模态架构的入门标杆」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 Qwen-VL 或 LLaVA 跑过一张图问答的 demo

## 参考资料
- [LLaVA 论文 (Liu et al., 2023)](https://arxiv.org/abs/2304.08485)
- [Qwen-VL 论文](https://arxiv.org/abs/2308.12966)
- [Qwen2-VL 技术报告](https://arxiv.org/abs/2409.12191)
- [LLaVA GitHub](https://github.com/haotian-liu/LLaVA)
- [Qwen-VL GitHub](https://github.com/QwenLM/Qwen-VL)
