---
tags: [P0, 真盲区, AI方向, 生疏]
来源: 自己发起的基础补强（2026-04-24）
相关: [[RNN 是什么]] [[为什么 attention 要除以 √dk]] [[多头注意力为什么比单头好]]
---

# Transformer 是什么

> **前置知识**：如果你没理解 RNN，先读 [[RNN 是什么]]，回来再看这篇会顺很多。Transformer 的所有设计都是为了解决 RNN 的三个缺陷。

## 一句话速记
**Transformer 是 2017 年 Google 提出的神经网络架构，用 Self-Attention 替代 RNN 的顺序计算，一句话里所有词并行互看、各自决定关注谁——现在所有 LLM（GPT / Claude / LLaMA / Qwen）都是它的变种。**

## 通俗解释（5 分钟版）

### 它解决了什么
2017 年之前处理序列任务（翻译、理解一句话）主流是 RNN / LSTM。RNN 有三个致命伤：

1. **慢**：必须按顺序一个词一个词算，第 100 个词要等前 99 个算完
2. **远距离衰减**：开头的信息传到结尾基本没了（梯度消失）
3. **不能并行**：GPU 跑起来像单核

Transformer 一刀切掉三个问题：**放弃顺序处理，让一句话里所有词并行互看，每个词自己决定该关注谁**。这就是 **Self-Attention（自注意力）**。

### 类比（记住这个就够用）
秘书做会议纪要：
- **RNN 的秘书**：逐句听边听边记，听到第 20 句时第 1 句的细节已经忘了大半
- **Transformer 的秘书**：所有人的发言同时摊在桌上，整理第 5 句时可以直接去看第 1 句、第 3 句、第 20 句对它的影响，信息**永远等距离可达**

## 架构全景（画图模板）

```
输入 "我爱北京天安门"
    ↓
分词 Tokenize → [我, 爱, 北京, 天安门]
    ↓
Embedding 每个词变成一个向量（比如 512 维）
    ↓
+ Position Encoding（补回词序信息）
    ↓
┌─── Encoder 堆栈（N 层）───────────────────┐
│  每层两个子模块：                           │
│    1. Multi-Head Self-Attention            │
│    2. FFN（前馈网络）                       │
│  每个子模块外包 "残差连接 + LayerNorm"       │
└────────────────────────────────────────┘
    ↓
每个词的"上下文化向量"
    ↓
┌─── Decoder 堆栈（翻译/生成任务才有）────────┐
│  每层三个子模块：                           │
│    1. Masked Self-Attention                │
│    2. Cross-Attention（看 Encoder 输出）    │
│    3. FFN                                  │
└────────────────────────────────────────┘
    ↓
Linear + Softmax → 下一个词的概率分布
```

## 三个变种（现代 LLM 从这分叉）

| 变种 | 代表 | 常见用途 |
|---|---|---|
| **Encoder-only** | BERT / RoBERTa | 理解类（分类、抽取、检索、句向量） |
| **Decoder-only** | GPT / LLaMA / Qwen、Claude 等 | 自回归生成（对话、续写、代码、通用 LLM） |
| **Encoder-Decoder** | T5 / BART | 序列到序列（翻译、摘要、需显式两端的任务） |

## 核心组件逐个讲

### 1. Tokenizer（分词器）
把自然语言切成 token。现代 LLM 用 **BPE / WordPiece / SentencePiece** 子词级分词，"unhappiness" 会被切成 `un + happy + ness` 三段。

**为什么不是按字 / 按词**：按词词表太大且有 OOV（生僻词）问题；按字序列太长。子词是平衡。

### 2. Embedding
每个 token ID 查表变成一个 d 维向量（比如 d=4096 是 LLaMA-7B 的维度）。**这是"语义空间"里的坐标**，意思相近的词向量距离近。

### 3. Position Encoding
因为 Self-Attention 是并行对所有位置做的，**本身没有词序概念**（打乱输入输出一样）。必须显式把位置信息注入进去。几种做法：
- Sinusoidal（原版论文，固定值）
- Learned（学出来的）
- **RoPE（旋转位置编码）** —— 现代主流，LLaMA / Qwen / DeepSeek 都用

### 4. Self-Attention（核心）
每个词生成 3 个向量：**Query（我想问什么）、Key（我是谁）、Value（我能给什么）**。
- 用 Q 和所有人的 K 做点积得相似度分数
- softmax 归一化得权重
- 用权重去加权所有人的 V 求和，得到这个词的新表示

公式：`Attention(Q, K, V) = softmax(QK^T / √dk) · V`

为什么除以 √dk，见 [[为什么 attention 要除以 √dk]]。

### 5. Multi-Head（多头）
不做一次 Attention，做 h 次（比如 8 头 / 16 头），每头在不同的子空间学不同关系（一头抓语法、一头抓指代、一头抓情感……），最后拼起来。见 [[多头注意力为什么比单头好]]。

