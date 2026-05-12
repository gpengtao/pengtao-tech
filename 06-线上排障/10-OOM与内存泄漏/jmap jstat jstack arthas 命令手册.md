---
tags: [P1, Java方向, 生疏]
相关: "[[02-Java后端核心/JVM与GC/CPU 100% 完整排查命令序列]]"
---
# jmap / jstat / jstack / arthas 命令手册

## 一句话速记

四大排障命令的定位：**jstat**（看 GC 实时状态，快速判断"是否在 GC 中"）；**jstack**（看线程在干什么，找死锁/阻塞/Waiting）；**jmap**（dump 堆内存，离线分析泄漏，注意会 STW）；**arthas**（在线诊断，不中断服务，jstack+jmap+jstat 的增强整合版）。

## 通俗解释（5 分钟版）

```
四个命令的分工：

jstat   = 心电监护仪     看 GC 频率/耗时/各代使用率，实时刷
jstack  = 抓拍           看此刻每个线程在什么方法里、什么状态
jmap    = 抽血化验       把整个堆 dump 下来离线分析（有创伤，会 STW）
arthas  = ICU 综合监护   能在线看内存、线程、方法耗时，不用抽血
```

**使用优先级**：先 jstat/jstack 做快判断 → 不行再 jmap dump → arthas 是替代品，能用 arthas 优先用 arthas。

## 关键细节

### 1）jstat — GC 实时监控

```bash
# 基本格式：jstat -<option> <pid> <interval_ms> <count>

# 最常用：看 GC 统计（每秒输出一次，共 10 次）
jstat -gc <pid> 1000 10

# 输出列解读（关键列）：
# S0C/S1C  = Survivor 0/1 容量
# S0U/S1U  = Survivor 0/1 使用量
# EC       = Eden 容量
# EU       = Eden 使用量      ← Eden 用满 → 触发 Young GC
# OC       = Old 容量
# OU       = Old 使用量       ← Old 持续增长不降 → 泄漏！
# MC/MU    = Metaspace 容量/使用量
# YGC/YGCT = Young GC 次数/总耗时
# FGC/FGCT = Full GC 次数/总耗时  ← FGC 频繁 → 堆不够或泄漏
# GCT      = GC 总耗时

# 关键判断：
# OU 单调增长 + FGC 后不降  → 内存泄漏
# FGC 频繁（每秒几次）+ FGCT 很长 → 堆太小
# EU 频繁打满                → 对象创建太快，调大新生代或业务优化
```

```bash
# 看 GC 原因（JDK 8+）
jstat -gccause <pid> 1000
# LGCC = 上次 GC 原因
# GCC  = 当前 GC 原因（Allocation Failure / System.gc() / ...）
```

**生产判断口诀**：
```
OU 一直涨不降 → 泄漏，dump
FGC 频繁 + FGCT 长 → 堆不够，加 Xmx 或找泄漏
YGC 太频繁（每秒几十次）→ 新生代太小
```

### 2）jstack — 线程快照

```bash
# 基本用法
jstack <pid> > thread.dump
jstack -l <pid> > thread.dump   # 额外打印锁信息

# 快速统计线程状态
jstack <pid> | grep "java.lang.Thread.State" | sort | uniq -c

# 找 CPU 最高的线程
top -H -p <pid>                  # 找 CPU 最高的线程 ID（十进制）
printf "%x\n" <tid>              # 转十六进制
jstack <pid> | grep -A 20 <hex>  # 在线程 dump 里搜索
```

**线程状态解读**：

```
状态                    含义                        值得担心？
──────────────────────────────────────────────────────────────
RUNNABLE                正在执行（或等待 CPU）        看 CPU 是否高
BLOCKED                 等待 synchronized 锁         是！有锁竞争
WAITING (parking)       调了 LockSupport.park()      看数量，大量 → 线程池不够
WAITING (object.wait)   调了 Object.wait()           看是否永久等
TIMED_WAITING (sleep)   Thread.sleep()               正常
TIMED_WAITING (park)    LockSupport.parkNanos()      正常（如空闲连接池线程）
```

**死锁检测**：
```bash
jstack -l <pid> | grep -A 5 "deadlock"
# 如果存在死锁，jstack 会直接打印出来
# Found one Java-level deadlock:
#   "thread-A": waiting to lock monitor 0x... (held by "thread-B")
#   "thread-B": waiting to lock monitor 0x... (held by "thread-A")
```

### 3）jmap — 堆 dump

