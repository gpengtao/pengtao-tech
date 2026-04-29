---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: [[_专题-具身Agent/_MOC]]
---

# Python async 与 FastAPI 入门

## 一句话速记

Python `async/await` 是**协作式并发**：单线程跑一堆协程，遇到 IO 等待时主动 `await` 让出，event loop 调别的协程上。FastAPI = `async def 路由 + Pydantic 自动校验 + OpenAPI 自动生成`，是 LLM/Agent 服务化的事实标准。

## 通俗解释（5 分钟版）

**和 Java 对照着看最快**：
- Java 是 **thread-per-request**：一个请求一个线程，IO 阻塞时线程挂起，靠 OS 调度切线程。线程多了切换开销爆炸
- Python async 是 **single-thread + event-loop**：一个线程上跑无数协程，**只有遇到 `await` 才切**。切换是用户态的，比线程切换便宜几个数量级

**核心四件套**：
- `coroutine`（协程对象）：`async def f()` 调用后**不会立刻执行**，返回一个"待跑的对象"。像懒函数。
- `event loop`（事件循环）：调度器，决定哪个协程跑、什么时候让出。
- `await`（让出点）：协程里"我现在等 IO，把 CPU 让出去"。**只有 await 处才会切换**。
- `asyncio.gather(*tasks)`：并发跑多个协程，全部完成才返回。

**为什么 LLM 应用必须 async**：
- LLM 调用一次 5-30 秒，同步写法 worker 全在傻等
- Agent 一次要并发调多个工具 / RAG 检索 / 多模型投票，`gather` 一下从串行 30s → 并行 10s
- 流式输出（SSE）token 一边到一边吐给前端，天然 async generator 的活

**FastAPI 是什么**：
- Python 圈的 Spring Boot：路由声明式（装饰器）、类型驱动（Pydantic）、自动文档（`/docs` 直接出 Swagger UI）
- 默认 async 友好。你写 `async def 路由(req: Req) -> Resp`，框架自动校验入参、序列化出参、生成 OpenAPI

## 关键细节 / 数学直觉

**坑点 1：async 函数里不能调阻塞 IO**
- ❌ `async def f(): r = requests.get(url)` —— `requests` 是同步阻塞，会卡死整个 event loop，所有协程一起停
- ✅ 用 `httpx.AsyncClient` / `aiohttp`：`async with httpx.AsyncClient() as c: r = await c.get(url)`
- 阻塞 CPU 计算同理：用 `await asyncio.to_thread(heavy_func)` 丢线程池

**坑点 2：FastAPI 里 sync 和 async 路由别混着用**
- `def 路由` → FastAPI 自动放线程池跑（兼容老代码）
- `async def 路由` → 直接在 event loop 跑
- 混用本身没问题，但 **`async def` 路由里调了同步阻塞函数** = 整个服务卡死，最难排查的坑

**常用模式速查**：
```python
# 1. 并发跑多个 IO
results = await asyncio.gather(
    fetch_user(uid),
    fetch_orders(uid),
    fetch_recommendations(uid),
)

# 2. 加超时
try:
    r = await asyncio.wait_for(call_llm(prompt), timeout=30)
except asyncio.TimeoutError:
    ...

# 3. 流式返回 LLM token
from fastapi.responses import StreamingResponse

@app.post("/chat")
async def chat(req: ChatReq):
    async def gen():
        async for token in llm.astream(req.prompt):
            yield f"data: {token}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")

# 4. 异步上下文（连接池/资源）
async with httpx.AsyncClient() as client:
    ...
```

**部署**：
- 开发：`uvicorn app:app --reload`
- 生产：`gunicorn -k uvicorn.workers.UvicornWorker -w 4 app:app`（4 个 worker 进程，每个跑一个 event loop）

**心智模型**：
```
线程模型（Java）：           协程模型（Python async）：
[req1] thread A 阻塞IO        [req1] coro A 遇 await
[req2] thread B 阻塞IO        [req2] coro B 让 CPU
[req3] thread C 阻塞IO        [req3] coro C 全在一个线程
OS 切线程（贵）                event loop 切协程（便宜）
```

## 延伸追问
- **Q：** async 和多线程、多进程怎么选？  
  → IO 密集 (LLM/HTTP/DB) 用 async；CPU 密集 (推理/算图) 用多进程；老代码不好改的时候用多线程。
- **Q：** 为什么 `await requests.get(url)` 会报错？  
  → `requests.get` 返回的是 Response 对象，不是 awaitable。`await` 只能用在 coroutine / Future / Task 上。
- **Q：** FastAPI 路由 `def` 和 `async def` 有什么区别？  
  → `def` 在线程池跑（自动），`async def` 在 event loop 跑。性能上 async 更高，但前提是路由内部全是非阻塞调用。
- **Q：** Uvicorn worker 数量怎么定？  
  → 通常 `2 * CPU + 1`，每个 worker 是独立进程跑独立 event loop。LLM 应用 IO 重，可以适当多开。

## 我的记法

> async = "等 IO 时让出 CPU"。一个线程跑一堆协程，await 是让出点。FastAPI 是 Python 版 Spring Boot，路由 + 类型 + 文档一把梭。LLM 服务必须 async，不然 worker 全在等 token。

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 写过一个 FastAPI demo 跑通

## 参考资料
- [FastAPI 官方教程](https://fastapi.tiangolo.com/zh/tutorial/)
- [PEP 492 — Coroutines with async and await syntax](https://peps.python.org/pep-0492/)
- [Real Python: Async IO in Python](https://realpython.com/async-io-python/)
