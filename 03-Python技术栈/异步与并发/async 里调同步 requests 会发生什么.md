---
tags: [P0, Python方向, 生疏]
相关: "[[03-Python技术栈/_MOC]]"
---

# async 函数里调了同步 `requests.get()` 会发生什么

## 一句话速记

**async 函数里调同步 `requests.get()` 会阻塞整个事件循环**——不只是当前协程暂停，而是所有请求都卡住，直到 `requests.get()` 返回。因为 asyncio 是单线程，`requests` 是阻塞系统调用（调用 `socket.recv()`，OS 线程阻塞），事件循环无法轮询其他 I/O。服务看起来"单核单线程同步"处理请求，并发为 1。

## 通俗解释

**类比**：

```
餐厅里唯一的服务员（事件循环线程）：

正常情况（async I/O）：
  服务员给 A 点菜 → "菜还没好，先去其他桌"（await/yield）
  → 服务 B、C、D...
  → A 菜好了（I/O callback）→ 回去上菜

调用了 requests.get()（同步阻塞）：
  服务员给 A 点菜 → 服务员**亲自跑去厨房站着等菜**
  → 在厨房站了 500ms → 端菜回来
  → 这 500ms 里 B、C、D 都等着没人管
```

## 关键细节

### 1）阻塞的本质

```python
@app.get("/user/{id}")
async def get_user(id: int):
    # requests.get() 内部调用：
    # Python socket → OS syscall: recv() → 线程阻塞（等待数据到达）
    # 事件循环的 selector.select() 根本没机会运行！
    response = requests.get(f"https://api.example.com/user/{id}")
    #            ↑ 这里阻塞整个线程 N 毫秒
    return response.json()
```

**影响**：

```
正常 async 服务（asyncio + aiohttp）：1000 个并发请求 → 交替处理，总时间 ≈ 最慢单个请求
调用 requests.get() 后：1000 个并发请求 → 串行处理，总时间 ≈ 所有请求时间之和
性能下降 1000x
```

### 2）三种修复方案

**方案 A：换成 async 的 http 库（推荐）**

```python
import aiohttp

@app.get("/user/{id}")
async def get_user(id: int):
    async with aiohttp.ClientSession() as session:
        async with session.get(f"https://api.example.com/user/{id}") as resp:
            return await resp.json()
    # aiohttp 底层用 asyncio 的 socket，不阻塞事件循环
```

**方案 B：asyncio.to_thread 包装（快速修复）**

```python
import asyncio
import requests

@app.get("/user/{id}")
async def get_user(id: int):
    # 把同步调用放到线程池，不阻塞事件循环
    response = await asyncio.to_thread(
        requests.get,
        f"https://api.example.com/user/{id}"
    )
    return response.json()
# 代价：多一个线程，有线程创建/切换开销
# 适合：临时方案，或第三方库没有 async 版本
```

**方案 C：httpx（同时支持同步和 async）**

```python
import httpx

# 同步用法：
response = httpx.get("https://api.example.com")

# 异步用法（推荐替换 aiohttp，API 更友好）：
@app.get("/user/{id}")
async def get_user(id: int):
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://api.example.com/user/{id}")
        return response.json()
```

### 3）怎么发现和定位"隐形阻塞"

**方法 1：asyncio 调试模式**

```bash
# 环境变量开启
PYTHONASYNCIODEBUG=1 python app.py

# 输出示例（阻塞超过 100ms 自动告警）：
# Executing <Task finished coro=<get_user()> result=...> took 0.523 seconds
```

```python
# 代码开启（更精细控制）
import asyncio
import logging

logging.basicConfig(level=logging.DEBUG)

async def main():
    loop = asyncio.get_event_loop()
    loop.set_debug(True)
    loop.slow_callback_duration = 0.05  # 50ms 就告警
    await run_app()
```

**方法 2：自定义中间件检测**

```python
# FastAPI 中间件，检测慢接口（包含阻塞）
import time
from fastapi import Request

@app.middleware("http")
async def timing_middleware(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    duration = time.monotonic() - start
    
    if duration > 0.1:  # 超过 100ms
        print(f"SLOW: {request.url.path} took {duration:.3f}s")
    
    return response
```

