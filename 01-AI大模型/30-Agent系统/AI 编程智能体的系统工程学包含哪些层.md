---
tags: [P1, AI方向, 未动]
来源: 知识库 · Agent 系统
相关: "[[Agent 的基本抽象是什么]] [[ReAct 的核心思想是什么]] [[Agent 的记忆如何分层]]"
---
# AI 编程智能体的系统工程学包含哪些层

## 一句话速记
**把 LLM 这个「概率大脑」包进一层「确定性工程外壳」里**，让它可控、安全、可复用地干活——这层外壳就是 **agent harness / 运行时**，七个子系统按职责可归成四层：**上下文层 / 控制层 / 能力与安全层 / 记忆层**。

## 为什么需要这层外壳
LLM 本身是个无状态的概率函数：单轮补全即可跑，但一旦要「多步改代码、调工具、读规范、跑测试」，纯靠模型自己就会失控——乱删文件、连不该连的网、忘记前面的约束。所以真正的 AI 编程产品（Claude Code、Cursor、Cline……）的壁垒不在模型，而在**模型外围那一圈工程脚手架**。这圈脚手架决定了「同一个模型，为什么 A 产品好用、B 产品乱来」。

## 四层分解

| 你的关注点 | 所属层 | 术语 | 在 Claude Code 里的实体 |
|---|---|---|---|
| 上下文编排（system/developer/user/tool result 怎么组织） | 上下文层 | context engineering / prompt assembly | system prompt + 工具结果回灌格式 |
| 状态机（Plan/Default/Review/Debug 模式切换） | 控制层 | agent loop / mode orchestration | plan mode + 各 skill 切换 |
| 反馈闭环（工具结果反哺下一步决策） | 控制层 | tool-use loop / ReAct loop | tool-use 循环 |
| 工具治理（哪些能用/不能用） | 能力层 | tool gating / capability scoping | 工具集定义 |
| 权限控制（读写、联网、危险命令拦截） | 安全层 | permission system / guardrails | `settings.json` permissions + hooks |
| 工作流约束（先读规范→改代码→测试→总结） | 流程层 | SOP / policy enforcement | `CLAUDE.md` + hooks 强制流程 |
| 记忆与压缩（长任务保留关键上下文） | 记忆层 | memory + context compaction | `MEMORY.md` + 自动 compaction |

## 逐层要点

### 1. 上下文层（context engineering）
回答「在**对的时刻**把**对的上下文**塞给模型」。包括：system prompt（人设与硬约束）、developer message（平台指令）、user message、tool result 的拼接顺序与格式、token 预算分配、prompt cache 命中率。这是当前业界最热的提效杠杆——**不是写更长 prompt，而是更精准地喂上下文**。

### 2. 控制层（agent loop + mode orchestration）
两件事：**循环**和**模式切换**。
- **循环**：ReAct 式的「思考→调工具→看结果→再思考」，工具结果如何反哺下一步决策是核心。
- **模式**：Plan（只读、出方案）/ Default（正常读写）/ Review（只评审不改）/ Debug（聚焦排障）。模式切换本质是**临时替换行为约束**，而不是换模型。

### 3. 能力与安全层
- **工具治理**：决定「这个 agent 能看见哪些工具」。能力越大责任越大——只给当前任务真正需要的工具，是降失控的第一道闸。
- **权限控制**：读写文件、联网、执行命令这三类是高危面，危险命令（`rm -rf`、强推、删库）要拦。常见手段：allow/deny list、危险命令二次确认、沙箱执行。

### 4. 流程层 + 记忆层
- **流程层**：把「先读规范、再改代码、再测试、最后总结」这类 SOP 落成**可强制的约束**，而不是靠模型自觉。Claude Code 里靠 `CLAUDE.md`（软约束，进上下文）+ hooks（硬约束，框架执行）双管齐下。
- **记忆层**：长任务里上下文会爆，靠**压缩**（summary）和**外部记忆**（`MEMORY.md` 一行索引 + 单独文件存事实）保留关键信息，让 agent「记得住」而不是「全塞进窗口」。

## 和相邻概念划界

| 概念 | 关注点 |
|------|--------|
| **Context Engineering** | 偏「喂什么」——覆盖上下文层、流程层、记忆层 |
| **Agent Harness / Runtime** | 偏「外围脚手架」——覆盖控制层、能力与安全层、反馈闭环 |
| **Prompt Engineering** | 只管「单次输入怎么写」，是上下文层的子集 |

三者合起来就是本文的七点。**Context Engineering 管「输入侧」，Harness 管「执行侧」**，拼成一个完整 agent。

## 延伸追问

- **Q：模型够强了，harness 还重要吗？**  
  答：更重要。模型越强，单次输出的破坏力越大（一句 `rm -rf` 就能删库），harness 的**安全层**和**流程层**是唯一兜底。能力上移不等于约束可省。

- **Q：CLAUDE.md 和 hooks 有什么区别？**  
  答：CLAUDE.md 是**软约束**——写进上下文，模型「应该」遵守但可能不遵守；hooks 是**硬约束**——框架在固定生命周期点执行代码，模型绕不过。要确保一定发生的事（如改完跑测试），用 hooks。

- **Q：状态机为什么不算「换模型」？**  
  答：Plan/Default/Review/Debug 切的是**行为模式**（能不能改文件、要不要先出方案），底层仍是同一个模型。换模式 = 换约束集，不是换大脑。

## 我的记法
四层 + 七点：**上下文（喂什么）/ 控制（怎么循环、切模式）/ 能力安全（给什么工具、拦什么命令）/ 记忆（长任务记得住）**。一句话定位：**概率大脑 + 确定性外壳 = 可用 agent**。

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 在实际场景中用上过

## 参考资料
- Claude Code 官方文档（hooks、permissions、memory、plan mode）的设计归纳。
- 工业界对 context engineering 与 agent runtime 的讨论，无单一必读书。