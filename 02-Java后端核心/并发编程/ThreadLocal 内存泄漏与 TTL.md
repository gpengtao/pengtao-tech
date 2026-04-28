---
tags: [P0, Java方向, 生疏]
相关: [[02-Java后端核心/_MOC]]
---

# ThreadLocal 内存泄漏与 InheritableThreadLocal / TransmittableThreadLocal

## 一句话速记

**ThreadLocal 内存泄漏根因**：`ThreadLocalMap` 的 Entry 是**弱引用 Key（ThreadLocal 对象）+ 强引用 Value**——ThreadLocal 对象没有强引用时 Key 被 GC 回收变 `null`，但 Value（通常是业务对象）仍被 Entry 强引用，无法回收，**在线程池里线程不销毁时永久泄漏**。**解法**：用完必须 `threadLocal.remove()`。**InheritableThreadLocal（ITL）**：子线程能继承父线程的值（new Thread 时复制）；**TransmittableThreadLocal（TTL，阿里开源）**：线程池场景下传递上下文（Runnable 提交时复制，执行前恢复）。

## 通俗解释（5 分钟版）

**ThreadLocal 的存储结构**：

```
Thread 对象
  └── ThreadLocal.ThreadLocalMap threadLocals
        └── Entry[] table
              ├── Entry { WeakRef(ThreadLocal1), value1 }
              ├── Entry { WeakRef(ThreadLocal2), value2 }
              └── ...
```

**为什么用弱引用 Key**：
- 避免"ThreadLocal 对象自己没有引用了，但 Map 里还有强引用导致它无法 GC"
- 弱引用：Key 所指的 ThreadLocal 可以被 GC 回收

**内存泄漏的链路**：

```
ThreadLocal tl = new ThreadLocal();
tl.set(largeObject);          // Entry: WeakRef(tl) → largeObject
tl = null;                    // tl 不再被任何强引用指向
GC → WeakRef(tl) 被回收 → Entry.key = null

但 Entry 仍在 Map 里！
Entry: null → largeObject（Value 强引用）

线程池里线程不销毁：
  ThreadLocalMap 一直活着 → Entry 一直活着 → largeObject 永远不被 GC
  = 内存泄漏
```

**解法**：

```java
ThreadLocal<UserContext> contextHolder = ThreadLocal.withInitial(() -> null);

try {
    contextHolder.set(context);
    doWork();
} finally {
    contextHolder.remove();  // ← 必须 remove！
}
```

**注意**：ThreadLocal 自身的 `get()/set()/remove()` 会顺手清理 stale entries（key=null 的）——但不能依赖这个：如果该 ThreadLocal 之后不再访问，stale entries 就不会被清理。

## 关键细节

### 1）线程池场景的问题（更严重）

```
普通 new Thread：
  线程执行完任务退出 → Thread 对象销毁 → ThreadLocalMap 销毁
  → 即使不 remove，泄漏是临时的

线程池（ThreadPoolExecutor）：
  线程反复复用，不销毁 → ThreadLocalMap 一直存在
  → 不 remove：①内存泄漏（值积累） ②数据污染（下一个任务读到上一个任务的值！）
  
数据污染更危险：
  请求 A 把 userId=1 塞入 ThreadLocal
  请求 A 完成，线程归还到线程池（没有 remove）
  请求 B 拿到同一线程，执行 threadLocal.get() → 读到 userId=1（本该是 B 的 userId=2）！
```

### 2）InheritableThreadLocal（ITL）

```java
// ITL：子线程创建时，复制父线程的 inheritableThreadLocals
ThreadLocal<String> itl = new InheritableThreadLocal<>();
itl.set("parent-value");

new Thread(() -> {
    System.out.println(itl.get());  // 输出 "parent-value"
}).start();
```

**问题**：
```
线程池场景：子线程是池中预先创建好的，不是当前"父线程"创建的
→ ITL 的复制发生在线程创建时（池子启动时），不是任务提交时
→ 线程池里的线程无法获取提交任务的线程的上下文！
```

### 3）TransmittableThreadLocal（TTL，阿里开源）

