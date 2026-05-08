---
tags: [P0, Python方向, 生疏]
相关: "[[03-Python技术栈/index]]"
---
# 多进程 / asyncio / 多线程的选择矩阵

## 一句话速记

**选择核心原则**：**CPU 密集 → multiprocessing**（绕开 GIL，真并行）；**I/O 密集 + 高并发 → asyncio**（单线程事件循环，无切换开销）；**I/O 密集 + 需要调用阻塞第三方库 → ThreadPoolExecutor**（兼容同步代码）；**AI 推理服务 → asyncio + asyncio.to_thread**（异步接受请求 + 线程池跑推理）。

## 通俗解释（5 分钟版）

**三种模型的本质**：

```
多进程（multiprocessing）：
  每个进程独立解释器 + 独立 GIL → CPU 真并行
  代价：内存翻 N 倍 + 进程间通信需要序列化（pickle）

多线程（threading）：
  共享内存 + 共享 GIL → CPU 密集型实际是单核
  I/O 阻塞时释放 GIL → I/O 密集有效
  代价：GIL 竞争开销 + 线程上下文切换

asyncio（协程）：
  单线程 + 事件循环调度 → 无 GIL 竞争，无线程切换
  要求：所有 I/O 用 async/await（不能有同步阻塞调用）
  代价：回调/协程心智模型，调试稍难
```

**选择矩阵**：

```
场景                             推荐方案              原因
─────────────────────────────────────────────────────────────────
CPU 密集（图像处理/加密/压缩）    multiprocessing       绕 GIL，真并行
CPU 密集 + 数据大（NLP 批处理）  multiprocessing       或者 C 扩展（numpy/cython）
I/O 密集 + 纯 async 代码         asyncio               最高并发，低开销
I/O 密集 + 有同步阻塞库          ThreadPoolExecutor    包装成 await 调用
混合（异步接请求+推理）          asyncio + to_thread   标准 LLM 服务模式
爬虫（大量网络请求）             asyncio + aiohttp     aiohttp 天然异步
Celery 异步任务（重计算）        multiprocessing worker  Celery 默认 prefork
```

## 关键细节

### 1）multiprocessing 的实用写法

```python
from multiprocessing import Pool, cpu_count

def heavy_compute(data):
    # CPU 密集计算
    return sum(x ** 2 for x in data)

# Pool.map：最简单，自动分配 + 等待所有结果
with Pool(processes=cpu_count()) as pool:
    results = pool.map(heavy_compute, list_of_data)

# Pool.imap_unordered：流式结果（内存友好）
with Pool(4) as pool:
    for result in pool.imap_unordered(heavy_compute, large_list):
        process(result)

# 注意：数据通过 pickle 序列化传递！
# Lambda 和 本地函数不能 pickle → 报错
# 解决：把函数放到模块顶层
```

**进程池 vs 进程**：

```python
# 不要每次任务都 spawn 新进程（开销大）
# Pool 是预先创建好的进程池（类似线程池）
pool = Pool(4)  # 预创建 4 个 worker 进程

# 子进程启动方式（影响行为）：
# fork（Linux 默认）：快，复制父进程内存
# spawn（Mac/Win 默认）：慢，全新进程，安全（推荐用于多线程+fork 的场景）
# forkserver：折中
```

### 2）asyncio 的事件循环模型

```python
import asyncio
import aiohttp

async def fetch(url):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            return await resp.text()

async def main():
    urls = ["https://api1.com", "https://api2.com", "https://api3.com"]
    # gather 并发执行所有协程（不是并行，是单线程交替）
    results = await asyncio.gather(*[fetch(url) for url in urls])
    return results

asyncio.run(main())
```

**asyncio 的"并发"是交替执行**：

```
单线程事件循环：
  → fetch(url1) 开始，等待网络 I/O → yield
  → 同时 fetch(url2) 开始，等待网络 I/O → yield
  → url1 有响应 → 恢复 fetch(url1) 处理
  → url2 有响应 → 恢复 fetch(url2) 处理

总时间 ≈ max(各请求时间)，而不是 sum(各请求时间)
```

### 3）ThreadPoolExecutor（asyncio 里跑同步代码）

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor(max_workers=10)

async def handler():
    # 把同步的阻塞调用包装成可 await 的
    result = await asyncio.get_event_loop().run_in_executor(
        executor,
        sync_blocking_function,  # 这个在线程池里跑
        arg1, arg2
    )
    
    # Python 3.9+ 更简洁的写法：
    result = await asyncio.to_thread(sync_blocking_function, arg1, arg2)
    return result
