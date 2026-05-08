---
tags: [P0, Java方向, 生疏]
相关: "[[02-Java后端核心/index]]"
---

# Full GC 的触发条件

## 一句话速记

**Full GC = 整堆 STW 回收**，停顿通常秒级，**生产要避免**。触发条件主要 6 类：① Old 区空间不足（Minor GC 晋升失败）② 元空间/Metaspace 满 ③ 显式 `System.gc()` ④ CMS 并发失败退化（Concurrent Mode Failure）⑤ G1 Mixed GC 无法追上分配速度（To-space Exhausted）⑥ 内存泄漏导致堆持续增长到无法 GC。**核心排查思路**：先看 GC log 里是什么触发了 Full GC，再对症。

## 通俗解释（5 分钟版）

**Full GC 为什么可怕**：
- 整堆 STW：所有 Java 线程全部停止
- 堆越大停顿越长：16G 堆可能 5-10 秒
- 线上服务直接超时 + 告警爆炸

**6 类触发原因**：

**① Minor GC 晋升失败（最常见）**：
- Young GC 后，存活对象要晋升到 Old，但 Old 没有足够空间
- JVM 在晋升前做"担保机制"检查，预估 Old 剩余 < 历次平均晋升量 → 先触发 Full GC

**② Metaspace/PermGen 满**：
- Class 不断动态加载（Groovy/CGLib/动态代理频繁创建新 class）
- `-XX:MetaspaceSize` 不够 → Metaspace GC → 没回收掉 → Full GC

**③ 显式 `System.gc()`**：
- 代码/框架/第三方库里调了 `System.gc()`
- JVM 默认不忽略，会触发 Full GC
- 解决：`-XX:+DisableExplicitGC`

**④ CMS Concurrent Mode Failure（CMF）**：
- CMS 并发回收期间，Old 区被新晋升的对象塞满
- CMS 来不及回收 → 退化成串行 Full GC（Serial Old）
- **这是 CMS 最大的痛点**，停顿可能 10s+

**⑤ G1 To-space Exhausted / Evacuation Failure**：
- G1 做 Young/Mixed GC 时，要把存活对象复制到目标 Region
- 目标 Region 不够了（大对象或内存碎片）→ 退化 Full GC
- 常见于堆使用率 > 85% + 大对象频繁分配

**⑥ 内存泄漏**：
- 老年代缓慢增长，每次 GC 后 Old 占用不降
- 最终 Old 区撑满 → 频繁 Full GC

## 关键细节

### 1）如何快速定位是哪种 Full GC

**查 GC 日志**（现代 JVM 用 `-Xlog:gc*`）：

```
# GC 日志关键关键词
[GC cause: Allocation Failure]          → Young/Old 分配失败
[GC cause: Metadata GC Threshold]       → Metaspace 满
[GC cause: System.gc()]                 → 显式调用
[GC cause: G1 Evacuation Pause]         → G1 正常 GC
[GC cause: G1 Humongous Allocation]     → 大对象分配
[Full GC (Ergonomics)]                  → G1 判断需要 Full GC
[Full GC (Allocation Failure)]          → 内存确实不够了
```

**关注的数字**：Full GC 前后 Old 区的占用量是否降下来。
- 降了：临时压力（大对象、突发流量），可接受
- 没降：内存泄漏或对象生命周期太长

### 2）晋升担保机制（Promotion Guarantee）

```
Minor GC 前的检查（G1 也类似）：
─────────────────────────────────────────────
Old 可用空间 >= 历次 Minor GC 平均晋升量 ？
    YES → 放行 Minor GC
    NO  → 触发 Full GC（保守策略）

或：Old 可用空间 >= Young 区全部对象大小（悲观估计）
    YES → 放行
    NO  → Full GC
```

**实战意义**：Old 区经常快满 → 即使 Minor GC 本身不需要，也会被担保机制强行触发 Full GC。**所以要关注 Old 区的水位**，不是只看 Young GC。

### 3）Metaspace 的动态扩容陷阱

