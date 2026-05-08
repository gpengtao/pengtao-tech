---
tags: [P0, Python方向, 生疏]
相关: "[[03-Python技术栈/index]]"
---

# asyncio 事件循环机制

## 一句话速记

**asyncio 的事件循环 = 单线程的调度中心**：维护一个待执行的任务队列 + I/O 就绪回调，不断轮询哪些协程可以继续运行。`await` 是主动让出控制权（yield），让事件循环去跑其他协程；I/O 完成时事件循环把对应协程放回就绪队列。核心：**协作式多任务，单线程，无锁，靠 `await` 切换**——而不是抢占式线程调度。

## 通俗解释（5 分钟版）

**类比**：餐厅里只有一个服务员（单线程），但他服务效率极高：

```
普通同步代码（一个客人等着，其他人等死）：
  服务员给 A 点菜 → 去厨房等菜 10min → 取菜 → 给 A 上菜
  → 才开始接待 B（B 等了 10min）

asyncio（服务员同时管很多桌）：
  服务员给 A 点菜 → A 去等（await 厨房出菜）→ 立刻去 B 点菜
  → B 去等 → 去 C 点菜
  → A 的菜好了（I/O 完成）→ 回去给 A 上菜
  → B 的菜好了 → 给 B 上菜
  
总时间 ≈ max(等待时间)，而不是 sum(等待时间)
```

## 关键细节

### 1）事件循环的核心结构

```python
# 简化版事件循环的内部逻辑（帮助理解，不是实际实现）
import selectors

class SimpleEventLoop:
    def __init__(self):
        self._ready = []      # 就绪队列（可以立即运行的协程）
        self._selector = selectors.DefaultSelector()  # I/O 监控
    
    def run_until_complete(self, coro):
        task = Task(coro)
        self._ready.append(task)
        
        while self._ready or self._selector.get_map():
            # 1. 运行所有就绪的任务
            for task in self._ready:
                task.step()  # 运行到下一个 yield/await
            self._ready.clear()
            
            # 2. 轮询 I/O（epoll/kqueue/select）
            events = self._selector.select(timeout=0)
            for key, mask in events:
                callback = key.data
                self._ready.append(callback)  # I/O 完成，加入就绪队列
```

**实际的事件循环（uvloop/asyncio）**：

```
Run loop once:
  1. 运行就绪队列中的 callbacks/tasks（直到遇到 await 或完成）
  2. 计算下次 select 超时（最近的 delayed call 时间）
  3. 调用 selector.select()（等待 I/O 事件，阻塞但超时控制）
  4. 处理 I/O 完成的回调，加入就绪队列
  5. 处理到期的定时任务（asyncio.sleep(n) 到期）
  6. 回到 1
```

### 2）协程、Task 和 Future 的关系

```python
import asyncio

# 协程函数（async def）
async def fetch(url):
    await asyncio.sleep(1)  # 模拟 I/O
    return f"response from {url}"

# 创建协程对象（不立即运行）
coro = fetch("https://example.com")

# 方式 1：asyncio.run()（创建事件循环并运行，最高层级）
result = asyncio.run(fetch("https://example.com"))

# 方式 2：await（在已有事件循环里等待）
async def main():
    result = await fetch("https://example.com")  # 等待完成

# 方式 3：create_task()（并发调度，不等待）
async def main():
    task1 = asyncio.create_task(fetch("url1"))  # 立即调度，不等待
    task2 = asyncio.create_task(fetch("url2"))  # 立即调度，不等待
    # 这里两个 task 已经在后台运行了
    r1 = await task1  # 等待 task1 完成
    r2 = await task2  # 等待 task2 完成（可能已完成）
```

**Task vs Future**：

```
Future：底层抽象，代表"未来某时刻的结果"
Task：Future 的子类，包装协程（等于 Future + 自动驱动协程运行）
await Future：等待外部代码 set_result()（I/O 驱动）
await Task：等待协程运行完成（自动驱动）
```

### 3）asyncio.sleep(0) 的特殊作用

