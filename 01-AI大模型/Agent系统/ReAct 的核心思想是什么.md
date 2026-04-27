---
tags: [P0, 真盲区, AI方向, 生疏]
来源: 知识库 · Agent 系统
相关: [[Agent 的基本抽象是什么]] [[Planning 类 Agent 有哪些模式]]
---

# ReAct 的核心思想是什么

## 一句话速记
**ReAct = Reasoning + Acting：在生成中交替输出「推理语言（思考）」与「对外动作（如调工具）」，把环境返回的观察写回提示，再推理下一步；用**外反馈**把单纯 CoT 和真实环境闭环起来。**

论文常用引用：**ReAct: Synergizing Reasoning and Acting in Language Models**（Yao et al., 2022）。

## 在干什么

- **Reasoning 轨迹**：以自然语言写出中间判断（`Thought: ...`），可视为可解释的**链式思考**，但**不是终点**。  
- **Action**：在定义好的**动作空间**里选**工具名 + 参数**（如 `search("query")`、`finish(...)`），形式依实现。  
- **Observation**：环境或工具**真实返回**，进入下一轮 prompt（不是模型编造的续写）。  
- 多轮交替直到 **终停动作** 或**步数上限**。

**与纯 CoT 的区别**：纯 CoT 的「下一步信息」在**同一段自回归里虚构延续**；ReAct 的**关键信息**在**环境真实 Observation** 里，减少幻觉、可**核查**。

## 伪结构（示意，非某框架唯一格式）

```text
Thought: 先确认用户要查的实体。
Action: search["某某 官方 API 文档"]
Observation: 返回摘要与链接…
Thought: 根据结果需要读具体方法。
Action: visit["https://..."]
Observation: 页面内容…
Thought: 信息足够，可作答。
Action: answer["……"]
```

## 典型追问准备

- **停条件**：`finish` / `answer`、重复检测、步数/ token 截断。  
- **坏观测**：重试、换工具、把错误信写回让模型**修正计划**（与「规划-再执行」可组合）。

## 延伸追问

- **Q：ReAct 和 self-ask 或分解式 CoT 区别？**  
  答：后两者多在**同一段**生成里展开；ReAct 强调**动作离开模型**、**观测再回来**，是**开环+闭环**交替。

- **Q：为什么有时 Thought 和 Action 分两条消息？**  
  答：训练与**解析**方便（有的做监督微调专门预测 `Action:` 行）；**推理上**可合并，工程取舍。

- **Q：和 Planning 先写计划再一步步走谁更稳？**  
  答：ReAct 更**局部、灵活、适合探索型环境**；**先全计划**在**可分解且环境稳定**时更省步数；**见 [[Planning 类 Agent 有哪些模式]]**。

## 我的记法
TODO

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问

## 参考资料
- Yao et al., 2022, *ReAct: Synergizing Reasoning and Acting in Language Models*
