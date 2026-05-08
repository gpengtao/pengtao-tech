---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---
# Mem0 与 MemGPT 长期记忆思路

## 一句话速记

**Agent 长期记忆 = 把对话历史从"全量塞进 context"变成"按需检索 + 重要性排序 + 自动遗忘"**。**MemGPT** 借操作系统类比——把 LLM context 看作 RAM，外存当 disk，模型自己用 tool 读写 disk；**Mem0** 是更工程化的产品/库——分层存（user/session/agent），抽取关键事实自动存到向量库，每次对话前自动检索注入。本质都是 **RAG 的语料从"知识库"换成"自我历史"**。

## 通俗解释（5 分钟版）

**为什么 Agent 需要"记忆"**：
- 单轮对话：用户输入 → context → 输出。无所谓记忆
- 多轮对话：把所有历史塞 context → token 越用越多 → 越来越贵越来越慢
- 跨会话：用户昨天说"我对花生过敏"，今天问"推荐午餐"，模型不记得 = 体验崩
- Agent 任务：跨任务复用经验（"上次同样任务我用方法 A 失败，这次试方法 B"）—— Reflexion 类思路

**记忆的分层**（业界共识）：

| 层 | 周期 | 内容 | 实现 |
|---|---|---|---|
| Working memory | 当前 step | 当前 prompt + 上一步 observation | LLM context |
| Short-term | 当前会话 | 本次对话的所有消息 | message list（可压缩） |
| Long-term | 跨会话 | 用户偏好、关键事实、过往经验 | **向量库 + 元数据** |
| Episodic | 跨任务 | "什么任务用什么方法成功/失败" | 反思笔记，可向量索引 |
| Semantic | 全局 | 通用知识、规则、本体 | 知识图谱 / RAG |

**两个代表方案**：

### MemGPT（学术派）

> MemGPT (2023, UC Berkeley) — "MemGPT: Towards LLMs as Operating Systems"

把 LLM 当成一个"OS"，**让模型自己管自己的内存**：

```
   ┌─────────────────────────────────────────────────────┐
   │  Main Context (RAM, ~32K)                            │
   │  ┌───────────────────────────────────────────────┐  │
   │  │ system / persona / functions                   │  │
   │  ├───────────────────────────────────────────────┤  │
   │  │ working context（当前对话）                    │  │
   │  ├───────────────────────────────────────────────┤  │
   │  │ recall buffer（最近 N 条，FIFO）              │  │
   │  └───────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────┘
   ┌─────────────────────────────────────────────────────┐
   │  External Context (Disk)                              │
   │  - archival_memory_storage  (可检索的长期记忆)       │
   │  - recall_storage           (历史完整对话归档)       │
   └─────────────────────────────────────────────────────┘

   模型暴露的 tool：
   - core_memory_replace / append   （改 system 段记忆）
   - archival_memory_insert / search （写/查长期记忆）
   - conversation_search             （查历史对话）
```

**核心思想**：context 满了不是 truncate，而是让 LLM **自己决定**「这段历史重要吗？要不要写进 archival_memory？」**模型主动管理记忆**。

### Mem0（工程派）

> Mem0 = 一个开源 SDK / SaaS，把"记忆"做成产品级原语

**没那么"OS"——更像"智能聊天会自动记住的中间件"**。核心动作三步：

```
   user: "我对花生过敏"
        │
        ▼  ① extract — LLM 从消息抽事实
   ┌──────────────────────────────────────────────┐
   │  抽取: "user 有花生过敏"                      │
   │  分类: preference / health                    │
   └──────────────────────────────────────────────┘
        │
        ▼  ② store — 存向量库 + 元数据
   ┌──────────────────────────────────────────────┐
   │  vector_db: embedding + {user_id, type}      │
   │  + 去重/合并已有相关 memory                   │
   └──────────────────────────────────────────────┘

   下次对话:
   user: "推荐个午餐"
        │
        ▼  ③ retrieve — 自动注入相关 memory
   ┌──────────────────────────────────────────────┐
   │  search by user_id + similar to "午餐"       │
   │  → "user 有花生过敏"                         │
   │  → 注入到 system prompt: "用户有花生过敏..." │
   └──────────────────────────────────────────────┘
```

**API 心智模型**：

```python
from mem0 import Memory
m = Memory()

m.add("我对花生过敏", user_id="alice")
m.add("我喜欢辣的", user_id="alice")

results = m.search(query="推荐个午餐", user_id="alice")
# → 返回相关 memory 列表，应用注入 prompt 即可
```

支持多层级：`user_id` / `agent_id` / `session_id`，能区分"用户级记忆"和"任务级记忆"。

## 关键细节 / 数学直觉

### 1）记忆抽取的 prompt 模板

```
你是一个事实抽取器。从下面对话中提取与用户长期相关的事实。

规则：
- 只抽取**未来对话仍有用**的（个人偏好、过敏、家庭信息、目标）
- **不要**抽取「天气、当前时间」类瞬时信息
- 输出 JSON: [{"fact":"...", "category":"..."}]

对话：
{conversation}
```

