---
tags: [P1, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: [[_专题-具身Agent/_MOC]]
---

# AgentBench-GAIA-WebArena 是什么

## 一句话速记

这三个是 **学术界主流的 LLM Agent 公开评测集**，各自考一个角度：**AgentBench**（清华，2023）= "8 个环境的多面手测试"，看 Agent 在多种任务下的综合能力；**GAIA**（Meta + HuggingFace，2023）= "复杂日常任务真实问题集"，每题需要 1-30 步推理 + 工具，考 **真实场景的多步能力**；**WebArena**（CMU，2023）= "可复现的 Web 浏览基准"，把 Agent 放进**离线运行的真实网站副本**做电商/论坛任务，考**网页操作能力**。SWE-bench 是另一个常见的"代码 Agent"基准（修真实 GitHub issue）。

## 通俗解释（5 分钟版）

**为什么需要这些 benchmark**：
- 模型/Agent 在自家 dataset 上跑分都很高，**没法横向比较**
- "GPT-4 vs Claude 谁更擅长 Agent"，需要**第三方公开题库**
- 学术发论文要在 standard benchmark 上跑——这些就是 standard

**横向对比**：

| Benchmark | 出品 | 题量 | 任务类型 | 难度 | 评分方式 |
|---|---|---|---|---|---|
| **AgentBench** | THU + Stanford 等 | 1.6K 题 / 8 环境 | OS / DB / KG / Web / Card Game / Lateral Thinking / House-holding / Web Browsing | 中 | 任务成功率 |
| **GAIA** | Meta AI / HF | 466 题 / 3 难度级 | 多步推理 + 工具组合 | 高 | 准确率（精确匹配） |
| **WebArena** | CMU | 812 题 | 真实网站任务（电商、论坛、CMS） | 高 | 任务完成率 |
| **VisualWebArena** | CMU | + 视觉 | 多模态网站任务 | 高 | 同上 |
| **SWE-bench** | Princeton | 2294 个 GitHub issue | 修代码 bug | 高 | 测试通过率 |

### AgentBench（综合多面手考试）

**8 个 environment，每个测一个能力维度**：

```
   ┌──────────────────────────────────────────────────┐
   │  AgentBench 8 环境                                │
   ├──────────────────────────────────────────────────┤
   │  1. Operating System  - 命令行任务                │
   │  2. DataBase          - SQL 查询                  │
   │  3. Knowledge Graph   - 在 KG 上推理              │
   │  4. Card Game         - 玩 Aquawar 卡牌           │
   │  5. Lateral Thinking  - 横向思维谜题              │
   │  6. House-holding     - 家务任务（ALFWorld 风）  │
   │  7. Web Shopping      - 电商购物                  │
   │  8. Web Browsing      - Mind2Web 风网页操作      │
   └──────────────────────────────────────────────────┘
   
   评分：每个环境算成功率 → 8 个分数 → 综合分
```

**典型用法**：研究新框架时跑 AgentBench 看综合能力是否提升；产品场景**只跑相关环境**（做电商 Agent 只看 Web Shopping）。

### GAIA（真实日常任务，3 个难度级）

**特点**：每题需要"**搜信息 + 看图 + 算数学 + 推理**"组合起来才能答对。

样例题：
```
Level 1: "比较 https://example.com/page 中 X 和 Y 两组数据，哪个更大？"
       → 一次工具调用 + 简单提取
       
Level 2: "在 wiki 找出 A 演员的所有主演电影，按上映年份排序，第三部的导演是谁？"
       → 多步搜索 + 信息提取 + 排序
       
Level 3: "结合一段视频内容 + 网页信息 + 一份 Excel，算出最终答案"
       → 多模态 + 多工具 + 多步推理
```

**评分**：精确匹配（exact match）—— 答案是否完全等于 ground truth。

**GAIA 的特点**：
- **"人简单 AI 难"**：人类 Level 1 92% / Level 3 47%；2024 年 SOTA Agent Level 1 ~65% / Level 3 ~10%
- 是当下**Agent 能力的"阶梯式标尺"**——简单 Agent 框架做完 Level 1，要做 Level 3 系统升级很大
- HuggingFace 维护 leaderboard，很多 Agent 框架（OpenAI Swarm、Anthropic、HF Agents）都来跑

### WebArena（可控的真实网页任务）

**最大问题它解决了**：早期网页 Agent benchmark 都跑真互联网，结果**网站随时改 → 无法复现**。WebArena 把 4 个真实网站**拷一份完整副本**离线 docker 部署：

```
   ┌────────────────────────────────────────────────┐
   │  WebArena 离线网站                              │
   ├────────────────────────────────────────────────┤
   │  - OneStopShop（电商，magento 改）            │
   │  - GitLab                                      │
   │  - Reddit-like 论坛                            │
   │  - Map（OpenStreetMap）                        │
   │  + Wikipedia + 一些 Tools                       │
   └────────────────────────────────────────────────┘

   Agent 任务示例：
   - "在论坛上找 Python 板块最热门的帖，引用最多评论的作者"
   - "在电商搜笔记本，按销量排序，看第 3 个商品的评分"
   
   评分：检查最终页面状态 / 数据库变更（精确）
```

**意义**：可复现 + 真实网页复杂度 + 评测客观。是当前 Web Agent 的金标准。变体：**VisualWebArena**（加视觉）、**WebVoyager**、**Mind2Web**。

### 用 benchmark 的两种姿势

```
   ① 学术姿势：发论文必跑，比较 SOTA
       - 完整跑全部题
       - 严格 zero-shot / few-shot 协议
       - 报告 + 标准差
   
   ② 工程姿势：选择性参考
       - 自己产品做电商 Agent → 重点看 WebArena 上各家 Agent 表现
       - 自己产品做综合 Agent → 看 GAIA 谁强
       - 不必全跑——你自己的业务 dataset 才是终审判官
```

## 关键细节 / 数学直觉

### 1）SOTA 数据（2024-2025 年大致）

| benchmark | SOTA 大致 | 哪类系统 |
|---|---|---|
| AgentBench 综合 | ~50-60 分 | GPT-4o + 优化框架 |
| GAIA Level 1 | ~75% | Anthropic Claude / GPT-4o + 工具组合 |
| GAIA Level 3 | ~25-40% | 复杂 Agent 框架 |
| WebArena | ~30-50% | 视觉 Agent 提升明显 |
| SWE-bench Verified | ~50-60% | Anthropic SWE-agent / Cognition Devin |

数字可能很快过时，**重点看相对排名和趋势**而非绝对数。

### 2）跑 benchmark 的工程要点

```python
# 跑 GAIA 的最简流程（伪代码）
import datasets
gaia = datasets.load_dataset("gaia-benchmark/GAIA", "2023_level1")

correct = 0
for example in gaia["validation"]:
    answer = my_agent.run(example["Question"])
    if exact_match(answer, example["Final answer"]):
        correct += 1

print(f"accuracy: {correct / len(gaia['validation']):.2%}")
```

**踩坑**：
- 不同 benchmark **不允许调用某些工具**（比如 GAIA 禁止访问 ground truth 来源）
- 评测时要**关掉所有 cache**——你不希望 cache hit 让分数虚高
- 要严格用 benchmark 提供的 metric 计算逻辑，不要自己实现（容易算错）

### 3）和自家业务 eval set 的关系

| 维度 | 公开 benchmark | 业务 dataset |
|---|---|---|
| 目的 | 横向比较 / 论文 | 产品质量保证 |
| 数据 | 通用 / 学术 | 你的真实用户 |
| 量 | 几百-几千 | 几十-几千 |
| 真值 | 严格 ground truth | 经常含糊 |
| 用法 | 选型参考 | regression / 上线决策 |

**业务最重要的还是自家 dataset**——benchmark 选型时参考即可。

### 4）具身 / Robot agent 的 benchmark 进度

- **VLABench**（VLA 模型基准，2024）—— 评估 VLA 在多种操作任务的成功率
- **CALVIN** —— 长程语言条件操作任务（语言 → 机器人多步动作）
- **RoboCasa**：仿真厨房，让 robot agent 完成家务
- **Open X-Embodiment**：跨多机器人 / 跨平台数据集（侧重数据，benchmark 在配套）
- **BEHAVIOR-1K**（斯坦福）：1000 个家务任务的物理仿真

公开 benchmark 比 LLM 体系晚 1-2 年成熟，但大体方向类似：仿真环境 + 任务集 + 标准评分。

### 5）公开 benchmark 的常见误用

- ❌ **过拟合 benchmark**——为跑高分不停调 prompt，业务实际不 work
- ❌ **挑剔题目**——只报跑高的子集，不报跑低的
- ❌ **不公平比对**——baseline 用旧版本，自家用最新工具增强
- ❌ **不跑标准 setup**——加了 RAG 或工具但 benchmark 协议不允许

学术上这些会被审稿打回；工程上要**自己警觉**：你优化了 benchmark 但业务没变好 = 优化错了方向。

### 6）从 benchmark 到产品的正确逻辑

```
   公开 benchmark    →    自己业务的 mini benchmark    →    生产
   ─────────────────────────────────────────────────────────────
   选型时参考         构建自己的 evaluation set       上线 + 监控
   "GPT-4 哪强"      "我的电商客服怎么样"           "用户体验"
```

## 延伸追问

- **Q：** 我做 Agent 框架，需要全面跑这些 benchmark 吗？
  → 不必。**选 1-2 个跟你产品最像的**——做 web agent 跑 WebArena；做通用 Agent 跑 GAIA；做代码 agent 跑 SWE-bench。**自家业务 dataset 优先**。
- **Q：** GPT-4 跑 GAIA 也不到 50%，是不是不够格？
  → 这就是评测的意义——告诉你**真实世界复杂任务远远没解决**。模型再强，多步规划 + 工具 + 多模态错误会复合。这也是为什么 Agent 框架（LangGraph 等）有价值。
- **Q：** WebArena 跟实际网页 agent 部署有什么不同？
  → 离线副本（不变）vs 真实互联网（每天变）；离线评测分数仅供参考。**真上线后**还要做 ① 用户反馈 ② 失败案例归因 ③ 灰度 + AB。
- **Q：** 我是工程岗，看这些 benchmark 论文有用吗？
  → 有用——不是看分数，**是看每个 SOTA 系统的"怎么做到的"**：哪些 prompt 技巧、哪些工具组合、哪些反思模式。这些可以直接迁移到你产品。

## 我的记法

- **AgentBench = 综合考试 8 环境**
- **GAIA = 真实日常多步任务 3 难度级**
- **WebArena = 可复现的网页 Agent 基准**
- **SWE-bench = 代码修 bug benchmark**
- **VLABench / CALVIN = 具身领域**
- **业务 dataset 优先于公开 benchmark**——前者是审判官，后者是参考
- 一句话：**「公开 benchmark 是地图，自家 eval set 是导航」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 datasets 库下载过其中一个题集看过样例

## 参考资料
- [AgentBench 论文](https://arxiv.org/abs/2308.03688)
- [GAIA 论文 + Leaderboard](https://huggingface.co/gaia-benchmark)
- [WebArena 项目](https://webarena.dev/)
- [SWE-bench](https://www.swebench.com/)