**方法 3：blocking-detector（第三方库）**

```python
# pip install async-timeout blocking-detector
import blockingio

@blockingio.patch
async def my_handler():
    requests.get("...")  # 会抛出 BlockingIOError！
```

**方法 4：代码审查——搜索同步阻塞调用**

```bash
# 在项目里搜索潜在的阻塞调用
rg "requests\.(get|post|put|delete|patch)" --type py
rg "time\.sleep\(" --type py  # 不是 asyncio.sleep
rg "open\(" --type py          # 同步文件 I/O（应用 aiofiles）
rg "\.execute\(" --type py     # 同步数据库调用
```

### 4）常见的"隐形阻塞"

```python
# 1. 同步 HTTP：requests / urllib
requests.get(url)  # ❌

# 2. 同步文件 I/O
open("file.txt").read()  # ❌
# 修复：
import aiofiles
async with aiofiles.open("file.txt") as f:
    content = await f.read()  # ✅

# 3. 同步数据库 ORM（SQLAlchemy 同步版）
db.query(User).all()  # ❌（如果在 async 函数里）
# 修复：用 SQLAlchemy async 或 Tortoise ORM

# 4. time.sleep（不是 asyncio.sleep）
time.sleep(1)  # ❌ 阻塞线程
await asyncio.sleep(1)  # ✅ 只暂停当前协程

# 5. 同步 Redis/Kafka 客户端
redis_client.get("key")  # ❌（用 aioredis）
consumer.poll()          # ❌（用 aiokafka）

# 6. 重计算（纯 Python CPU 密集）
result = [heavy_compute(x) for x in big_list]  # ❌
# 修复：
result = await asyncio.to_thread(process_list, big_list)  # ✅
```

### 5）FastAPI 特殊情况（def vs async def）

```python
# FastAPI 的特殊处理：
# async def 路由 → 在事件循环里直接运行（必须用 async I/O）
@app.get("/async")
async def async_handler():
    requests.get(...)  # ❌ 阻塞事件循环

# def 路由（非 async）→ FastAPI 自动在线程池里运行
@app.get("/sync")
def sync_handler():
    requests.get(...)  # ✅ 在线程里运行，不阻塞事件循环
    # 但每个 def 路由占一个线程，高并发时线程资源不够
```

**所以 FastAPI 中**：如果无法把代码改成 async，用 `def` 路由（自动线程池）比 `async def` + 同步阻塞更安全。

## 延伸追问

- **Q：如果已经在 `asyncio.to_thread` 的线程里，还需要担心阻塞吗？**
  → 不需要。`to_thread` 里的同步代码在独立线程中运行，不占用事件循环线程。`requests.get()` 阻塞的是这个工作线程，事件循环继续轮询其他协程。代价是线程资源消耗。
- **Q：Redis pipeline 操作是同步的，怎么在 async 服务里用？**
  → 有两种方案：1) 用 `aioredis`（完全异步 Redis 客户端）；2) 把 pipeline 操作包装进 `asyncio.to_thread`。生产推荐 `aioredis`，性能更好，语义更清晰。
- **Q：所有 I/O 都应该用 async 吗？**
  → 理论上是，但实际要权衡：如果 I/O 操作很快（< 1ms，如本地 Redis），同步调用加 `to_thread` 的开销可能比直接异步更大。对于**外部 API 调用**（延迟几十到几百 ms），一定要用 async。

## 我的记法

- `requests.get()` 在 async 里 = 整个事件循环卡死（不是单个协程暂停）
- 修复：换 aiohttp/httpx → async，或 `to_thread` 包装
- 检测：`PYTHONASYNCIODEBUG=1` + `slow_callback_duration`
- FastAPI 特例：`def` 路由自动进线程池，比 `async def` + 同步阻塞安全
- 一句话：**「async 里的同步阻塞 = 全局阻塞，不是自己等，是全服务等」**

## 状态
- [ ] 已背速记
- [ ] 能解释为什么是全局阻塞
- [ ] 能说三种修复方案
