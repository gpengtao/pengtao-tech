---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/_MOC]]"
---

# Reflection 与 Self-Critique 模式

## 一句话速记

**Reflection = 让模型自己当评审**：第一次产出后，加一轮「批评/反思」prompt，把批评意见喂回去再产一次。**Reflexion**（带 x）则进一步把反思结果**写进长期记忆**，影响后续多轮甚至跨任务。本质是**用更多 token 换更高质量**，是 ReAct 之上最简单也最有效的提升模式。

## 通俗解释（5 分钟版）

**先问个问题**：为什么模型一次答不好？
- 自回归生成是「**一锤子买卖**」——一旦前面几个 token 走偏，后面会顺着错下去
- 模型没有「打草稿 → 检查 → 改」的内置机制
- 但是模型很会**评价**——你给它一段答案问「这答案有什么问题」，它经常能挑出毛病

**Reflection 就是把这俩拼起来**：
1. **Generator**：正常 prompt → 出一个初版答案
2. **Critic**：另一个 prompt（往往是同一个模型换个 system message）→ 找毛病、给建议
3. **Refiner**：把原 prompt + 初版答案 + 批评意见 一起喂进去 → 产出 v2
4. 可能再循环 1-N 次直到 critic 说 OK 或达到上限

```
   user query
       │
       ▼
   ┌───────┐    ┌───────┐    ┌──────────┐
   │ gen   │───▶│ critic│───▶│ refine   │──┐
   └───────┘    └───┬───┘    └──────────┘  │
                    │ OK                    │
                    ▼                       │
                  output ◄──────────────────┘
                                     loop until OK
```

**几个变体**：
- **Self-Critique / Self-Refine**：单 LLM 玩两个角色，prompt 切换
- **Reflexion**（论文，2023）：除了改答案，还把「这次失败的根因」存到一个 episodic memory，下次同类任务直接读出来当 hint
- **Constitutional AI**（Anthropic）：critic 用一组「宪法」原则做评价，多用于安全对齐
- **Tree-of-Thoughts + Reflection**：在搜索树上每个节点跑一遍 critic 决定是否 prune

**和 ReAct 怎么搭**：
- ReAct = 单步内的「思考-行动」循环
- Reflection = 单次回答完之后的「再思考一遍」
- 二者**不冲突**——典型组合是「ReAct 走完一次拿到答案 → reflection 检查 → 不对就回头重 ReAct」

**代价**：
- token 消耗 **2-5x**（gen + critic + refine）
- 延迟 **2-3x**（串行）
- 对**简单问题反而可能变差**（critic 没毛病可挑就硬挑）—— **不是任何场景都该上**

## 关键细节 / 数学直觉

### 1）Critic prompt 怎么写

差的 critic prompt：「检查上面答案有什么问题」——会给出泛泛之谈
好的 critic prompt：

```
你是一个严格的代码审查员。对下面这段代码：
1. 找 bug（空指针、并发、边界）
2. 找性能问题（O(n²) 当 O(n log n) 用？）
3. 找可读性问题（魔法数字、命名）

如果没问题，输出 "PASS"；否则输出 JSON：
{"issues": [{"severity": "...", "line": ..., "fix": "..."}]}
```

**关键点**：让 critic 有**结构化输出 + 显式 PASS 信号**，否则永远循环不了。

### 2）何时停（最容易踩的坑）

- ❌ 错误：固定循环 3 次。简单题浪费 token，难题不够。
- ✅ 推荐：critic 说 PASS 就停 + 兜底最大 3 轮 + 第 N 轮和第 N-1 轮答案太像就停（防 oscillation）

### 3）Reflexion 的「记忆」长啥样

不是把整段对话存下来——那太贵也没用。Reflexion 论文存的是**自然语言的反思总结**：

```
「上次我在这类题翻车的根因：把 'few-shot' 误当 'fine-tuning'。
下次看到 'in-context learning' 类的题先回忆这区别。」
```

下次同类任务前把这条文本 inject 到 system prompt。**本质就是把 RAG 的语料从「文档」换成「自我反思笔记」**。

### 4）Critic 同模型还是不同模型？

- **同模型**：便宜、好搭。但有「**自偏好**」——自己批自己经常嘴软
- **不同模型**（更弱模型批更强模型也成）：更客观，多家文献证明效果好
- **多模型 ensemble critic**：跑多次或多个模型投票，最贵但最准

**具身场景的合理选择**：critic 用更小更快的模型（甚至本地模型），refine 才回到主模型——能省成本。

## 延伸追问

- **Q：** Reflection 和 Plan-and-Execute、Tree-of-Thoughts 怎么协同？
  → Plan 是**任务级**拆解，ToT 是**搜索级**枚举，Reflection 是**质量级**校准。可以叠加：Plan → 每步 ReAct → 步后 Reflect。
- **Q：** Reflection 会不会"越改越糟"？
  → 会。叫 **drift / over-correction**。常见原因：critic 给了错误意见、模型怕被批又强行改。**对策**：保留 baseline，每轮都和 baseline 对比，劣化就回滚。
- **Q：** 在具身机器人上 Reflection 适合用在哪？
  → 适合「**任务规划阶段**」（生成 task graph 后让 critic 检查可达性、安全性）；**不适合**实时控制环（控制环延迟敏感，5Hz 都嫌慢）。
- **Q：** 怎么评价 Reflection 真的有用？
  → 拿一组 benchmark 题，分别跑「无 reflection / 有 reflection」，对比正确率/分数。注意控制 token 预算——可能加倍 token 直接 majority-vote 也能涨点。

## 我的记法

- **Reflection ≈ 写代码的 self-review**——每次提交前自己再看一遍
- **三角色**：Generator / Critic / Refiner（可能是同一个 LLM 换帽子）
- **Reflexion 多一个长期记忆**：失败原因写下来下次用
- **代价 2-5x token**——不是万灵药，简单题别上
- 一句话：**「**让模型既当作家又当编辑**」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 LangGraph 跑过一个 Reflection demo

## 参考资料
- [Reflexion 论文 (Shinn et al., 2023)](https://arxiv.org/abs/2303.11366)
- [Self-Refine 论文 (Madaan et al., 2023)](https://arxiv.org/abs/2303.17651)
- [LangGraph Reflection 教程](https://langchain-ai.github.io/langgraph/tutorials/reflection/reflection/)