```python
async def long_task():
    for i in range(1000000):
        # 纯计算，不会 await → 会阻塞事件循环！
        result = compute(i)
    
    # 偶尔 yield 控制权，让其他协程有机会运行
    if i % 1000 == 0:
        await asyncio.sleep(0)  # sleep(0) = 立即放弃控制权，下轮循环继续

# sleep(0) 是"礼让"操作：把自己放回队列末尾，让其他就绪任务先跑
```

### 4）uvloop：更快的事件循环

```python
# uvloop：基于 libuv（Node.js 的 C 事件循环库）的 asyncio 替代
# 性能约为标准 asyncio 的 2-4x（更快的 selector + 减少 Python 层开销）
import uvloop

# 全局替换
uvloop.install()  # 替换 asyncio 默认事件循环
asyncio.run(main())  # 自动使用 uvloop

# FastAPI + Gunicorn 的生产部署一般加 uvloop
```

### 5）事件循环的线程安全

```python
# asyncio 不是线程安全的！
# 不能从另一个线程直接调用协程

import threading

loop = asyncio.get_event_loop()

def from_another_thread():
    # ❌ 错误：直接调用
    await some_coroutine()  # SyntaxError（非 async 函数里不能 await）
    
    # ✅ 正确：通过线程安全接口
    future = asyncio.run_coroutine_threadsafe(
        some_coroutine(),
        loop
    )
    result = future.result(timeout=10)

# run_coroutine_threadsafe：
# - 把协程包装成 Task 提交给事件循环
# - 使用 call_soon_threadsafe（内部有锁）
# - 返回 concurrent.futures.Future（不是 asyncio.Future）
```

### 6）常见的阻塞陷阱与诊断

```python
# 陷阱：同步 requests 阻塞事件循环
@app.get("/bad")
async def bad():
    r = requests.get("https://api.com")  # 阻塞！其他请求无法处理
    return r.json()

# 检测隐形阻塞：
import asyncio

async def main():
    # 设置调试模式，记录执行超过 100ms 的协程
    loop = asyncio.get_event_loop()
    loop.set_debug(True)
    loop.slow_callback_duration = 0.1  # 100ms 告警阈值

# 或用 asyncio 内置的调试工具：
# PYTHONASYNCIODEBUG=1 python app.py
# 会打印：Executing <Task ...> took 0.150 seconds
```

## 延伸追问

- **Q：asyncio 是单线程的，为什么可以处理大量并发？**
  → 因为网络 I/O 的瓶颈在等待（RTT + 服务器处理时间），不在 CPU。事件循环在等待时切换到其他协程，CPU 几乎不空转。对于 1000 个并发请求，单线程事件循环比 1000 个线程更省资源（无线程切换开销，无锁竞争，内存节省 ~1000x）。
- **Q：asyncio.Queue 和 threading.Queue 的区别？**
  → `asyncio.Queue` 是协程安全的（不是线程安全），`get()`/`put()` 是可 await 的协程；`threading.Queue` 是线程安全的阻塞队列。在 asyncio 程序里只能用 `asyncio.Queue`，否则 `queue.get()` 会阻塞事件循环。
- **Q：为什么要用 `asyncio.run()` 而不是 `loop.run_until_complete()`？**
  → `asyncio.run()` 是 Python 3.7+ 推荐方式：自动创建新事件循环、运行完成后关闭循环并清理资源（取消未完成的 Task）；`run_until_complete()` 需要手动管理事件循环生命周期，容易资源泄漏。

## 我的记法

- 事件循环 = 就绪队列 + I/O 轮询（selector），单线程无锁
- `await` = 主动让出（协作式），不是抢占式
- Task = Future + 自动驱动协程
- `sleep(0)` = 礼让（yield 控制权给其他协程）
- 线程调用协程 → 用 `run_coroutine_threadsafe`
- 生产环境 + uvloop → 性能 2-4x
- 一句话：**「事件循环就是一个 while True 循环：跑就绪任务，再 select 等 I/O」**

## 状态
- [ ] 已背速记
- [ ] 能讲事件循环的轮询流程
- [ ] 能答 asyncio 和多线程高并发对比
