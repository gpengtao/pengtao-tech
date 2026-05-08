---
tags: [P1, Python方向, 生疏]
相关: "[[03-Python技术栈/index]]"
---
# Celery / gevent 在异步任务与 I/O 密集服务中的常见用法

## 一句话速记

**Celery** = 分布式任务队列，把耗时任务（AI 推理、邮件发送、批量处理）异步化，通过 Redis/RabbitMQ 作 broker，默认多进程 Worker 执行（CPU 密集友好）；**gevent** = 协程库，通过 monkey-patch 把同步 Python 代码（requests、psycopg2）变成非阻塞协程，让 Flask/Django 服务不改代码就支持高并发（I/O 密集友好）。两者定位不同：Celery 管理**任务调度**，gevent 改变**I/O 执行模型**。

## 关键细节

### 1）Celery 核心概念

```
组件：
  Broker（消息中间件）：Redis / RabbitMQ
    - 存放任务队列（task queue）
    - Producer（Web 应用）把任务推进来
    - Consumer（Worker）从队列取任务执行
  
  Worker：执行任务的进程
    - 默认：prefork（每个任务一个进程，CPU 密集型）
    - 可选：gevent/eventlet（每个任务一个协程，I/O 密集型）
    - 可选：solo（单线程，调试用）
  
  Result Backend（结果存储）：Redis / 数据库
    - 存放任务执行结果（可选）
    - 主程序通过 task.get() 查询结果
```

### 2）Celery 典型用法

```python
# tasks.py
from celery import Celery
import time

app = Celery(
    "myapp",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1"
)

# 定义任务
@app.task(bind=True, max_retries=3)
def process_document(self, doc_id: str, model: str = "gpt-4"):
    """处理文档（耗时 AI 任务）"""
    try:
        doc = fetch_document(doc_id)
        result = call_llm(doc.content, model)
        save_result(doc_id, result)
        return {"doc_id": doc_id, "status": "done"}
    except Exception as exc:
        # 失败自动重试（指数退避）
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)

# 在 Web 服务里调用（异步，不等结果）：
@app.post("/process")
async def process_endpoint(doc_id: str):
    task = process_document.delay(doc_id)  # 推入队列，立即返回
    return {"task_id": task.id, "status": "queued"}

# 查询结果：
@app.get("/task/{task_id}")
async def get_task_result(task_id: str):
    task = process_document.AsyncResult(task_id)
    return {
        "status": task.status,  # PENDING / STARTED / SUCCESS / FAILURE
        "result": task.result if task.ready() else None
    }
```

**Worker 启动**：

```bash
# 启动 Worker（默认 prefork，CPU 核数个进程）
celery -A tasks worker --loglevel=info

# I/O 密集任务：gevent 模式（单进程，多协程）
celery -A tasks worker --pool=gevent --concurrency=100

# 定时任务（Celery Beat）
celery -A tasks beat --loglevel=info
```

### 3）Celery 在 AI 场景的应用

```python
# AI 推理队列化（避免 API 超时）
@app.task(queue="inference", time_limit=120)
def run_inference(request_id: str, prompt: str, model_config: dict):
    """
    GPU 推理任务队列化：
    - 用户请求 → API 立即返回 task_id
    - 后台 Worker 调用 GPU 推理（可能几十秒）
    - 前端轮询 /task/{task_id} 查询状态
    """
    model = load_model(model_config)
    result = model.generate(prompt)
    return result

# Celery 优先级队列
@app.task(queue="high_priority")  
def premium_inference(prompt): ...

@app.task(queue="default")
def standard_inference(prompt): ...

# Worker 配置优先级：
# celery -A tasks worker -Q high_priority,default --concurrency=4
```

### 4）gevent：monkey-patch 魔法

```python
# gevent 的核心：在程序启动时 monkey-patch 标准库
# 把同步 socket 操作替换为非阻塞协程版本
import gevent.monkey
gevent.monkey.patch_all()  # 必须在所有 import 之前！

# patch_all() 做了什么：
# - socket → gevent socket（非阻塞）
# - threading → gevent greenlet（协程）
# - time.sleep → gevent.sleep（协程让出）
# - ssl, select, os.fork 等也被 patch

# patch 之后，原本阻塞的代码变成协程：
import requests  # import 在 patch 后，requests 的 socket 已被替换

def fetch(url):
    return requests.get(url)  # 看起来是同步，实际是协程

# 可以并发运行：
from gevent import spawn, joinall
jobs = [spawn(fetch, url) for url in urls]  # 创建 100 个协程
joinall(jobs)  # 并发等待所有完成（事实上是 gevent 事件循环调度）
```

