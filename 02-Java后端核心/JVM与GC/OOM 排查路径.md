---
tags: [P0, Java方向, 生疏]
相关: "[[02-Java后端核心/index]]"
---

# OOM 排查路径（堆内 / 堆外 / Metaspace / DirectBuffer）

## 一句话速记

**OOM 分 4 类，错误信息和工具不一样**：① `Java heap space`——堆内对象，用 heap dump + MAT 找大对象/泄漏；② `Metaspace`——类太多（动态代理/Groovy），用 `classloader` 统计类数量；③ `Direct buffer memory`——NIO 堆外，用 NMT 或 `-XX:MaxDirectMemorySize` 限制；④ `unable to create native thread`——线程数溢出，减线程/加 ulimit。**核心思路**：先看错误类型定方向，再找分配路径。

## 通俗解释（5 分钟版）

JVM 内存分多块，OOM 发生在哪块，错误信息不同：

```
OOM 类型                               错误信息关键词
──────────────────────────────────────────────────────────
堆内对象泄漏                           java.lang.OutOfMemoryError: Java heap space
Metaspace（类太多）                    java.lang.OutOfMemoryError: Metaspace
堆外 NIO（DirectByteBuffer）           java.lang.OutOfMemoryError: Direct buffer memory
堆外（native 内存，JNI 等）           java.lang.OutOfMemoryError: native memory exhausted
线程创建失败                           java.lang.OutOfMemoryError: unable to create new native thread
栈深度溢出（不算 OOM，是 SOE）        java.lang.StackOverflowError
```

## 关键细节

### 1）堆内 OOM（Java heap space）

**最常见**。根因分两类：

**a) 真的内存不够（短暂大流量）**：
```
现象：OOM 后 heap dump 显示大量 "合理" 对象，没有单一超大 retained
解法：加机器/加内存/-Xmx；或分析是否能减少对象创建
```

**b) 内存泄漏（逻辑bug）**：
```
现象：Old 区持续增长，每次 Full GC 后 Old 水位不降，最终 OOM
解法：heap dump 分析 retained heap 最大路径
```

**排查步骤**：

```bash
# 步骤 1：触发 OOM 时自动 dump（加 JVM 参数）
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/tmp/heap.hprof

# 步骤 2：手动 dump（不 OOM 时诊断）
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>
# 注意：live 会先触发一次 Full GC，STW！生产用要小心

# 步骤 3：用 MAT（Eclipse Memory Analyzer）分析
# 关注：
# - Retained Heap 最大的对象/类
# - GC Root 到大对象的引用链（找是谁持有）
# - Leak Suspects（MAT 自动分析报告）

# 步骤 4：Arthas 在线分析（不产生 dump 文件）
heapdump --live /tmp/heap.hprof   # 同 jmap -dump:live
```

**常见泄漏场景**：
- `ThreadLocal` 未 `remove()`（线程池复用线程，ThreadLocal 值一直在）
- 静态 `Map/List/Cache` 无限增长（没有过期策略）
- 监听器/回调注册了但没取消注册
- `Session`/请求上下文对象生命周期比预期长

### 2）Metaspace OOM

**特征**：Metaspace 里装的是类的元信息，类太多时 OOM。

```bash
# 方法 1：Arthas 统计类加载数量
classloader -l      # 看各 ClassLoader 加载的类数量
classloader -t      # 打印 ClassLoader 树形结构
sc -c <classloader_hash> <ClassName>  # 查某个类是否被加载

# 方法 2：JVM 命令
jcmd <pid> VM.classloader_stats  # 各 ClassLoader 加载类数量

# 方法 3：看 JVM 参数是否限制了 Metaspace
-XX:MaxMetaspaceSize=256m   # 如果设得太小也会 OOM
```

**常见根因**：
```
CGLib 动态代理代码逻辑错误  → 每次请求都生成新的代理类
Groovy/Janino 动态脚本编译  → 每次执行生成新 class，没有缓存
JSP 热编译                  → 每次改 JSP 就加载新版本类
OSGi bundle 频繁加载/卸载   → 类加载器泄漏
```

**解法**：
```bash
# 找到哪个 ClassLoader 一直在增长
# 检查动态代理/脚本引擎是否有类缓存机制
# 使用弱引用缓存或有上限的缓存
-XX:MaxMetaspaceSize=512m    # 至少设上限，避免无限膨胀吃掉系统内存
```

### 3）Direct Buffer Memory OOM

**特征**：NIO、Netty 等使用堆外内存（`DirectByteBuffer`），不走 Java 堆 GC。

