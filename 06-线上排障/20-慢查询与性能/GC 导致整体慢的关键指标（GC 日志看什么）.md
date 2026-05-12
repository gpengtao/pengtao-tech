---
tags: [P1, Java方向, 生疏]
相关: "[[02-Java后端核心/JVM与GC/Full GC 的触发条件]]"
---
# GC 导致整体慢的关键指标（GC 日志看什么）

## 一句话速记

判断 GC 是否拖慢服务，看三个关键指标：① **GC 频率**（Young GC > 10 次/分钟 或 Full GC > 1 次/小时 → 关注）；② **GC 停顿时间**（单次 > 200ms → 业务感知，> 1s → 严重）；③ **GC 占用 CPU 比例**（> 10% → 影响吞吐）。开启 GC 日志：`-Xlog:gc*:file=/data/logs/gc.log:time,level,tags`（JDK 9+）或 `-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:/data/logs/gc.log`（JDK 8）。

## 通俗解释（5 分钟版）

```
GC 日志就像是汽车的油耗记录：

Young GC 频繁     = 发动机频繁换挡（对象创建太快，新生代太小）
  → 1 秒 10 次 Young GC → GC 消耗 30% CPU → 业务吞吐下降 30%

Full GC           = 发动机大修（全车停机）
  → 一次 Full GC 2 秒 → 所有请求卡 2 秒 → P99 飙高

并发 GC 阶段      = 一边开车一边修（CMS/G1 的并发标记）
  → 不 STW，但和业务线程抢 CPU → 吞吐下降
```

**关键认知**：GC 不是"有 GC 就有问题"，而是"GC 占用了多少 CPU 和停顿时间"。少量 GC 是正常的，只有频率/时长超出阈值才需要关注。
```

## 关键细节

### GC 日志配置

**JDK 8**：

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintGCTimeStamps
-XX:+PrintGCApplicationStoppedTime    # 打印每次 STW 的停顿时间
-XX:+PrintGCDistribution              # 打印各代对象分布（G1）
-Xloggc:/data/logs/gc-%t.log          # %t=pid，防止多进程覆写
-XX:+UseGCLogFileRotation             # 日志轮转
-XX:NumberOfGCLogFiles=10
-XX:GCLogFileSize=100M
```

**JDK 9+（统一日志）**：

```bash
-Xlog:gc*=info:file=/data/logs/gc.log:time,level,tags:filecount=10,filesize=100M
# gc*    = 所有 GC 相关日志
# info   = 日志级别
# time,level,tags = 输出时间、级别、标签
```

### 如何阅读 GC 日志

#### Young GC（G1 示例）

```
[2024-01-15T14:30:25.123+0800] GC(42) Pause Young (Normal) (G1 Evacuation Pause) 256M->128M(1024M) 12.345ms
[2024-01-15T14:30:25.123+0800] GC(42) User=0.02s Sys=0.01s Real=0.01s

解读：
  GC(42)                = 第 42 次 GC
  Pause Young (Normal)  = Young GC，STW
  256M->128M(1024M)     = GC 前堆使用 256M → GC 后 128M（总堆 1024M）
                         → 回收了 128M
  12.345ms              = STW 停顿时间 ← 关键指标！
  User/Sys/Real         = CPU 时间（多核）/ 系统调用 / 实际耗时
```

#### Full GC（G1 Full GC 示例）

```
[2024-01-15T14:35:10.456+0800] GC(50) Pause Full (G1 Evacuation Pause) 980M->400M(1024M) 2456.789ms
                           ↑↑↑↑ Full GC，停顿 2.4 秒！严重！
```

#### Mixed GC（G1 特有）

```
[2024-01-15T14:32:10.789+0800] GC(45) Pause Young (Mixed) (G1 Evacuation Pause) 512M->256M(1024M) 45.678ms
                                               ↑↑↑↑↑ Mixed：同时回收 Young + 部分 Old
```

### 关键指标和阈值