```
默认 MetaspaceSize = 21MB（触发第一次 Metaspace GC 的阈值，不是上限）
默认 MaxMetaspaceSize = 无上限（受系统内存限制）

问题场景：
- 动态代理、Groovy、CGLib 频繁创建 class
- 每次 Metaspace GC 能回收一些但不多
- Metaspace 阈值不断上调 → 最终 OOM: Metaspace
```

**解法**：
```bash
-XX:MetaspaceSize=256m        # 初始阈值调大，减少 GC 次数
-XX:MaxMetaspaceSize=512m     # 设上限，避免无限增长后 OOM
```

### 4）CMS Concurrent Mode Failure 的本质

```
CMS 并发 GC 执行中 →
    并发期间不 STW →
    新对象继续被 Minor GC 晋升到 Old →
    Old 区满了 →
    CMS 来不及回收 →
    退化到串行 Full GC（Serial Old GC）
    停顿：几秒到几十秒
```

**预防**：
- `-XX:CMSInitiatingOccupancyFraction=70`（Old 占 70% 就触发 CMS，不要等到 92%）
- `-XX:+UseCMSInitiatingOccupancyOnly`（只用上面的阈值，不自动调整）

### 5）G1 Evacuation Failure 的根因

```
G1 做 GC 时，把存活对象"疏散"（Evacuate）到空闲 Region
疏散失败（Evacuation Failure）= 找不到足够的目标 Region

常见原因：
- 大对象（Humongous Object）占满多个 Region
- 内存碎片（Region 都是小块剩余，没有连续大 Region）
- 堆使用率持续 > 80%

预防：
- 增大堆：-Xmx
- 增大 G1 Region 大小（减少大对象进 Humongous）
- 控制应用层大对象频率（缓存、序列化的大 byte[]）
```

### 6）排查 Full GC 的标准流程

```
① 先看 GC log cause → 定类型
② 看 Full GC 前后 Old 占用 → 判断是否泄漏
③ 如果泄漏 → 抓 heap dump：jmap -dump:live,format=b,file=heap.hprof <pid>
             → 用 MAT / JProfiler 分析 retained heap 最大的对象
④ 如果是 Metaspace → 用 Arthas 的 classloader 命令看 Class 数量增长
⑤ 如果是 System.gc() → jstack 看调用栈，或用 Arthas trace System.gc
⑥ 如果是 G1 Evacuation → 看 To-space Exhausted 次数，调大 Xmx 或 G1RegionSize
```

## 延伸追问

- **Q：`-XX:+DisableExplicitGC` 有什么副作用？**
  → NIO DirectBuffer 依赖 `System.gc()` 来触发堆外内存回收（`Cleaner.clean()`）。禁掉后 DirectBuffer 泄漏风险上升。**更好的方案**：`-XX:+ExplicitGCInvokesConcurrent`（把 System.gc() 改成触发 CMS/G1 并发 GC，而非 Full GC）。
- **Q：Full GC 和 Major GC 有什么区别？**
  → Major GC 通常指只回收 Old 区（CMS 时代的叫法），Full GC 是整堆回收（Young + Old + Metaspace）。G1/ZGC 时代这个区分模糊了，通常说 Full GC = 退化的整堆 STW 回收。
- **Q：ZGC 会有 Full GC 吗？**
  → 理论上极少，但分配速度超过 GC 速度时也会退化——ZGC 的退化叫"Allocation Stall"，后来版本叫"Soft GC"，停顿也远比传统 Full GC 短。

## 我的记法

- **6 类 Full GC 触发**：晋升失败 / Metaspace满 / System.gc / CMF / G1疏散失败 / 泄漏
- 排查三步：**看 cause → 看 Old 水位 → heap dump 分析**
- CMS 特有痛点：**CMF 退化**（Old 来不及回收）→ 提早触发 CMSInitiatingOccupancyFraction
- G1 特有痛点：**Evacuation Failure**（疏散目标 Region 不够）
- System.gc() 副作用：**+ExplicitGCInvokesConcurrent** 比 DisableExplicitGC 更安全

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