```
Java 堆外内存（Native Memory）不受 -Xmx 控制
DirectByteBuffer 的 GC 回收依赖 JVM GC 时触发 Cleaner
如果 GC 不频繁（堆很大），DirectByteBuffer 长期不回收 → OOM
```

**排查**：

```bash
# 方法 1：监控 NIO 堆外内存
# Java 提供 MXBean 查看
BufferPoolMXBean pool = ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)
    .stream().filter(b -> b.getName().equals("direct")).findFirst().get();
System.out.println(pool.getMemoryUsed());  // 当前使用量

# 方法 2：用 NMT（Native Memory Tracking）
-XX:NativeMemoryTracking=summary   # 追踪原生内存（有性能开销，约 5-10%）
jcmd <pid> VM.native_memory summary  # 查看各类型原生内存使用

# 方法 3：Arthas
memory     # 打印所有内存区域使用情况，包含 direct 堆外
```

**解法**：
```bash
# 设 DirectMemory 上限
-XX:MaxDirectMemorySize=512m

# 如果禁用了 System.gc()，DirectBuffer 可能泄漏
# 改成 +ExplicitGCInvokesConcurrent 而不是 +DisableExplicitGC

# Netty 堆外内存监控：
# io.netty.util.internal.PlatformDependent#usedDirectMemory()
```

### 4）Unable to create new native thread

**特征**：线程数超出系统/进程限制。

```bash
# 排查：先看系统线程限制
ulimit -u              # 当前用户最大进程/线程数
cat /proc/<pid>/status | grep Threads  # 当前进程线程数
cat /proc/sys/kernel/pid_max           # 系统最大 PID

# 查 Java 线程数
jstack <pid> | grep '^"' | wc -l      # 估算线程数
jcmd <pid> Thread.print | grep 'java.lang.Thread.State' | wc -l
```

**常见根因**：
```
线程池配置错误（maxPoolSize 过大，线程泄漏）
每个请求创建新线程（忘记复用线程池）
线程 park/wait 永远不回收
```

**解法**：
```bash
# 查所有活跃线程
jstack 看 WAITING 线程的 stacktrace，找是什么在 park 不退出

# 典型修复
减小线程池 maxPoolSize
修复线程泄漏（线程执行完后没有正常退出）
```

### 5）OOM 排查速查表

```
错误信息                         排查方向              主要工具
────────────────────────────────────────────────────────────────────
Java heap space                  heap dump + 泄漏分析   MAT / Arthas heapdump
Metaspace                        ClassLoader 类数量      classloader 命令
Direct buffer memory             NIO/Netty 堆外使用量    NMT / Arthas memory
unable to create native thread   线程数 / ulimit         jstack 线程数
GC overhead limit exceeded       GC 占用 CPU > 98%      等同 heap space 泄漏
```

## 延伸追问

- **Q：OOM 时 JVM 自动 dump 会影响生产服务吗？**
  → `HeapDumpOnOutOfMemoryError` 触发时 JVM 会 STW 把堆内存写入文件。16G 堆可能需要 30-60 秒，期间服务完全不可用。但 OOM 发生时服务往往已经不正常了，利大于弊。**注意**：确保磁盘有足够空间（dump 文件 ≈ 堆大小）。
- **Q：用 Arthas `heapdump` 和 `jmap -dump` 有什么区别？**
  → 功能相同，都会触发 Full GC。`arthas heapdump` 更方便不用切换工具。如果不想 Full GC，可以用 `-XX:+HeapDumpBeforeFullGC` 在 GC 前自动 dump，或用 `jmap -dump:format=b`（不加 `live`）不触发 GC 但包含垃圾对象。
- **Q：`GC overhead limit exceeded` 是什么？**
  → JVM 检测到"GC 耗时超过 98% 但只回收了 < 2% 的堆"，会抛这个 OOM。本质还是 heap 不够。处理方式和 `Java heap space` 相同——heap dump 分析。

## 我的记法

- **4 类 OOM**：heap space（泄漏/不够）/ Metaspace（类太多）/ DirectBuffer（NIO 堆外）/ 线程数溢出
- **堆内 OOM**：`-XX:+HeapDumpOnOutOfMemoryError` + MAT 分析 retained heap
- **Metaspace**：Arthas `classloader -l` 看类数量增长
- **DirectBuffer**：`-XX:MaxDirectMemorySize` 限制 + NMT 监控
- **线程溢出**：`jstack | grep '^"' | wc -l` 数线程数，找 park 不退出的线程
- 一句话：**「OOM 先看错误信息定类型，再选对应工具找分配路径」**

## 状态
- [ ] 已背速记（4 类 OOM 及工具）
- [ ] 能讲通俗版
- [ ] 能答追问
