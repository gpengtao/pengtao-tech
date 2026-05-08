---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/_MOC]]"
---

# MCP 协议是什么 与 dify_plugin 的关系

## 一句话速记

**MCP（Model Context Protocol）= Anthropic 主推的"LLM 工具/资源/提示"通用协议**——把"模型如何接到外部世界"标准化成 client/server 模型，server 暴露 **Tools / Resources / Prompts** 三种能力，传输用 stdio 或 HTTP+SSE。**dify_plugin = Dify 平台自己的插件机制**，干的事情非常类似（也暴露工具/数据/能力），但**绑定 Dify 平台**。两者是「**平台特定插件协议** vs **跨平台开放协议**」的关系，定位类似 「Chrome Extension API vs Web Components」。

## 通俗解释（5 分钟版）

**MCP 出现的背景**：
- 每家厂商都有自己的「工具/插件」机制——OpenAI Plugins（已下线）、Dify plugin、扣子 plugin、字节豆包 plugin、Claude Project……
- 同一个工具（比如「Google Drive 搜索」），开发者要为每家平台**重新写一遍适配**
- Anthropic 2024 年 11 月开源 MCP，**就是想做工具集成的 USB-C**

**MCP 的世界观**：把 AI 应用拆成两边——

```
   ┌──────────────┐       JSON-RPC       ┌──────────────┐
   │  MCP Client  │◄─────over───────────▶│  MCP Server  │
   │  (LLM 应用)   │  stdio / HTTP+SSE    │ (能力提供方) │
   └──────────────┘                       └──────────────┘
   Claude Desktop                          GitHub server
   Cursor                                  Filesystem server
   你的 LangGraph                          你的业务系统
```

**Server 暴露三类能力**（这是 MCP 最关键的抽象）：

| 类型 | 含义 | 类比 |
|---|---|---|
| **Tools** | 模型可调用的函数（带副作用） | RPC 接口 |
| **Resources** | 模型可读取的数据（只读、可订阅变化） | REST GET / 数据源 |
| **Prompts** | 预定义的 prompt 模板 + 变量 | 模板代码片段 |

`Resources` 是 MCP 比 Function Calling 多出来的设计——很多场景**不是要"调用"，是要"喂数据"**（比如让 Agent 读你电脑上某个文件夹的内容）。Function Calling 把所有东西塞成 tool 调用，MCP 把"读"和"写"分开。

**和 Function Calling 的关系**：
- Function Calling 是**模型供应商层面的接口**（OpenAI/Anthropic 的 API 字段）
- MCP 是**应用-能力供应商之间的协议**（你怎么把工具打包对外提供）
- 一个 MCP server 暴露的 tools，Client 端可以**翻译成 OpenAI Function Calling 格式**喂给模型；模型输出的 `tool_calls` 又被 Client 翻译成 MCP 调用

```
   user        LLM API           MCP Client          MCP Server
    │            │                   │                    │
    │──问──▶ Function Calling ──▶ tool_calls ─MCP-call──▶ │
    │            │                   │                    │
    │            ◄──── tool result ◄─MCP-result─────────  │
```

### MCP vs dify_plugin 横向对比

| 维度 | MCP | dify_plugin |
|---|---|---|
| 出品 | Anthropic 牵头开源 | Dify 平台 |
| 协议 | JSON-RPC over stdio/HTTP+SSE | Dify 内部约定（Python entry + manifest） |
| 跨平台 | ✅（Claude Desktop/Cursor/任何 client） | ❌（只能 Dify 用） |
| 能力类型 | Tools / Resources / Prompts | Tools / Models / Endpoints / Agent strategies（更细） |
| 部署形态 | 独立进程（stdio）或独立服务（HTTP） | 插件市场上传 / 本地开发 |
| 权限/安全 | 协议层面提示用户授权 | 平台层面统一管理 |
| 调试体验 | MCP Inspector 工具调试 | Dify UI 实时调试 |

**关键认知**：
- **dify_plugin 不是过时**——它解决的是「**Dify 平台用户怎么扩展平台能力**」的问题，平台型产品本就该有自己的插件
- **MCP 不是替代品**——它解决的是「**任意 LLM 应用怎么共享同一份能力**」的问题
- **未来很可能并存**：dify_plugin 内部可以"包"一个 MCP client，把社区 MCP server 直接当作 Dify 工具用——**最佳路径是兼容**

## 关键细节 / 数学直觉

### 1）MCP 最小 Server 例子（Python）

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("weather-server")

@mcp.tool()
def get_weather(city: str) -> str:
    """查询某城市当前天气"""
    return f"{city}: 10°C, sunny"

@mcp.resource("file://docs/{filename}")
def read_doc(filename: str) -> str:
    """读取本地 docs 目录下的文档"""
    return open(f"./docs/{filename}").read()

