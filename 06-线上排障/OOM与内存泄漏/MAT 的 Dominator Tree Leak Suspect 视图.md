---
tags: [P1, Java方向, 生疏]
相关: "[[02-Java后端核心/JVM与GC/OOM 排查路径]]"
---
# MAT 的 Dominator Tree / Leak Suspect 视图

## 一句话速记

MAT 分析 heap dump 的核心三板斧：① **Overview**（总览 → Leak Suspects 自动报告 → 看 pie chart 哪个对象占内存最多）；② **Dominator Tree**（谁支配了最多的 retained heap → 按 retained 降序排列 → 找 GC Root 到该对象的引用链）；③ **Histogram**（按类聚合 → 找实例数异常多的类 → List objects → with outgoing references 看谁持有它们）。

## 通俗解释（5 分钟版）

```
MAT 分析 heap dump 就像查账本：

Overview / Leak Suspects     = 财务总监说：「这个部门开销最大，重点查它」
Dominator Tree               = 查账本明细：「这笔 3M 的开销是谁批的？」
                              → 沿着支配链往上找批准人（GC Root）
Histogram                    = 按科目分类统计：「手机费这个月为什么是平时的 100 倍？」
                              → 某个类的实例数异常飙升
```

**三种视图的关系**：Overview 告诉你**查谁**，Dominator Tree 告诉你**谁持有它**，Histogram 帮你发现**不该这么多实例**的异常类。

## 关键细节

### 1）Leak Suspects（自动分析报告）

MAT 打开 heap dump 后的第一步。自动分析大对象持有链。

```
操作：File → Open Heap Dump → 选择 .hprof 文件
      → 自动生成 Leak Suspects Report

报告结构：
  - Problem Suspect 1: 一个嫌疑对象占用了 XXX MB (XX%)
  - Shortest Paths To the Accumulation Point: 谁引用了这个大对象
  - Accumulated Objects in Dominator Tree: 该嫌疑对象支配了哪些子对象

解读要点：
  - 如果 Suspect 是「业务对象」(如 Order、User) → 业务泄漏
  - 如果 Suspect 是「框架对象」(如 Session、Connection) → 框架资源没释放
  - 如果 Suspect 是「HashMap$Node / LinkedHashMap$Entry」→ 集合类无限增长
```

**Leak Suspects 的局限性**：只能找到「一个大对象持有所有小对象」的模式。对于 ThreadLocal 泄漏（每个线程独立泄漏），Leak Suspects 可能漏报——此时用 Histogram。

### 2）Dominator Tree（支配树）

**核心概念**：

```
支配关系：对象 A 支配对象 B = 所有到 B 的引用路径都经过 A
           → A 回收了，B 一定回收
           → A 的 retained heap = A 自己 + 所有被 A 支配的对象

GC Root（不被任何对象引用的起点）：
  - System Class（被 Bootstrap ClassLoader 加载的类）
  - Thread（活跃线程 → ThreadLocal 值的持有者）
  - JNI Global Reference
  - Monitor Used（synchronized 锁持有的对象）
```

**操作流程**：

```
1. 打开 Dominator Tree 视图（工具栏第二个图标）

2. 按 Retained Heap 降序排列
   → 展开 retained 最大的节点
   → 一层层往下找"你预期不应该这么大"的对象

3. 对大对象右键 → Path To GC Roots → exclude weak/soft/phantom references
   → 看到完整的引用链：GC Root → ... → 大对象
   → 引用链上的「第一个业务代码」就是泄漏点

4. 排除弱引用（exclude weak references）：弱引用不影响 GC，排除后引用链更干净
```

**典型泄漏的 Dominator Tree 特征**：

```
观察                                    结论
────────────────────────────────────────────────────
HashMap$Node 的 retained 占 > 50%      → 某个 Map 无限增长
某个 Thread → ThreadLocalMap → Entry   → ThreadLocal 泄漏
ArrayList → Object[] 很大              → 某个 List 不断 add
SessionImpl → 大量属性对象              → Session 没超时/没清理
```

### 3）Histogram（类直方图）

**用它来发现"不该有这么多实例"的类**：

```
操作：工具栏 → Histogram

列：
  - Class Name: 类名
  - Objects: 实例数量
  - Shallow Heap: 实例自身大小（不含引用）
  - Retained Heap: 实例 + 所有被引用对象的大小

关键操作：
  1. 按 Retained Heap 排序 → 找占内存最多的类
  2. 对嫌疑类右键 → List objects → with outgoing references
     → 看每个实例具体引用了什么
  3. 对嫌疑类右键 → Merge Shortest Paths to GC Roots
     → 看这些实例的共同引用链 → 找到公共持有者
  4. Compare Basket：对比两次 dump 的 Histogram
     → Objects 数量增长最大的类 = 泄漏嫌疑
```

**Histogram 常见线索**：

```
类名                                    可疑的信号
────────────────────────────────────────────────────────
HashMap$Node / LinkedHashMap$Entry      某个 Map/缓存一直在涨
byte[] / char[]                        大量字符串/String 对象（看是谁引用的）
某业务对象数量 > 预期数量 × 100         泄漏
java.lang.ref.Finalizer                 重写了 finalize() 的对象排队等回收
```

### 4）实战流程总结

```
拿到 .hprof 文件后：

1. Overview → Leak Suspects（2 分钟）
   作用：快速定位最大嫌疑对象
   如果自动分析给出明确答案 → 直接跳到第 4 步

2. Dominator Tree → 按 Retained 降序（5 分钟）
   作用：找"谁支配了最多内存"
   展开大节点，找不该大的对象

3. Histogram → 按 Retained 降序（3 分钟）
   作用：找"哪个类的实例数/内存异常"
   配合 List objects → with outgoing references

4. 对嫌疑对象 → Path To GC Roots → exclude weak refs（2 分钟）
   作用：找到持有链 → 定位到代码行
   引用链上第一个非框架代码 = 根因
```

## 延伸追问

- **Q：Shallow Heap 和 Retained Heap 的区别？**
  → Shallow = 对象自身占的内存（比如一个 `ArrayList` 对象 24 bytes）。Retained = Shallow + 所有被它支配的对象的 Shallow 之和（即如果这个对象被回收，一共能释放多少内存）。**分析泄漏看 Retained，不看 Shallow**。
- **Q：为什么分析时要 exclude weak references？**
  → 弱引用不影响 GC——即使弱引用存在，对象也能被回收。不排除的话引用链会很嘈杂，可能显示一堆「被 WeakHashMap 引用」但实际没问题的大对象。
- **Q：Compare Basket 怎么用？**
  → 打开第一个 heap dump → Window → Compare Basket → 添加第二个 dump → 对比 Histogram。适合「刚重启」vs「跑了一段时间」的对比——确认谁在涨。

## 我的记法

- **三板斧**：Leak Suspects（自动找）→ Dominator Tree（找支配者）→ Histogram（找异常类数量）
- **核心动作**：右键 → Path To GC Roots（exclude weak refs）→ 找第一个业务代码
- **看 Retained，不只看 Shallow**
- 一句话：**「Dominator Tree 按 Retained 排，Path To GC Roots 找到持有链，第一个业务代码就是泄漏点」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