### 6. FFN（前馈网络）
对每个位置独立做 `Linear → 激活 → Linear`。
- 直觉：Attention 负责"跨位置信息流动"，FFN 负责"在每个位置内做非线性加工"
- LLaMA 这一代用 **SwiGLU** 激活取代 ReLU

### 7. 残差连接 + LayerNorm
每个子模块的输出是 `LayerNorm(x + Sublayer(x))`（Post-LN）或 `x + Sublayer(LayerNorm(x))`（Pre-LN）。
- **残差**：防止深层梯度消失
- **LayerNorm**：稳定每层的数值分布
- 没有这两样，几十上百层的深层 Transformer 训不起来

### 8. 自回归生成
Decoder-only 模型生成文本：
1. 给 prompt → 算出下一个 token 的概率分布
2. 采样一个 token（受 Temperature / Top-P 控制）
3. **拼到输入末尾**，重新走一遍，再生成下一个
4. 直到采到 EOS（end of sentence）或到 max_length

许多推理接口会把上述过程以 **SSE 等方式流式返回**，客户端即可「边生成边展示」。

## 延伸追问

- **Q：Transformer 为什么比 RNN 好？**
  答：并行化（一次算完所有位置）+ 远距离依赖（O(1) 路径长度，不衰减）+ 长上下文能力。见 [[Transformer 为什么比 RNN 快]]。

- **Q：Self-Attention 的复杂度？**
  答：**O(n² · d)**，n 是序列长度，d 是向量维度。这是 Transformer 的致命短板——为什么长文本窗口难做，vLLM / FlashAttention / Linear Attention 都在搞这个。

- **Q：BERT 和 GPT 的本质区别？**
  答：BERT 是 Encoder-only（双向注意力，每个词能看到全文），适合理解；GPT 是 Decoder-only（单向注意力 + Masked，每个词只能看左侧），适合生成。训练目标也不同：BERT 用 MLM（完形填空），GPT 用下一 token 预测。

- **Q：Decoder 里为什么有两种 Attention？**
  答：Masked Self-Attention 是 Decoder 内部的词自己之间互看（带 mask 防止看未来），Cross-Attention 是 Decoder 去看 Encoder 的输出（翻译场景：边生成目标语言边看源语言）。现代 Decoder-only LLM 只有 Masked Self-Attention，没有 Cross-Attention。

- **Q：现在的 LLM 为什么都是 Decoder-only 了？**
  答：
  1. 训练简单（一个目标：预测下一个 token）
  2. 规模化效果好（GPT 系的 Scaling Law 给了 Decoder-only 路线信心）
  3. 任务统一（翻译、摘要、分类都可以用"instruction + input → output"的生成范式表达）

## 我的记法
<!-- 关键术语 + 一句话定位 -->

TODO

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 在实际场景中用上过

## 时间线：RNN 到 Transformer，为什么不是更早出现

**不是「人想不到」，是条件和积木要凑齐。**

| 时间 | 事 |
|---|---|
| 1980s | 用循环结构处理序列、BPTT（随时间反向传播）等，让 **RNN 式模型可训练**。没有单一「RNN 发明日」。 |
| 约 1990 | 简单 RNN 在「序列 + 隐状态」上的表述在学界固定下来（如 Elman network 等常被引用作早期代表），详见 [[RNN 是什么]]。 |
| 1997 | **LSTM** 提出，专门缓解 RNN 长程梯度与遗忘问题。 |
| 2014 前后 | 神经机器翻译里 **LSTM/GRU 编解码** 成主流；**Bahdanau 等** 把 **注意力** 先用在源句–目标词「对齐」上，还不是整网 Self-Attention。 |
| 2017 | **Transformer**《Attention Is All You Need》—— **Self-Attention 为主体、去掉循环**。 |

**为什么 2017 之前很难直接上「全 attention、无 RNN」**：

1. **注意力是层层递进的**，要先在 seq2seq + RNN 上验证「对齐有用」，再抽象成「自注意力 + 可堆叠深度网络」，不是一步到位的灵感。
2. **算力与数据**：自注意力对序列长度是 **O(n²)** 量级；大模型、大批数据、GPU 集群没起来时，**既难训、也难放大**。
3. **深网络能训稳**：残差、LayerNorm、位置编码、大规模训练与正则等是 **2014～2017 年间在深度网络 + 注意力的路线上试出来的**。
4. **路径依赖**：工业界在 LSTM+注意力上投入大，**改 paradigm 有惯性**；Transformer 是站在已有工作之上的跳跃，不是真空发明。

**一句话总结**：RNN/ LSTM 从 80s～90s 就有、LSTM 1997；**Transformer 2017** 是「自注意力可并行 + 深堆叠能训 + 大算力大数据 + 前序注意力和深度网络经验」在一条时间轴上**凑齐**后的结果。

## 参考资料
- Attention Is All You Need (Vaswani et al., 2017)
- Jay Alammar, The Illustrated Transformer（强烈推荐先读这个）
- Andrej Karpathy, "Let's build GPT from scratch"（YouTube）—— 1.5h 从零手搓一遍印象最深
