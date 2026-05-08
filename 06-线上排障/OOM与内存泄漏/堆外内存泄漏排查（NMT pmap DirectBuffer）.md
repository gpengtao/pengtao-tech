---
tags: [P1, Java方向, 生疏]
相关: "[[02-Java后端核心/JVM与GC/OOM 排查路径]]"
---

# 堆外内存泄漏排查（NMT / pmap / DirectBuffer）

## 一句话速记

堆外内存泄漏**不体现在 heap dump 里**——Xmx 设了 4G，top 看 RES 却 8G 且持续增长。三类排查工具：① **NMT**（JVM 内部视角，看 JVM 管理的堆外内存分区）；② **pmap**（OS 视角，看进程真实内存映射）；③ **jemalloc/jeprof**（malloc 级别追踪，定位 native 调用栈）。

## 通俗解释（5 分钟版）

```
Java 进程的内存 ≠ -Xmx 设的堆大小

-Xmx 4G ──────┐
               ├── 堆内（heap dump 能看到）
               │
               ├── Metaspace（类元信息）
               ├── DirectByteBuffer（NIO/Netty 堆外缓冲）
               ├── Thread stacks（每个线程 1M 默认）
               ├── JNI / Native 代码分配的（JNI 调用 malloc）
               ├── JVM 自身（CodeCache、GC 数据结构等）
               └── mmap 文件映射

堆外总内存 ≈ RES - Xmx，正常 1-2G。如果这个差值持续增长 → 堆外泄漏
```

## 关键细节

### 三层排查法：从现象到根因

#### 第一层：确认是堆外泄漏（排除堆内）

```bash
# top 看 RES（实际物理内存）
top -p <pid>    # RES 列
# 对比 -Xmx：RES 比 Xmx 大 2G+ 且持续增长 → 大概率堆外泄漏

# jstat 确认堆内正常
jstat -gc <pid> 1s
# EU/OU（Eden/Old 使用率）在正常范围 → 进一步确认是堆外
```

#### 第二层：NMT 定位是 JVM 哪块堆外

```bash
# 1. 开启 NMT（需要重启 JVM）
-XX:NativeMemoryTracking=summary
# 或 detail（更详细，开销更大）
-XX:NativeMemoryTracking=detail

# 2. 建立基线
jcmd <pid> VM.native_memory baseline

# 3. 等一段时间后看增量
jcmd <pid> VM.native_memory summary.diff
```

**NMT 输出解读**：

```
类别                    含义                        泄漏嫌疑
────────────────────────────────────────────────────────────
Java Heap              堆内（-Xmx 控制）           ✗ NMT 不管
Class                  Metaspace + 类元数据         ✓ 动态代理泄漏
Thread                 线程栈内存                    ✓ 线程数持续增长
Code                   JIT 编译后的 CodeCache       ✗ 一般稳定
GC                     GC 数据结构                  ✗ 一般稳定
Internal               DirectByteBuffer + NIO       ✓✓ Netty 没释放
Symbol                 符号表                       ✗
Native Memory Tracking NMT 自身开销                ✗
Arena Chunk            Glibc malloc arena           ✗
```

**重点看 Internal 和 Class**：
```
Internal 增长  → DirectByteBuffer 泄漏
             → Netty/Undertow 的 ByteBuf 没 release
             → NIO Channel 没 close

Class 增长     → Metaspace 泄漏
             → CGLib/动态代理类无限生成
```

#### 第三层：pmap/jemalloc 定位到代码

**NMT 只能告诉你"哪类堆外"，不能告诉你"哪行代码"。需要更底层的工具**：

```bash
# pmap：看进程内存映射分布
pmap -x <pid> | sort -k 3 -n -r | head -20
# 关注 RSS 列（实际物理内存），找异常大的匿名内存块

# 如果有大量 64M 的 anon 块 → 典型的 malloc arena
# 每个线程创建时 glibc 分配一个 arena → 线程数过多
# export MALLOC_ARENA_MAX=2  可以限制 arena 数量
```

**jemalloc + jeprof（最精确但最复杂）**：

```bash
# 用 jemalloc 替代 glibc malloc，追踪内存分配
LD_PRELOAD=/usr/lib/libjemalloc.so
export MALLOC_CONF="prof:true,lg_prof_interval:30,lg_prof_sample:17"

# 生成 heap profile，用 jeprof 分析
jeprof --show_bytes --pdf /usr/bin/java jeprof.*.heap > leak.pdf

# 可以看到每个 malloc 调用栈，定位到 native 代码行
```

### 常见堆外泄漏场景及排查

#### 场景 1：Netty DirectByteBuffer 未释放

```bash
# 症状：NMT Internal 持续增长
# 验证：
jcmd <pid> VM.native_memory summary | grep Internal -A 5

# Arthas 监控 direct buffer：
memory | grep direct

# 根因：ByteBuf.retain() 后没 release()、pipeline 异常时没在 finally 释放
```

#### 场景 2：线程数失控 → 线程栈吃掉内存

```bash
# 默认每个线程栈 1M，1000 个线程 = 1G 堆外
jstack <pid> | grep '^"' | wc -l

# 如果线程数持续增长但线程池有上限 → 可能是线程泄漏
# jstack 看 WAITING 状态的线程名和 stacktrace
```

#### 场景 3：JNI 代码泄漏

```bash
# NMT 上看不到（JNI 直接 malloc 不走 JVM）
# 只能用 pmap / jemalloc 定位
pmap -x <pid> | awk '{sum+=$3} END {print sum " KB total RSS"}'
# 如果 total RSS >> Xmx + Metaspace + thread stacks → JNI 泄漏嫌疑
```

### 排查速查表

```
你观察到什么                         用哪层工具              查什么
─────────────────────────────────────────────────────────────────────
top RES 持续涨但 heap 正常           第一层                    确认堆外
NMT Internal 涨                     第二层                    DirectBuffer 泄漏
NMT Class 涨                        第二层                    Metaspace/代理类泄漏
线程数持续涨                          jstack 数线程            线程泄漏
pmap 大量 64M anon 块               第三层                    malloc arena 过多
NMT 正常但 RES 还在涨                第三层 pmap/jemalloc      JNI 泄漏
```

## 延伸追问

- **Q：NMT 有明显性能开销吗？生产能用吗？**
  → summary 级别约 5% 开销，生产可以开。detail 级别开销更大，只在排障时开。关键是：**要先开才能用**，临时加参数没用。
- **Q：`pmap -x` 看到的 RSS 和 top 的 RES 什么区别？**
  → top RES 是进程总物理内存，pmap RSS 可以拆分到每个内存映射段。pmap 适合定位"哪块映射异常大"，比如发现一个 3G 的 anon 块。
- **Q：为什么关了 `-XX:+DisableExplicitGC` 能缓解 DirectBuffer 泄漏？**
  → DirectBuffer 靠 `Cleaner` + `System.gc()` 回收。如果禁了显式 GC，DirectBuffer 只能等自然 GC——堆很大时就一直得不到回收。改成 `-XX:+ExplicitGCInvokesConcurrent` 比完全禁止更安全。

## 我的记法

- **三层法**：第一层 top vs -Xmx 确认堆外 → 第二层 NMT diff 定位分区 → 第三层 pmap/jemalloc 定位代码
- **NMT 两大嫌疑**：Internal 涨（DirectBuffer 没释放）、Class 涨（代理类泄漏）
- **终极武器**：jemalloc + jeprof，能看到 C 级别的 malloc 调用栈
- 一句话：**「堆外泄漏 heap dump 看不到，用 NMT 分层定位，pmap 做最后确认」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