```bash
# 生成 heap dump（会 STW！）
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>
# live: 先 Full GC 再 dump（文件更小、只含活对象）
# 不用 live: 包含垃圾对象（更全面但文件更大，不触发 GC）

# 看堆配置和使用概览
jmap -heap <pid>
# 输出：各代大小、使用率、GC 算法等

# 看类统计（轻量级，不 STW）
jmap -histo <pid> | head -30
jmap -histo:live <pid> | head -30  # live 会触发 Full GC

# 注意：jmap -histo 是轻量操作，不 STW
# jmap -dump 和 jmap -histo:live 会 STW
```

**生产环境的 dump 策略**：

```bash
# 策略 1：自动 dump（推荐）
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/dump/

# 策略 2：用 arthas 代替 jmap（功能相同，更方便）
arthas> heapdump --live /tmp/heap.hprof

# 策略 3：不在高峰时段手动 jmap（STW 影响请求）
# 如果必须手动 dump：选低峰期，提前通知
```

### 4）Arthas — 在线诊断平台

```bash
# 启动
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar          # 选择 Java 进程

# 核心命令速查：
```

| 命令 | 作用 | 等价/替代 |
|------|------|-----------|
| `dashboard` | 实时面板（线程+内存+GC） | jstat+jstack 的实时版 |
| `thread` | 线程列表 + CPU 使用率 | jstack 增强版 |
| `thread -n 3` | CPU 最高的 3 个线程 | top -H + jstack 整合 |
| `thread -b` | 找死锁/阻塞线程 | jstack -l |
| `jad <类名>` | 反编译线上代码 | 无 jdk 等价命令 |
| `watch <类> <方法> '{params,returnObj}'` | 观察方法入参和返回值 | 无侵入埋点 |
| `trace <类> <方法>` | 打印方法调用耗时树 | SkyWalking 的精简版 |
| `heapdump --live /tmp/a.hprof` | dump 堆 | jmap -dump |
| `memory` | 内存使用概览（含堆外） | jmap -heap + NMT 整合 |
| `classloader -l` | ClassLoader 统计 | jcmd VM.classloader_stats |
| `vmtool --action getInstances -c <类>` | 在线查某个类的所有实例 | MAT Histogram |
| `logger --name ROOT --level DEBUG` | 在线改日志级别 | 无需重启 |
| `retransform <类> <class文件>` | 热替换 class 文件 | 无需重启 |

**Arthas vs 传统命令**：
```
场景                     传统命令                     arthas
──────────────────────────────────────────────────────────────
看 GC 实时状态            jstat -gc 1s                dashboard
看线程 CPU               top -H + jstack             thread -n 3
dump 堆                  jmap -dump:live             heapdump
找某个类的实例            jmap -histo + MAT           vmtool --action getInstances
看方法调用耗时            无（需埋点/全链路）          trace
改日志级别               改配置 + 重启               logger
```

## 延伸追问

- **Q：生产环境 arthas 安全吗？**
  → arthas 自身有少量 CPU 开销（< 5%），大部分命令是安全的。但 `heapdump` 会 STW（和 jmap 一样），`retransform` 可能引起类加载问题。**核心原则**：看可以，改要谨慎。
- **Q：`jmap -dump:live` 和 `jmap -dump`（不加 live）怎么选？**
  → 加 `live`：先 Full GC 再 dump，文件小、只含活对象，但有 STW。不加 `live`：直接 dump，包含垃圾对象，无额外 GC。排查泄漏用 `live`（只看活对象就够了），排查"为什么突然 OOM 但没泄漏"用不加 `live`（可能短暂的大量临时对象是根因）。
- **Q：jstack 显示大量 `WAITING (parking)` 正常吗？**
  → 看线程名。如果是线程池的 idle 线程（如 `pool-1-thread-5`）→ 正常，在等任务。如果是业务线程一直 parking → 看谁在 park 它，可能是锁/信号量/CountDownLatch 没释放。

## 我的记法

- **jstat** = GC 监视器，`-gc` 看 OU 涨不涨
- **jstack** = 线程照相机，`grep BLOCKED/WAITING` 看是否有问题
- **jmap** = 堆抽血，`-dump:live` 离线分析（有 STW 代价）
- **arthas** = 综合 ICU，优先用 `dashboard` `thread` `heapdump` 三件套
- 一句话：**「jstat 先看有没有病，jstack 看线程在干嘛，jmap/arthas heapdump 做深度诊断」**

## 参考资料
- Arthas 官方文档：https://arthas.aliyun.com/doc/
- MAT 官方文档：https://help.eclipse.org/latest/topic/org.eclipse.mat.ui.help/welcome.html

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
