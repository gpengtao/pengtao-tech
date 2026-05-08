---
tags: [P1, Java方向, 生疏]
相关: "[[02-Java后端核心/index]]"
---

# CompletableFuture 默认线程池的坑

## 一句话速记

**`CompletableFuture.supplyAsync()` 等不指定 Executor 时，默认用 `ForkJoinPool.commonPool()`**。这个池子的线程数默认 = CPU 核数 - 1（如 8 核只有 7 个线程），**如果你的任务是 I/O 密集型（DB/HTTP 调用），这 7 个线程很快被阻塞占满，后续任务排队甚至拒绝**。另一个坑：commonPool 是 JVM 全局共享的，**不同业务的任务会互相抢占**。**解法**：I/O 密集型任务永远指定自定义线程池。

## 通俗解释（5 分钟版）

**CompletableFuture 的几种使用方式**：

```java
// 方式 1：不指定 Executor（危险！用 commonPool）
CompletableFuture.supplyAsync(() -> callRemoteService());

// 方式 2：指定自定义 Executor（正确做法）
ExecutorService myPool = Executors.newFixedThreadPool(50);
CompletableFuture.supplyAsync(() -> callRemoteService(), myPool);
```

**坑的根本原因**：

```
ForkJoinPool.commonPool() 的线程数：
  线程数 = Runtime.getRuntime().availableProcessors() - 1
  4 核机器 → 3 个线程
  8 核机器 → 7 个线程
  
  ForkJoinPool 是为 CPU 密集型任务设计的（Work Stealing）
  I/O 密集型：线程大部分时间在 wait，浪费 CPU，且线程数不够
```

## 关键细节

### 1）坑的代码示例

```java
// 危险场景：8 核机器，commonPool 只有 7 个线程
List<CompletableFuture<String>> futures = new ArrayList<>();
for (int i = 0; i < 100; i++) {
    futures.add(CompletableFuture.supplyAsync(() -> {
        // 每次 HTTP 调用耗时 500ms
        return httpClient.get("https://api.example.com/data");
    }));
}
CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

// 问题：
// - 同时只能有 7 个 HTTP 请求，其余 93 个排队
// - 总耗时 ≈ 100 / 7 * 500ms ≈ 7 秒
// - 如果 commonPool 被其他地方占用，更慢
```

**正确做法**：

```java
ExecutorService ioPool = new ThreadPoolExecutor(
    50, 100,
    60, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(1000),
    new ThreadFactory() { /* 命名线程 */ },
    new ThreadPoolExecutor.CallerRunsPolicy()
);

List<CompletableFuture<String>> futures = new ArrayList<>();
for (int i = 0; i < 100; i++) {
    futures.add(CompletableFuture.supplyAsync(() ->
        httpClient.get("https://api.example.com/data"), ioPool));
}
// 总耗时 ≈ 500ms（50 个并发，2 轮）
```

### 2）ForkJoinPool commonPool 的正确使用场景

```
适合 commonPool：
  ✅ 纯 CPU 计算（图像处理、加解密、排序）
  ✅ parallel stream 的内部处理（Java 默认就用 commonPool）
  ✅ 递归分治任务（ForkJoinTask.fork()/join()）
  
不适合 commonPool：
  ❌ JDBC / HTTP / Redis / RPC 调用
  ❌ 任何可能阻塞的操作
  ❌ 需要业务隔离的任务（避免互相干扰）
```

### 3）CompletableFuture 链式操作的线程选择

```java
CompletableFuture<String> cf = CompletableFuture.supplyAsync(() -> "data", pool1);

// 不同的 then* 方法用不同线程：
cf.thenApply(s -> transform(s))           // 使用前一个 stage 的完成线程（或 commonPool）
cf.thenApplyAsync(s -> transform(s))      // 使用 commonPool（坑！）
cf.thenApplyAsync(s -> transform(s), pool2) // 使用 pool2（推荐）
cf.thenApplyAsync(s -> transform(s), pool1) // 继续用 pool1（推荐）
```

**规律**：所有 `*Async` 方法不指定 Executor 都走 commonPool，要显式传。

### 4）thenApply vs thenApplyAsync 的差异

```
thenApply：
  如果上一步已经完成，在当前调用线程执行（同步执行）
  如果上一步还未完成，在完成上一步的线程里执行（继承线程）
  
thenApplyAsync：
  总是异步：投递到 Executor（默认 commonPool）执行，不继承上一步的线程
  适合需要隔离执行上下文的场景
```

### 5）其他常见坑

**坑 2：join() 在 commonPool 线程里调用**

```java
// 危险！在 ForkJoinPool commonPool 线程里调 join() 可能触发 "thread starvation"
// 线程全在等自己分出去的子任务，子任务又因为没有线程而等待 → 死锁
CompletableFuture.supplyAsync(() -> {
    CompletableFuture.supplyAsync(() -> "inner").join();  // 危险！
    return "outer";
});  // 可能死锁
```

**坑 3：异常处理**

```java
// 没有 exceptionally 的链式调用，异常会被吞掉
CompletableFuture.supplyAsync(() -> {
    throw new RuntimeException("error!");
}).thenApply(s -> s.toUpperCase())  // 不会执行，但也不会报错
  .thenAccept(System.out::println);  // 同上

// 正确做法：加 exceptionally 或 handle
.exceptionally(e -> {
    log.error("failed", e);
    return "fallback";
})
// 或
.handle((result, ex) -> {
    if (ex != null) { /* 处理异常 */ return "fallback"; }
    return result;
})
```

**坑 4：commonPool 并行度可以调整**

```bash
# JVM 参数调整 commonPool 并行度（不推荐，影响全局）
-Djava.util.concurrent.ForkJoinPool.common.parallelism=20

# 还是不如给具体任务单独指定线程池
```

## 延伸追问

- **Q：CompletableFuture 和 Future 的主要区别？**
  → `Future.get()` 是阻塞的，没有回调；`CompletableFuture` 支持链式回调、组合（`allOf/anyOf`）、异常处理，且可以手动 `complete()`（纯回调，不依赖线程）。
- **Q：`allOf` 和 `anyOf` 的用法场景？**
  → `allOf`：等所有任务完成（聚合多个 RPC 结果）；`anyOf`：等最快的一个完成（竞赛模式，取最快响应）。注意 `allOf` 返回 `CompletableFuture<Void>`，需要分别 `get()` 每个子 Future 拿结果。
- **Q：虚拟线程（JDK 21 VirtualThread）会改变 CompletableFuture 的使用方式吗？**
  → 有一定影响：虚拟线程是轻量级的（数百万个也 OK），I/O 阻塞时不占用 OS 线程。所以用虚拟线程池替代 commonPool 后，I/O 密集型任务也不用担心线程数不够——但虚拟线程有其他限制（synchronized 与 native 方法会 pin 住 carrier 线程）。

## 我的记法

- **commonPool 线程数 = CPU核数 - 1**，I/O 密集型一定要指定自定义池
- commonPool 是 JVM 全局共享，不同业务会互相抢
- `*Async` 方法不指定 Executor = 默认 commonPool = 危险
- 链式 thenApplyAsync 也要指定 pool，别偷懒
- **异常一定要 exceptionally/handle 捕获**，否则被吞
- 一句话：**「CompletableFuture 一定要传自定义 Executor，I/O 任务用 commonPool 是等死」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答链式操作线程选择的追问
