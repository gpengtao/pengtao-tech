---
tags: [P1, Python方向, 生疏]
相关: [[03-Python技术栈/_MOC]]
---

# Python 3.12 No-GIL（PEP 703）对 AI 应用的意义 / Sub-interpreters（PEP 684）

## 一句话速记

**No-GIL（PEP 703）**：CPython 3.13 开始支持可选禁用 GIL（`--disable-gil`），通过**原子引用计数 + 细粒度锁**替代全局锁，让 CPU 密集型纯 Python 代码真正多核并行——对 AI 应用意义是：LLM tokenizer（Python 层）、embedding 后处理等现在可以多线程并行，不再强制用多进程。**Sub-interpreters（PEP 684）**：每个子解释器有独立 GIL，可以真正并行，是 No-GIL 的"保守版"替代方案（不移除 GIL，而是有多把 GIL）。两者都处于实验/早期阶段（2026 年），核心关注趋势即可。

## 关键细节

### 1）No-GIL（PEP 703）的技术方案

**问题**：移除 GIL 的难点是引用计数不安全

```
Python 对象的引用计数：
  每次 x = obj → ob_refcnt += 1
  每次 del x → ob_refcnt -= 1
  ob_refcnt == 0 → 释放内存

多线程同时 ob_refcnt += 1：
  线程A: 读 refcnt=5
  线程B: 读 refcnt=5
  线程A: 写 refcnt=6   （线程B的+1丢了！）
  → 提前释放内存 → 悬垂指针 → 崩溃
```

**No-GIL 的解法**：

```
1. Biased Reference Counting（偏向引用计数）：
   - 对象有"拥有者线程"（创建它的线程）
   - 拥有者线程的操作用非原子计数（快）
   - 其他线程的操作用原子指令（慢但安全）
   - 大多数对象只被一个线程访问 → 大部分操作不付原子操作代价

2. Immortal Objects（永生对象）：
   - None、True、False、小整数、字面字符串等设为"永生"
   - 永生对象引用计数不变（永远不释放）→ 完全无锁

3. 细粒度锁：
   - 字典、列表等内置类型有独立锁（而不是全局 GIL）
```

**性能影响**：

```
No-GIL 版 vs 有 GIL 版：
  单线程：约 -5% 到 -10%（原子操作开销）
  多线程 CPU 密集：约 +200% 到 +400%（真正多核）
  I/O 密集：基本持平（瓶颈不在 CPU）

AI 推理（torch/numpy）：
  基本不变（计算在 C/GPU，早就绕过 GIL）
  tokenizer（Python 层）：如果是纯 Python，可提速
  HuggingFace tokenizers（Rust）：不变
```

### 2）No-GIL 对 AI 应用的实际意义（2026 视角）

```
场景                         有 GIL               No-GIL
────────────────────────────────────────────────────────────
批量 tokenization（纯 Python）  多线程无效，要多进程   多线程可并行
Embedding 后处理（纯 Python）   多线程无效             多线程可并行
torch.forward()（C/CUDA）      多线程已可并行（释放GIL）无变化
vLLM 调度层（Python）           GIL 竞争导致调度延迟   调度可并行，延迟降低
多租户推理服务（多线程服务多用户）  受限                  可能有改善
```

**实际现状（2026）**：

```
CPython 3.13：--disable-gil 构建可用（实验性）
CPython 3.14：No-GIL 稳定化进行中
主流 AI 库适配：
  - PyTorch 在适配（主要计算本来就绕 GIL）
  - numpy 已经大部分兼容
  - 第三方扩展需要逐一适配（C 扩展假设有 GIL 保护的代码会出 bug）
生产建议：关注，但 2026 年不要在生产切换 No-GIL 构建
```

### 3）Sub-interpreters（PEP 684）

**概念**：

```python
# 传统方案：一个进程一个 GIL
# Sub-interpreters：一个进程里多个解释器实例，每个有独立 GIL

# Python 3.12 提供了官方 API：
import _interpreters  # 底层（还不稳定）

# 预期用法（PEP 734，Python 3.13+）：
from interpreters import Interpreter
interp = Interpreter()
interp.run("""
    import heavy_module
    result = heavy_module.compute(data)
""")
```

**Sub-interpreters vs multiprocessing vs No-GIL**：

```
方案              内存隔离     GIL 竞争     启动开销    共享状态
multiprocessing   完全隔离     无           高（fork/spawn）  需要序列化
sub-interpreters  部分隔离     无（各自GIL）低             有限共享
No-GIL 多线程     无隔离       无（无GIL）  极低          完全共享（需要锁）
有GIL 多线程      无隔离       有           极低          完全共享（但GIL保护）
```

**Sub-interpreters 的定位**：

```
适合：
  - 需要隔离但不想付 fork 开销的场景
  - Web 服务器（每个请求或 worker 用独立解释器）
  - 插件系统（每个插件独立解释器，互不影响）

不适合：
  - 纯追求 CPU 并行（No-GIL 更直接）
  - 数据密集型（共享数据需要特殊处理）
```

### 4）实际工程建议

**现在（2026）怎么做**：

```python
# CPU 密集 → 继续用 multiprocessing（稳定可靠）
from multiprocessing import Pool
with Pool(4) as p:
    results = p.map(compute, data)

# I/O 密集 → asyncio（稳定，生产可用）
async def fetch_all(urls):
    async with aiohttp.ClientSession() as session:
        tasks = [fetch(session, url) for url in urls]
        return await asyncio.gather(*tasks)

# 关注 No-GIL：
# - 跟踪 CPython 3.14 的 No-GIL 进展
# - AI 框架（vLLM/torch）的 No-GIL 适配进度
# - 在 staging 环境测试 --disable-gil 构建
```

## 延伸追问

- **Q：No-GIL 后，原来依赖 GIL 的并发代码会出 bug 吗？**
  → 可能。GIL 提供了隐式保护——很多 Python 代码其实在"偷用" GIL 的保护而没有显式加锁。No-GIL 后这些代码需要显式同步。CPython 官方会尽量保持兼容性，但第三方 C 扩展需要开发者自行适配。
- **Q：PyPy / Jython 没有 GIL，为什么不用它们替代 CPython？**
  → PyPy 的 JIT 与 CPython 的 C API 不完全兼容（很多 C 扩展如 torch、numpy 无法在 PyPy 上运行）；Jython 是 Java 版，性能特性不同，AI 生态不支持。大多数 AI 库强依赖 CPython 的 C API。
- **Q：Go 的 goroutine 和 Python asyncio 的区别？**
  → Go goroutine 由 Go 运行时调度（M:N 模型，多线程真并行 + 协作式调度），天然多核；asyncio 是单线程（M:1），靠 I/O 切换。Go 更适合 CPU 密集 + 高并发，asyncio 更适合 I/O 密集 + 大量轻量连接。No-GIL 让 Python 多线程更接近 goroutine 的模型。

## 我的记法

- **No-GIL**：原子引用计数 + 偏向计数，移除全局 GIL
  - 单线程微降（-5%），多线程 CPU 密集大幅提升
  - AI 推理（GPU/C）几乎无变化，tokenizer 等 Python 层有提升
  - 3.13 实验，3.14+ 稳定，**2026 生产不建议切**
- **Sub-interpreters**：每个解释器独立 GIL，启动比进程快
  - 适合隔离 + 低开销场景（Web worker、插件）
- 一句话：**「No-GIL 让多线程 Python 变成 Go goroutine，但 AI 推理瓶颈不在这」**

## 状态
- [ ] 已背速记
- [ ] 能说 No-GIL 的核心技术方案
- [ ] 能分析对 AI 应用的影响