```
指标                          正常范围        预警              严重
─────────────────────────────────────────────────────────────────────
Young GC 频率                 1-5 次/分钟     > 10 次/分钟       > 30 次/分钟
Young GC 单次停顿             10-50ms         > 100ms            > 500ms
Full GC 频率                  0-1 次/天       > 1 次/小时        > 1 次/分钟
Full GC 单次停顿              < 1s            > 2s               > 5s
Mixed GC 单次停顿（G1）       20-100ms        > 200ms            > 500ms
GC 后 Old 区回收比例          正常 GC 后      每次 Full GC 后    Full GC 后回收
                              明显下降        回收 < 5%          < 2%
                                             
GC CPU 占比（总 CPU）          < 5%            > 10%              > 20%
```

### 使用 GC 日志分析工具

**GCeasy（在线分析，最推荐）**：

```bash
# 上传 gc.log 到 https://gceasy.io
# 自动生成报告，包括：
#   - GC 停顿统计（P50/P99/P99.9）
#   - GC 时间线视图
#   - 各代内存使用趋势
#   - GC 原因分布
#   - 优化建议
```

**GCEasy 关键图表解读**：

```
1. GC Timeline（GC 时间线）：
   横轴时间，每个点 = 一次 GC
   点越密集 → GC 越频繁
   点越高（停顿长）→ GC 越重

2. GC Pause Duration Percentile：
   P99 停顿 = 200ms → 1% 的 GC 停顿超过 200ms
   → 对应 1% 的请求会卡 200ms+

3. Memory Usage：
   绿色（Young）波峰波谷正常
   红色（Old）单调上升不降 → 泄漏！

4. GC Cause Distribution：
   Allocation Failure 占 95% → 正常（对象分配触发 Young GC）
   System.gc() 占 5% → 有人在代码里调了 System.gc()
```

### 通过 GC 日志诊断常见问题

**问题 1：Young GC 太频繁**

```
GC 日志特征：每秒多次 Young GC，停顿 5-10ms 但次数多
根因：新生代太小 或 对象创建太快
验证：jstat -gc <pid> 看 Eden 区大小和使用率
解法：调大 -XX:NewRatio（或 -Xmn）+ 业务侧减少对象创建
```

**问题 2：Full GC 越来越频繁**

```
GC 日志特征：Full GC 间隔越来越短
根因：内存泄漏，Old 区可用空间越来越少
验证：看每次 Full GC 后 Old 使用量（OU），不降或降得越来越少 → 泄漏
解法：heap dump → MAT 找泄漏对象 → 修复
```

**问题 3：大对象直接进 Old 区（Humongous Allocation，G1）**

```
GC 日志特征：
  Pause Young (Normal) (G1 Humongous Allocation)
  → 对象大小 > G1 region 的 50%
  → 直接分配到 Old 区的 Humongous region

根因：创建了超过 Region 大小一半的大对象（如大 byte[]、大 List）
解法：业务侧拆分大对象，或增大 G1HeapRegionSize
```

## 延伸追问

- **Q：GC 日志和 jstat 看什么区别？**
  → jstat 看实时快照（当前各代使用率），GC 日志看历史趋势（过去所有 GC 的停顿和回收量）。排查历史问题用 GC 日志，实时监控用 jstat。
- **Q：GC 日志一直开着有性能影响吗？**
  → 几乎没有（< 1%），而且是排查 GC 问题的唯一办法。**生产环境必须标配 GC 日志**。
- **Q：G1 的 Mixed GC 和 Full GC 怎么区分？**
  → 看日志里的关键词：`Pause Young (Mixed)` = Mixed GC（回收 Young + 部分 Old，停顿可控）。`Pause Full` = Full GC（单线程回收整个堆，停顿长，严重）。Mixed GC 正常，Full GC 要关注。

## 我的记法

- **三个关键指标**：GC 频率、停顿时间、CPU 占比
- **一定要开的 JVM 参数**：`-Xlog:gc*:file=gc.log:time,level,tags` + `HeapDumpOnOutOfMemoryError`
- **GCeasy 三板斧**：GC Timeline 看频率 → Pause Percentile 看影响 → Memory Usage 看泄漏
- 一句话：**「GC 日志是 JVM 的体检报告——没开日志就等于闭着眼睛开车」**

## 参考资料
- GCeasy：https://gceasy.io
- G1 GC Tuning：https://docs.oracle.com/javase/9/gctuning/

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