抽取过滤是关键——**不过滤会把瞬时信息当长期记忆，下次对话被错误注入**。

### 2）记忆冲突 / 更新

用户上周说"我吃素"，今天说"我开始吃肉了"——记忆库里有两条冲突的 memory，怎么办？

Mem0 的做法：**抽取后做"冲突检测 + 更新"**——找到现有相关 memory，让 LLM 判断新事实是 add / update / delete，然后改库。

**坑**：完全交给 LLM 判断会出错——务必加人工/规则兜底（重要类别如健康过敏不允许自动 delete，要 confirm）。

### 3）retrieval 的"双层检索"

直接 query → vector search 经常不够好：
- query "我午饭吃什么" → 不一定能找到"花生过敏" memory（语义不那么近）

**双层**：
1. 先用 LLM 把 query 改写 + 扩展（生成相关查询：饮食偏好、过敏、口味）
2. 多次向量检索 + 去重
3. 给 LLM 拼 top-K 注入

### 4）成本控制

记忆方案的成本陷阱：
- 每轮对话都跑 extract + retrieve + LLM 判断 = **每轮多 2-3 次 LLM 调用**
- 用户多了之后向量库巨大，查询变慢
- 记忆永久不清理 → 库无限膨胀

**对策**：
- extract 用更小的模型（gpt-4o-mini / Haiku 足够）
- 抽取频率不必每轮（每 3-5 轮汇总一次）
- 给 memory 加 TTL + 重要性分（低分老 memory 定期清）

### 5）记忆和 RAG 的边界

| 维度 | 业务知识 RAG | 记忆 |
|---|---|---|
| 语料来源 | 文档、网页、内部 wiki | 用户对话、Agent 经验 |
| 写入时机 | 离线 ETL | 在线，每轮可能更新 |
| 隔离粒度 | 共享 / 多租户 | 严格按 user_id 隔离 |
| 时效性 | 月-年 | 分钟-永久（看类别） |
| 安全侧重 | 防注入 | 防泄漏（A 用户数据不能给 B） |

很多团队把这俩**混着用同一个向量库 + 不同 namespace**——可以，但要 access control 严。

### 6）具身场景的记忆形态

机器人的"记忆"不止是对话历史，还包括：
- **场景记忆**：哪个房间什么物品、地图、家具排布
- **任务记忆**：上次叠衣服失败在哪一步
- **用户偏好**：主人喜欢被叫"陈先生"还是"老陈"
- **多模态记忆**：图像 + 描述 一起存（e.g. "客厅沙发左边的杯子"）

工程上这块刚起步，主流思路：MemGPT/Mem0 类抽取层 + 向量库（多模态 embedding 如 BGE-VL）+ 知识图谱（场景图 SceneGraph）。

## 延伸追问

- **Q：** 长 context（200K）出现后还需要长期记忆吗？
  → 需要。① 200K 也填得满，且**越长越贵** ② 长 context 的"中间忽略"问题（lost in the middle）依然存在 ③ 跨会话/跨用户的隔离、权限、审计**只能靠记忆系统**做。但**短期记忆+长 context 大幅减负是事实**。
- **Q：** Mem0 vs MemGPT 实战哪个落地更顺？
  → **Mem0** 大多场景更顺——更简单、SDK 完善、可以无缝接 LangChain/LangGraph。**MemGPT** 概念美但实现重，对模型主动管理记忆要求高，工程稳定性需要养。
- **Q：** Agent 记忆隐私怎么做？
  → ① 严格 user_id 隔离 ② 抽取层加 PII 检测 + redact（手机号、身份证脱敏）③ 用户能查能删（GDPR forget）④ 记忆同步要走加密通道。
- **Q：** 怎么评估记忆系统的好坏？
  → ① 召回率：上轮提到的事实在下次相关查询里能不能被检索到 ② 注入精度：不要把无关记忆塞进 prompt 干扰模型 ③ 节省 token：相比"全量喂历史"省了多少 ④ 用户感知：长期对话下用户感觉模型"记得我"还是"健忘"。

## 我的记法

- 记忆 = **RAG 的语料从"知识"换成"自我历史"**
- 分层：working / short-term / long-term / episodic / semantic
- 两派：MemGPT（OS 类比，模型自管）/ Mem0（工程化，自动 extract + retrieve）
- 三个动作：**extract（抽事实）→ store（存向量库）→ retrieve（注入 prompt）**
- 长 context 不能完全替代记忆——**隔离、权限、成本** 三大原因
- 一句话：**「Agent 没记忆 ≈ 鱼的 7 秒记忆」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 Mem0 SDK 跑过 hello world

## 参考资料
- [Mem0 官方文档](https://docs.mem0.ai/)
- [MemGPT 论文 (Packer et al., 2023)](https://arxiv.org/abs/2310.08560)
- [LangGraph Memory 概念](https://langchain-ai.github.io/langgraph/concepts/memory/)
