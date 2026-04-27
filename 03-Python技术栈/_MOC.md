---
tags: [MOC, Python方向]
priority: P1
---

# 03 · Python 技术栈 · 内容地图

> **定位**：LLM 应用侧（脚本、服务、异步、轻量服务框架）常选 Python。相对 Java 主栈，面试追问深度常不如后端八股，但**基础与异步踩坑**仍会被点穿。

---

## 关键考点（扁平，不再分子模块）

_待补清单_

### 语言核心
- GIL 到底锁了什么 / 对 AI 推理任务的实际影响
- 多进程 / asyncio / 多线程的选择矩阵
- 装饰器的执行时机
- 生成器 / 迭代器的区别
- `__slots__` / 元类 / 描述符用过吗

### 异步与并发
- asyncio 事件循环机制
- async 函数里调了同步 `requests.get()` 会发生什么
- 怎么发现和定位这种"隐形阻塞"
- Python 3.12 No-GIL（PEP 703）对 AI 应用的意义
- Sub-interpreters（PEP 684）的定位

### 工程与生态
- FastAPI 的核心价值（Pydantic + OpenAPI 自动生成）
- Celery / gevent 在异步任务与 I/O 密集服务中的常见用法
- Poetry / uv / pip 的选型
- Python vs Java：ORM / 泛型 / 错误处理 / 包管理的差异感

---

## 本模块动态视图

```dataview
TABLE file.mtime AS "最近更新", tags AS "标签"
FROM "03-Python技术栈"
WHERE contains(tags, "生疏") OR contains(tags, "未动")
SORT file.mtime ASC
```
