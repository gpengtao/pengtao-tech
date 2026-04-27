---
tags: [P0, 真盲区, AI方向, 生疏]
来源: 知识库 MOC 第 6 题
相关: [[Decoder 的 Mask 为什么要下三角]] [[Transformer 是什么]]
---

# Self-Attention 与 Cross-Attention 的区别

## 一句话速记
**Self-Attention：Q、K、V 来自**同一**组 token 表示，建模「同一段里谁看谁」。Cross-Attention：Q 来自**一侧**（常见为 Decoder 当前状态），K、V 来自**另一侧**（常见为 Encoder 输出），建模「**查询序列** 对 **被读序列** 的对齐与抽取。」**

## 张量与语义

### Self-Attention
- 对长度为 n 的序列，设隐藏矩阵为 `X ∈ R^{n×d}`。
- 经投影得到 `Q, K, V`（行数均为 n，同一「槽位」一一对应）。
- 第 i 个 query 行与**整段**的 key 行做匹配，对**同一段**内所有位置做加权求和。  
- **用途**：**句内/段内**依赖、指代、长距共现等。

### Cross-Attention
- 设源序列（Encoder 侧）表示 `H ∈ R^{m×d}`，目标侧（Decoder）当前表示 `Y ∈ R^{n×d}`（长度可与 m 不同）。
- 常实现为：  
  `Q = Y W_Q`（n 行，来自**解码端**）  
  `K = H W_K`，`V = H W_V`（m 行，来自**编码端**）  
- 第 i 个**目标**位置去「**查询** m 个**源**位置，得到从源中汇集来的向量。  
- **用途**：**seq2seq**（翻译、摘要）里，生成目标中每个词时**对齐/聚焦**到源端哪些词；条件生成里也可理解为「**条件** 在 K/V 里，**状态** 在 Q 里」。

## 在标准 Transformer 里的位置

- **Encoder 栈**：**只有 Self-Attention**（双向、无因果 mask，除非用别的结构）。
- **Decoder 栈**（机器翻译等「原文 + 译文」同架论文结构）中通常**块内两块注意力**：
  1. **Masked Self-Attention**：当前译文 token 仅见**已生成**的译文，见 [[Decoder 的 Mask 为什么要下三角]]。
  2. **Cross-Attention**（有论文称 Encoder-Decoder Attention）：Q 为 Decoder 状态，K/V 为 **Encoder 对原文的输出**，使译文每步**显式**关注原文子串。

## Decoder-only 大语言模型（GPT 类）

- **没有** 独立的 Encoder 段、**没有** 论文里那种 **Cross-Attention** 层。  
- 仅含 **带因果 mask 的 Self-Attention** + FFN 堆叠。  
- 「看条件/知识」时，**条件也在同一自回归序列**里以 prompt 形式给出，**靠 Self-Attention 在段内**完成，不单独拆出 Cross-Attention 子层。

**一句话区分**：*「有 Encoder-Decoder 的翻译用 Cross；纯 GPT 只有 Causal Self-Attn。»*

## 延伸追问

- **Q：Cross-Attention 里 K 和 V 一定相同来源吗？**  
  答：通常 **K、V 同源**（同一组 Encoder 表示的两套投影），与 **Q 异源**；变体（perceiver 等）另说，常规考点到此为止。

- **Q：参数量上 Self 和 Cross 一样吗？**  
  答：**形式类似**（都是 QK^T 再 softmax 乘 V），但 **Q 侧序列长度 n** 与 **K/V 侧长度 m** 可不同，**注意力矩阵是 n×m**，与 Self 的 n×n 不同。

- **Q：图像 + 文字的多模态里 Cross-Attn 常见吗？**  
  答：常见——例如「文本为 Q、图像块为 K/V」的一种形式，思想仍是 **Q 与 K/V 异源 对齐**。

## 我的记法
TODO

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 在实际场景中用上过

## 参考资料
- Vaswani et al., 2017 §3.1 / Encoder-Decoder stacks