**解决线程池场景的上下文传递**：

```java
// 原理：在 Runnable/Callable 提交时"打包"当前线程的 TTL 值
//       在线程池线程执行任务时"解包"恢复
TransmittableThreadLocal<String> ttl = new TransmittableThreadLocal<>();
ttl.set("main-thread-value");

ExecutorService pool = TtlExecutors.getTtlExecutorService(
    Executors.newFixedThreadPool(2)  // 包装一下
);

pool.submit(() -> {
    System.out.println(ttl.get());  // 输出 "main-thread-value"（即使是线程池）
});
```

**实现原理**：

```
提交任务时（TtlRunnable.get()）：
  1. 捕获当前线程所有 TTL 值的快照
  2. 包装成 TtlRunnable

执行任务时（run() 前）：
  1. 把快照恢复到当前线程的 TTL
  2. 执行业务逻辑
  
执行完成后（run() 后）：
  1. 清理/还原当前线程的 TTL（避免污染下一个任务）
```

**典型使用场景**：微服务链路追踪、用户身份上下文、MDC 日志（在线程池场景传递 traceId）。

### 4）三者对比

```
                  ThreadLocal   ITL                TTL（阿里）
──────────────────────────────────────────────────────────────────
子线程继承父值    不支持         new Thread 创建时  任务提交时传递
线程池场景        不传递         不传递（时机不对）  支持传递
内存泄漏风险      有（不 remove）有（不 remove）     有（TtlRunnable 自动处理）
是否需要修改池   不需要         不需要             需要包装（TtlExecutors）
使用方           JDK 内置       JDK 内置           阿里 transmittable-thread-local
```

### 5）Spring 中的应用

```java
// Spring Security 的 SecurityContextHolder 就是基于 ThreadLocal
// Spring MVC RequestContextHolder 也是
// → 这些在线程池/异步场景里都要特别注意

// Spring 的 @Async 会用新线程（线程池），ThreadLocal 值不会自动传递
// 解法：
// 1. 自定义 TaskDecorator（Spring 提供的钩子）
// 2. 用 TTL 包装线程池
@Bean
public TaskExecutor asyncExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setTaskDecorator(runnable -> {
        // 在当前线程（提交线程）捕获上下文
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        return () -> {
            try {
                // 在工作线程恢复上下文
                RequestContextHolder.setRequestAttributes(attrs);
                runnable.run();
            } finally {
                RequestContextHolder.resetRequestAttributes();
            }
        };
    });
    return executor;
}
```

## 延伸追问

- **Q：ThreadLocal 如果不 set，直接 get 会泄漏吗？**
  → 不会，没有 Entry 就没有泄漏。泄漏发生在 `set()` 了 → ThreadLocal 引用断了 → Entry.key=null 但 value 还在。
- **Q：为什么 Entry 不用强引用 Key？**
  → 如果 Key 是强引用，ThreadLocal 对象即使没有业务代码引用了，Map 里还有强引用，永远不会被 GC。弱引用 Key 确保 ThreadLocal 可以被 GC，只是 Value 可能泄漏。这是"两害取其轻"——泄漏的是 Value 而不是 ThreadLocal（ThreadLocal 通常是 static 的，其实不会 GC）。
- **Q：`remove()` 和 `set(null)` 有什么区别？**
  → `set(null)` 只是把 value 设为 null，Entry 仍在 Map 里（Key 也在），Entry 没被清理；`remove()` 是把整个 Entry 从 Map 里删掉。推荐用 `remove()`。

## 我的记法

- **内存泄漏链路**：Key 弱引用被 GC（变 null）→ Value 强引用仍在 → 线程池线程不销毁 → 泄漏
- **更危险**：数据污染（线程复用时读到上一请求的值）
- **解法**：用完必须 `threadLocal.remove()`，放在 `finally` 里
- **ITL**：new Thread 时继承，线程池场景不管用
- **TTL**：提交任务时快照 + 执行时恢复，支持线程池——**需要包装 Executor**
- 一句话：**「不 remove 就是定时炸弹——数据污染比内存泄漏更可怕」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答数据污染场景追问