**gevent + Flask/Gunicorn（常见生产配置）**：

```bash
# 用 gevent worker 运行 Flask
gunicorn -w 4 -k gevent app:app
# -w 4：4 个进程（根据 CPU 核数）
# -k gevent：每个进程用 gevent 协程处理请求
# 相当于：4 进程 × N 协程（并发）= 高吞吐量
```

```python
# gunicorn.conf.py
workers = 4
worker_class = "gevent"
worker_connections = 1000  # 每个 worker 最多 1000 个并发协程
```

### 5）gevent vs asyncio 的核心区别

```
维度              gevent                    asyncio
────────────────────────────────────────────────────────────
并发模型          协作式协程（greenlet）      协作式协程（native coroutine）
代码改动          零改动（monkey-patch）     需要 async/await 重写
Python 版本       Python 2/3                Python 3.4+（3.7+ 推荐）
框架支持          Flask/Django（同步框架）    FastAPI/Starlette（async框架）
性能              略低（greenlet 开销）       略高（native coroutine）
调试难度          高（隐式切换，难 trace）    较低（显式 await）
AI 友好度         中（旧项目迁移）            高（新项目首选）
```

### 6）什么时候选 Celery，什么时候选 asyncio

```
用 Celery：
  ✅ 任务需要排队（不能立即处理）
  ✅ 任务需要重试、持久化
  ✅ 需要跨服务、跨机器分发任务
  ✅ 耗时任务（>1s）不想阻塞 HTTP 响应
  ✅ 定时任务（Celery Beat）
  示例：AI 批量推理、报告生成、邮件发送

用 asyncio（FastAPI + aiohttp）：
  ✅ 单次请求内需要并发调用多个 API
  ✅ 实时流式响应（SSE/WebSocket）
  ✅ 高并发 I/O 密集服务
  示例：LLM API 代理、实时推理服务、聊天机器人

两者结合（常见架构）：
  FastAPI（接受请求）→ Celery（任务队列）→ GPU Worker（执行推理）→ Redis（结果缓存）
```

## 延伸追问

- **Q：Celery 的 prefork 和 gevent 模式怎么选？**
  → 任务是**CPU 密集型**（压缩、哈希计算、纯 Python 计算）→ prefork（进程级隔离，真并行）；任务是**I/O 密集型**（调用外部 API、等待数据库）→ gevent（每个进程管理 N 个协程，节省内存，减少切换）。AI 推理（GPU）特殊：GPU 计算在 C 层，用 prefork（进程隔离，GPU 显存隔离更安全）。
- **Q：Celery 的 task 里能用 async/await 吗？**
  → 不直接支持（Celery worker 是同步的）。可以用 `asyncio.run(async_func())` 包装，或用第三方库 `celery-pool-asyncio`。但推荐分层：async 层处理协议，Celery 处理任务调度，task 函数保持同步。
- **Q：gevent monkey-patch 和 Celery 能一起用吗？**
  → 可以，`celery -A tasks worker --pool=gevent` 就是这样。但 `monkey.patch_all()` 必须在 Celery 导入前调用，否则部分 patch 失效。注意 gevent 的 patch 可能与某些 C 扩展（如 numpy fork 安全问题）冲突。

## 我的记法

- **Celery** = 任务队列（异步、持久化、分布式），broker=Redis，worker=进程/协程
- **gevent** = monkey-patch 让同步代码变协程，零改动适配旧框架
- **AI 场景**：FastAPI 接请求 → Celery 任务队列 → GPU Worker 执行
- prefork（CPU 密集）vs gevent（I/O 密集）选 pool 类型
- 一句话：**「Celery 管任务的去哪跑，gevent 管代码怎么跑，两者可以叠用」**

## 状态
- [ ] 已背速记
- [ ] 能写 Celery 任务 + delay 调用 + 结果查询
- [ ] 能解释 gevent monkey-patch 原理
