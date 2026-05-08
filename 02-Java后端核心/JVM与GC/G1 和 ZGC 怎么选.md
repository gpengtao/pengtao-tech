---
tags: [P0, Java方向, 生疏]
相关: "[[02-Java后端核心/_MOC]]"
---

# G1 和 ZGC 怎么选

## 一句话速记

**G1 = 吞吐与延迟的均衡**，适合 **4G-32G 堆、TP99 在百毫秒级**可接受的场景；**ZGC = 超低停顿**，STW 通常 < 1ms，适合**大堆（32G+）或对延迟极敏感**的服务。核心区别：G1 的 Mixed GC 停顿随堆大小线性增长，ZGC 通过**染色指针 + 读屏障**把大部分工作移到并发阶段，停顿与堆大小几乎解耦。

## 通俗解释（5 分钟版）

**G1 的工作方式**：
- 把堆切成等大的 Region（1-32MB），不再严格区分 Young/Old 物理内存
- 优先收集"回收价值最高"的 Region（Garbage First 由此得名）
- 主要停顿：**Young GC**（纯 STW）+ **Mixed GC**（收 Old Region，停顿较长）
- 每次 Mixed GC 停顿约 200-500ms（32G 堆），很难做到 10ms 以内

**ZGC 的工作方式**：
- 利用**染色指针**把 GC 状态编码进 64 位指针的高位
- 利用**读屏障**在用户线程访问对象时完成重映射——几乎所有工作并发进行
- STW 只有三个极短暂的阶段（初始标记 / Pause Mark Start + Relocation Pause 等），通常 < 1ms
- 代价：吞吐略低于 G1（读屏障有 CPU 开销，约 5-15%）

**选型口诀**：
```
堆 < 4G              → 默认 G1 即可，也可保留 CMS（老项目）
4G-32G               → G1 是主流首选
32G+ 或 TP99 < 10ms  → ZGC（JDK 15+ 正式 GA，JDK 21 分代 ZGC 更好）
低 CPU 资源 / 追吞吐  → G1（ZGC 读屏障额外 CPU 开销在吞吐敏感场景吃不消）
```

## 关键细节

### 1）G1 的停顿来源

```
G1 停顿类型          停顿原因                         参考时长
─────────────────────────────────────────────────────
Young GC             扫描全部 Young Region             10-200ms（取决于存活对象）
Mixed GC             Young + 部分 Old Region           200-500ms（大堆更长）
Full GC（退化）      G1 跟不上分配速度时触发            秒级（要避免）
```

**G1 的痛点**：Mixed GC 的 STW 时间随堆中存活对象线性增长，**32G 堆停顿 1s 以上不罕见**。

### 2）ZGC 的停顿来源（极短）

```
ZGC STW 阶段            典型时长
─────────────────────────────────
Pause Mark Start        < 1ms（扫 GC Roots）
Pause Mark End          < 1ms（最终标记）
Pause Relocate Start    < 1ms（选 Region + 设读屏障）
```

**ZGC 的停顿与堆大小无关**——1G 和 1T 的停顿几乎一样短。

### 3）JDK 版本差异

```
JDK 版本      G1 状态       ZGC 状态
─────────────────────────────────────
JDK 8         默认 GC       无
JDK 11        成熟          实验性
JDK 15        成熟          正式 GA
JDK 21        成熟          分代 ZGC GA（吞吐进一步提升，推荐）
```

**JDK 21 的分代 ZGC**（`-XX:+UseZGC -XX:+ZGenerational`）是当前最佳选择——Young 对象单独处理，吞吐接近 G1。

### 4）常用 JVM 参数对比

```bash
# G1
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200      # 目标最大停顿（软目标，不保证）
-XX:G1HeapRegionSize=16m       # Region 大小（1-32m，2 的幂）
-XX:InitiatingHeapOccupancyPercent=45  # Old 占比多少时触发并发标记

# ZGC
-XX:+UseZGC
-XX:+ZGenerational             # JDK 21+ 开启分代（推荐）
-Xms8g -Xmx8g                  # ZGC 强烈建议 Xms=Xmx，避免动态扩堆
-XX:ConcGCThreads=4            # 并发 GC 线程数（根据 CPU 核数调）
```

### 5）生产选型决策树

```
线上 Java 服务需要调 GC → 先看两个指标：
│
├── 堆 ≤ 8G 且 TP99 < 200ms 可接受？
│       → G1（MaxGCPauseMillis=100-200，调好通常稳定）
│
├── 堆 8G-32G，追求低停顿？
│       → 先试 G1 + 调优，不行再迁 ZGC
│
├── 堆 > 32G，或 TP99 要求 < 10ms？
│       → ZGC（JDK 21 分代 ZGC 最佳）
│
└── 批处理 / 吞吐优先，延迟不敏感？
        → G1 或 Parallel GC（吞吐最强）
```

### 6）ZGC 读屏障的 CPU 代价

```java
// 伪代码：ZGC 读屏障加在每次对象引用读取时
Object ref = obj.field;  // 编译后插入：
// if (ref.color != expected_color) {
//     ref = remap(ref);           // 重映射到新地址
// }
```

**每次对象引用读取都有额外检查**——CPU 密集 + 对象读取频繁的应用，ZGC 可能降吞吐 10-15%。

## 延伸追问

- **Q：G1 的 Region 大小怎么选？**
  → 建议让 JVM 自动算（堆大小 / 2048）；大对象超过 Region 的 50% 就进 Humongous Region，容易触发 Full GC——**如果有大对象频繁分配，增大 RegionSize**。
- **Q：ZGC 为什么能让停顿和堆大小无关？**
  → 核心是**并发转移**——对象移动在并发阶段完成，用户线程通过读屏障拿到最新地址；STW 阶段只处理 GC Roots（数量固定，不随堆大小增长）。
- **Q：Shenandoah 和 ZGC 有什么区别？**
  → 两者都是超低停顿 GC，但机制不同：ZGC 用染色指针 + 读屏障；Shenandoah 用 Brooks Pointer（间接指针转发）+ 写屏障。实践中 ZGC 停顿更短，Shenandoah 在 OpenJDK 社区更活跃。

## 我的记法

- **G1 = 均衡**（堆 4-32G，百毫秒级停顿可接受）
- **ZGC = 极低停顿**（32G+ 或 TP99 < 10ms）
- ZGC 三关键：**染色指针 + 读屏障 + 并发转移**
- ZGC 代价：**吞吐 -10%**（读屏障 CPU 开销）
- JDK 21 分代 ZGC = 当前最佳，吞吐接近 G1
- **Xms=Xmx**：ZGC 必须固定堆大小

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