```

**典型场景**：

```python
# FastAPI + 推理模型（推理是同步的 torch.inference）
@app.post("/predict")
async def predict(input: InputSchema):
    # 不阻塞事件循环
    result = await asyncio.to_thread(model.predict, input.data)
    return {"result": result}
```

### 4）三者的开销对比

```
维度              asyncio          ThreadPool        multiprocessing
─────────────────────────────────────────────────────────────────────
内存开销          极低（协程 ~kb）  低（线程 ~mb）     高（进程 ~100mb）
切换开销          极低（yield）     中（OS 线程切换）  高（进程间）
最大并发数        数万（轻松）      数百（受OS限制）   CPU 核数量级
通信方式          共享内存（同步！）共享内存           Queue/Pipe/Manager
适合 I/O 并发     ✅ 最优           ✅ 可以            ❌ 浪费
适合 CPU 计算     ❌               ❌（GIL）          ✅ 最优
```

### 5）LLM 应用的标准模式

```python
# 推荐的 LLM 推理服务架构：
import asyncio
from fastapi import FastAPI
from concurrent.futures import ThreadPoolExecutor

app = FastAPI()
model_executor = ThreadPoolExecutor(max_workers=4)  # 推理线程池

@app.post("/chat")
async def chat(request: ChatRequest):
    # FastAPI 的 async 路由在事件循环里运行
    # 推理在线程池里跑（不阻塞事件循环）
    response = await asyncio.to_thread(
        llm.generate,  # 同步推理函数（可能在 C/GPU 层）
        request.messages
    )
    return {"response": response}

# 结果：
# - 事件循环处理新请求（低延迟）
# - 推理在线程里跑（不阻塞其他请求）
# - 推理在 GPU/C 层时 GIL 自动释放，线程池真正并发
```

### 6）常见错误和坑

**坑 1：在 async 函数里调同步阻塞库**

```python
# ❌ 错误：会阻塞整个事件循环
@app.get("/bad")
async def bad():
    result = requests.get("https://api.com")  # 阻塞！
    return result.json()

# ✅ 正确
@app.get("/good")
async def good():
    async with aiohttp.ClientSession() as s:
        async with s.get("https://api.com") as r:
            return await r.json()

# 或包装同步代码：
async def good2():
    result = await asyncio.to_thread(requests.get, "https://api.com")
    return result.json()
```

**坑 2：multiprocessing 在 Jupyter 里跑不起来**

```python
# Jupyter 是交互式 shell，fork 有问题
# 解法：在 .py 文件里运行，或用 multiprocessing.get_context('spawn')
ctx = multiprocessing.get_context('spawn')
pool = ctx.Pool(4)
```

## 延伸追问

- **Q：asyncio.gather 和 asyncio.create_task 有什么区别？**
  → `gather` 等待所有协程完成后返回结果列表；`create_task` 立即调度协程运行（不等待），返回 Task 对象——可以在其他协程执行期间后台运行。`gather` 是 `create_task` + `await` 的封装，两者底层相同。
- **Q：为什么 Flask 是同步框架，FastAPI 是异步框架？**
  → Flask 每个请求在单独线程里处理（WSGI 同步模型），并发靠多线程/多进程；FastAPI 基于 Starlette（ASGI 异步模型），一个线程的事件循环处理多个请求，适合 I/O 密集型服务（如 AI 推理，大量等待模型/数据库）。
- **Q：Celery 是多进程还是 asyncio？**
  → 默认是多进程（prefork）——每个 Worker 是一个进程，适合 CPU 密集任务。也支持 gevent（协程）和 eventlet（协程）模式，适合 I/O 密集。具体选择取决于任务类型。

## 我的记法

- **CPU 密集 → multiprocessing**（进程池，真并行）
- **I/O 密集 + 纯 async → asyncio**（事件循环，最省内存）
- **I/O 密集 + 同步阻塞库 → to_thread / ThreadPoolExecutor**
- **LLM 服务标准模式**：asyncio 事件循环 + `to_thread` 包推理
- asyncio 是单线程**交替**，不是并行——`gather` 并发多个 I/O 等待
- 一句话：**「CPU 用进程，I/O 用协程，同步库阻塞就 to_thread 包一下」**

## 状态
- [ ] 已背速记（选择矩阵）
- [ ] 能讲通俗版
- [ ] 能写 LLM 服务的标准异步模式