@mcp.prompt()
def code_review(code: str) -> str:
    """生成 code review prompt"""
    return f"请审查以下代码:\n{code}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

跑起来后 Claude Desktop / Cursor 配置一行就能接入。

### 2）三种 Transport 选哪个

| Transport | 适用 | 注意 |
|---|---|---|
| `stdio` | 本地工具（filesystem、git、本机命令） | 安全（同机），最常见 |
| `HTTP + SSE` | 远程服务（数据库、SaaS、共享服务） | 要做 auth、注意 CORS、SSE 长连接 |
| WebSocket | 双向实时 | 用得不多，多数场景 SSE 够 |

**HTTP+SSE** 在 2025 年逐渐被 **Streamable HTTP** 取代（一个 endpoint，stateless+streaming），新写代码看官方最新文档。

### 3）Tools / Resources 的语义边界

- **Tools**：有副作用，调用要用户/Agent 显式同意（"我要执行 send_email"）
- **Resources**：只读、可订阅，相对安全（"我读了 ./README.md"）

很多场景纠结"用 tool 还是 resource"，**经验**：
- 「触发一个动作」→ tool
- 「拿一份数据 + 后续可能变更要知道」→ resource
- 不确定就先 tool（因为绝大多数客户端对 tool 支持最完善）

### 4）安全模型（这块经常被忽略）

MCP 协议层面把 **「approval gate」** 留给 client 实现——也就是说"是不是真的执行这个 tool 调用"由 Claude Desktop / Cursor / 你自研客户端决定弹窗确认。

**生产 Agent 接 MCP 务必**：
- 工具白名单（不是所有 server 都能用所有 tool）
- 工具调用日志全留（debug + 审计 + 合规）
- 高危工具（删除文件、转账、发邮件）走 HITL
- Server 端做认证（HTTP 加 Bearer token；stdio 控制能起 server 进程的人）

### 5）和具身机器人的接点

机器人本体往往跑在边缘设备（NUC / Jetson / 国产芯片），上层规划 Agent 跑在云上。MCP 天然适合这种分层：
- 机器人 Skill 库 = MCP Server（暴露 `move_to`、`grab` 等 tool）
- 云端规划 Agent = MCP Client
- 协议跨网，认证、限流、速率控制都是工程要解决的

但现实是：**机器人对实时性要求高**（每个动作 <100ms 延迟），MCP HTTP+SSE 多一跳序列化未必合适——可能要用更紧凑的本地 IPC + MCP 概念，或者直接 LangGraph 内嵌工具节点。

## 延伸追问

- **Q：** MCP 比 OpenAI 老 plugin 强在哪？
  → ① 不绑定单家模型供应商 ② 多了 Resources/Prompts 抽象 ③ 协议开源、社区共建生态 ④ 本地 stdio 模式让 IDE 集成体验好。
- **Q：** Resource 和 RAG 的关系？
  → Resource 是"被动数据源"（client 显式 fetch）；RAG 是"主动检索"（应用层做 query embed → search）。MCP 不替代 RAG，但**MCP server 可以暴露一个 search tool 把 RAG 包进去**——很多团队就是这么做。
- **Q：** dify_plugin 会不会被 MCP 完全替代？
  → 短期不会。dify_plugin 跟 Dify 平台的运营、计费、灰度强绑定，迁出来对平台是损失。**长期方向**是「dify_plugin 内置 MCP client，把社区资源拉进来」**而不是迁移**。
- **Q：** MCP 在生产级 Agent 系统的位置应该怎么放？
  → 建议把 MCP 当作**「工具层的标准化层」**：你的业务工具（DB、内部 API、Skill）封装成 MCP Server；上层 Agent 框架（LangGraph）用 MCP Client 加载。这样**换 LLM 框架不影响工具，换工具不影响 Agent 流程**。

## 我的记法

- MCP = **LLM 工具的 USB-C**，开放协议
- 三种能力：**Tools（写）/ Resources（读）/ Prompts（模板）**
- 三种 transport：**stdio（本机）/ HTTP+SSE（远程）/ WebSocket**
- 和 Function Calling：**MCP 是协议层，Function Calling 是模型 API 层**——可以共存
- 和 dify_plugin：**dify_plugin 是平台插件，MCP 是跨平台协议**——平台插件可以包装 MCP
- 一句话：**「dify_plugin 是平台护城河，MCP 是社区共识，两者是互补不是替代」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 Python SDK 写过一个 MCP server hello world

## 参考资料
- [Model Context Protocol 官网](https://modelcontextprotocol.io/)
- [MCP 规范文档](https://spec.modelcontextprotocol.io/)
- [Anthropic 介绍 MCP 博客](https://www.anthropic.com/news/model-context-protocol)
- [Dify Plugin 开发文档](https://docs.dify.ai/plugins) — 对照学习
