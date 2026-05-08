---
tags: [P1, Java方向, 生疏]
相关: "[[02-Java后端核心/JVM与GC/OOM 排查路径]]"
---

# OOM 之前的预警指标

## 一句话速记

OOM 不会突然发生，**每次 Full GC 后 Old 区使用率是核心先行指标**。需要监控的五个维度：① Old 区使用率（> 85% 持续 → 报警）；② Full GC 频率（从 1 次/小时变成 1 次/分钟 → 预警）；③ GC 停顿时间（> 500ms → 业务感知）；④ Metaspace 使用率；⑤ DirectBuffer 使用量（NMT）。再加一个兜底：**OOM 前 10 分钟的 heap histogram 自动采集**。

## 通俗解释（5 分钟版）

```
OOM 不是心脏病突发，而是高血压慢慢恶化：

正常状态        Old 区 60-70%，Full GC 偶尔一次，停顿 < 200ms
  ↓
预警状态        Old 区 > 85%，Full GC 频率在变快
  ↓  ← 在这个阶段介入，你还有时间
危险状态        Old 区 > 95%，每次 Full GC 回收 < 5%，停顿 > 1s
  ↓
OOM             堆满了，JVM 抛 OOM
```

**核心洞察**：OOM 之前在监控图上一定能看到趋势变化。关键是**你设了这些监控吗**？

## 关键细节

### 五个必监控指标

#### 1）Old 区使用率

```bash
# jstat 取数
jstat -gc <pid> | awk '{print $8/$7 * 100}'   # OU/OC

# 监控阈值建议：
报警：> 85% 持续 5 分钟
严重：> 95% 持续 2 分钟 → 准备自动 dump

# Prometheus JMX Exporter 配置示例：
- pattern: 'java.lang<name=G1 Old Generation, type=MemoryPool>(.*)usage>(\w+)'
  name: jvm_memory_pool_used_bytes
  labels:
    pool: old_gen
```

**配置自动动作**：
```
Old > 90% 持续 3 分钟 → 自动 jstat -gc 输出到日志
Old > 95% 持续 2 分钟 → 自动 heap histogram（jmap -histo），轻量无 STW
Old > 98%           → 自动 heap dump（-XX:+HeapDumpOnOutOfMemoryError 接管）
```

#### 2）Full GC 频率和趋势

```
正常：1 次/几小时 或 1 次/天
注意：1 次/几分钟
预警：1 次/分钟 且频率在加快
危险：连续 Full GC（两次之间间隔 < 10 秒）

监控什么：
  - FGC 次数增量（delta FGC per minute）
  - 每次 Full GC 的停顿时间（FGCT / FGC 算平均值）
  - 每次 Full GC 后 Old 区回收量（OU 下降幅度）
    → 回收量越来越小 → 泄漏加重
```

#### 3）GC 停顿时间

```
阈值：
  < 200ms  正常，用户无感
  200-500ms  个别接口超时（取决于超时配置）
  > 500ms  报警，高并发下业务受影响
  > 1s     严重，加机器或紧急优化

# G1 关注 Mixed GC 的停顿，不只是 Full GC
# ZGC 停顿一般是 < 10ms，超过 50ms 就要查了
```

#### 4）Metaspace 使用率

```
报警阈值：> 80% MaxMetaspaceSize
不设上限时也要监控（用 jstat MC/MU 列）

# 典型异常模式：
MU 持续增长 → 动态类加载泄漏
MU 在某个操作后跳涨 → 某次操作触发了大量类加载
```

#### 5）堆外 DirectBuffer 使用量

```java
// 应用内暴露指标（推荐）
@RestController
public class MemoryMonitor {
    @GetMapping("/actuator/direct-memory")
    public Map<String, Long> directMemory() {
        long used = ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)
            .stream()
            .filter(b -> "direct".equals(b.getName()))
            .mapToLong(BufferPoolMXBean::getMemoryUsed)
            .sum();
        long max = ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)
            .stream()
            .filter(b -> "direct".equals(b.getName()))
            .mapToLong(BufferPoolMXBean::getTotalCapacity)
            .sum();
        return Map.of("used", used, "capacity", max);
    }
}
```

### OOM 前自动取证

**核心思路**：OOM 发生时你可能不在现场，需要自动留证。

```bash
# JVM 参数：OOM 时自动 dump（兜底）
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/dump/%p-%t.hprof
-XX:+ExitOnOutOfMemoryError          # OOM 后退出（让 k8s 重启）

# 应用层：OOM 前自动采集轻量信息
# 在 Old > 95% 时通过 arthas 或 jcmd 自动执行：
jcmd <pid> VM.native_memory summary > /data/dump/nmt_$(date +%s).txt
jmap -histo <pid> > /data/dump/histo_$(date +%s).txt     # 轻量，不 STW
jstack <pid> > /data/dump/stack_$(date +%s).txt
# 注意顺序：先做轻量的（jstack, jmap -histo），最后做重的（heap dump）
```

### 监控看板设计

```
生产环境 JVM 看板（Grafana / Prometheus）：

Row 1: 内存概览
  [Heap Used/Max 曲线] [Metaspace 曲线] [DirectBuffer 曲线]

Row 2: GC 行为
  [GC 次数/min 柱状图] [GC 平均停顿 曲线] [GC 回收量 曲线]

Row 3: 线程
  [线程数 曲线] [各状态线程数 堆叠图]

Row 4: 告警规则
  Old > 85% → WARNING（飞书/钉钉）
  Old > 95% → CRITICAL（电话/PagerDuty）
  Full GC 频率 > 5次/10min → WARNING
  Full GC 停顿 > 1s → WARNING
```

## 延伸追问

- **Q：Old 区 85% 报警是不是太保守了？有些应用就是长期 90%**
  → 取决于应用。如果长期稳定在 90%、Full GC 不频繁 → 可以调到 92% 再报警。关键是**看趋势而非绝对值**：稳定在 90% 没问题，从 60% 涨到 85% 还没停 → 有问题。
- **Q：有了 `HeapDumpOnOutOfMemoryError` 还需要手动监控吗？**
  → 需要。因为：① 自动 dump 只在 OOM 那一刻触发，但你更想知道"OOM 前 10 分钟在发生什么"；② 自动 dump 文件可能很大（= 堆大小），生产磁盘会爆；③ 如果能提前预警，你可以在 OOM 前就介入，而不是等炸了再查。
- **Q：k8s 环境 OOM 后 pod 直接重启，dump 文件丢了怎么办？**
  → dump 路径挂一个 PVC 或者发到对象存储（OSS/S3）。`-XX:HeapDumpPath` 指向持久卷。也可以用 `-XX:+ExitOnOutOfMemoryError` 让 pod 重启，但重启前 dump 已经写好了。

## 我的记法

- **五个指标**：Old 区、Full GC 频率、GC 停顿、Metaspace、DirectBuffer
- **核心先行指标**：Old 区使用率 + Full GC 频率的**趋势变化**，不是绝对值
- **自动取证链**：Old 95% → jmap -histo + jstack（轻量）→ OOM 时 heap dump（兜底）
- 一句话：**「每次 Full GC 后 Old 水位不降→泄漏在加速，OOM 前你至少有几分钟到几十分钟的预警窗口」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
