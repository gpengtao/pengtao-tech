---
tags: [MOC, Python方向]
priority: P1
---

# 03 · Python 技术栈 · 内容地图

> **定位**：LLM 应用侧（脚本、服务、异步、轻量服务框架）常选 Python。相对 Java 主栈，考察深度常不如后端八股，但**基础与异步踩坑**仍会被点穿。

---

## 关键考点

### 语言核心
- [[语言核心/GIL 到底锁了什么]] #P0 #生疏 — GIL 锁什么 / 对 AI 推理的影响
- [[语言核心/多进程 asyncio 多线程的选择矩阵]] #P0 #生疏 — CPU/IO 密集 + LLM 服务选型
- [[语言核心/装饰器的执行时机]] #P1 #生疏 — import 时执行、带参装饰器、@wraps
- [[语言核心/生成器与迭代器的区别]] #P1 #生疏 — yield / 惰性求值 / LLM 流式输出
- [[语言核心/__slots__ 元类 描述符用过吗]] #P2 #生疏 — 内存优化 / ORM/Pydantic 元类 / @property 原理
- [[03-Python技术栈/语言核心/类型注解与Annotated|类型注解与 Annotated]] — Type Hints / Annotated 元数据 / 运行时校验
- [[03-Python技术栈/语言核心/Generic|Generic 泛型]] — typing.Generic / TypeVar / 泛型类定义
- [[03-Python技术栈/语言核心/强制关键字参数（keyword-only）|强制关键字参数（keyword-only）]] — `*` 分隔符 / 接口设计防误用

### 异步与并发
- [[异步与并发/asyncio 事件循环机制]] #P0 #生疏 — 就绪队列 + selector 轮询 / Task vs Future
- [[异步与并发/async 里调同步 requests 会发生什么]] #P0 #生疏 — 全局阻塞原因 / 三种修复方案
- [[异步与并发/怎么发现和定位隐形阻塞]] #P1 #生疏 — PYTHONASYNCIODEBUG / py-spy / 代码搜索
- [[异步与并发/Python 3.12 No-GIL 与 Sub-interpreters]] #P1 #生疏 — PEP 703 / 原子引用计数 / AI 场景影响

### 工程与生态
- [[工程与生态/FastAPI 的核心价值]] #P0 #生疏 — Pydantic 验证 / OpenAPI 自动文档 / DI / SSE 流式
- [[工程与生态/Celery 与 gevent 在异步任务中的用法]] #P1 #生疏 — 任务队列 / prefork vs gevent / AI 推理场景
- [[工程与生态/Poetry uv pip 的选型]] #P1 #生疏 — uv 极速 / Poetry 成熟 / lock 文件意义
- [[工程与生态/Python vs Java 差异感]] #P1 #生疏 — ORM / 泛型 / 异常 / 鸭子类型思维转变

### Python 工程化（LLM 应用向）
- [[03-Python技术栈/Python工程化/Python async 与 FastAPI 入门|Python async 与 FastAPI 入门]]
- [[03-Python技术栈/Python工程化/Pydantic 与类型提示在 LLM 应用里的用法|Pydantic 与类型提示在 LLM 应用里的用法]]
- [[03-Python技术栈/Python工程化/Python 项目结构与 uv-poetry-pip 选型|Python 项目结构与 uv / poetry / pip 选型]]

---

## 本模块动态视图

```dataview
TABLE file.mtime AS "最近更新", tags AS "标签"
FROM "03-Python技术栈"
WHERE contains(tags, "生疏") OR contains(tags, "未动")
SORT file.mtime ASC
```

---
