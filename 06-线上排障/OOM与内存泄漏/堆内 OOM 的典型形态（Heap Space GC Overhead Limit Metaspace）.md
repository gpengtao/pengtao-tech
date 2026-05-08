---
tags: [P1, Java方向, 生疏]
相关: "[[02-Java后端核心/JVM与GC/OOM 排查路径]]"
---

# 堆内 OOM 的典型形态（Heap Space / GC Overhead Limit / Metaspace）

## 一句话速记

堆内 OOM 三种形态：**Java heap space**（对象太多装不下）→ MAT 找大对象；**GC Overhead Limit Exceeded**（GC 占 98%+ 时间只回收 <2% 内存）→ 本质同 heap space，堆太小或泄漏严重；**Metaspace**（类元信息撑爆）→ `classloader` 统计类数量找动态代理/脚本引擎泄漏。

## 通俗解释（5 分钟版）

```
生产环境 OOM 抛出的异常信息有三种，每种指向不同的根因：

异常信息                              本质问题                直觉类比
────────────────────────────────────────────────────────────────────────
Java heap space                    堆里对象太多/太大        房间堆满东西，没地方放新的
GC Overhead Limit Exceeded         GC 一直在扫但扫不出空间   保洁阿姨 98% 时间在打扫，
                                                            但只清出 2% 的空间——房间早该扩容了
Metaspace                          加载的类太多              电话簿太厚，翻不动了
```

**关键区分**：`Java heap space` 可能是瞬时大流量（正常对象多），也可能是泄漏（异常对象越来越多）。`GC Overhead Limit` 一定是泄漏或堆太小——GC 已经努力到极限了。

## 关键细节

### 1）Java heap space

**两种根因**：

```
a) 瞬时大流量（非泄漏）
   特征：OOM 前 Old 区使用率一直在 70-80% 正常波动，突发流量推高到 100%
   验证：heap dump 看 retained heap，没有单一大对象，分布正常
   解法：加 -Xmx / 扩容 / 限流

b) 内存泄漏（逻辑 bug）
   特征：Old 区持续单调增长，Full GC 后水位不降
   验证：对比两次 heap dump（间隔 10 分钟），看哪些类的实例数/retained 在涨
   解法：MAT dominator tree 找 GC Root → 泄漏对象的引用链
```

**对比两次 heap dump 的方法**：

```bash
# MAT: File → Open Heap Dump → Compare Basket
# 对比 Instance Count 和 Retained Heap 的增长
# 增长最大的类 = 泄漏嫌疑
```

### 2）GC Overhead Limit Exceeded

**触发条件**（JVM 内部判断）：
```
连续 5 次 Full GC 后：
  - GC 耗时 > 98% 的 CPU 时间
  - 回收的内存 < 2% 的堆
→ JVM 认为 GC 在做无用功，直接抛 OOM
```

**为什么这比 heap space 更危险**：
- 不是"内存不够"那一刻才 OOM，而是 GC 已经挣扎了很久
- 此时的 GC 停顿可能已经让接口超时、下游连锁故障
- 本质是"堆严重不足"的信号

**和 heap space 的关系**：
```
GC Overhead Limit → 一定是 heap 不够（要么泄漏、要么 -Xmx 太小）
                 → 处理方式和 Java heap space 完全一样
                 → heap dump → MAT 分析
```

### 3）Metaspace

**Metaspace 里存什么**：
```
类元信息、方法元信息、常量池、注解元数据
JDK 8+ 移到了堆外（native memory），默认无上限
```

**典型泄漏场景和排查**：

```bash
# 用 Arthas 看哪个 ClassLoader 类最多
classloader -l

# 输出示例：
# BootstrapClassLoader         3200
# sun.misc.Launcher$AppClassLoader  5800
# org.springframework.boot.loader.LaunchedURLClassLoader  15800  ← 异常

# 看到某个 ClassLoader 类数远超正常 → 代表类加载泄漏
# 常见原因：CGLib 每次请求生成代理类、Groovy 脚本没缓存
```

**和堆外 OOM 的关系**：
Metaspace 虽然在堆外（native memory），但它的 OOM 信息和 heap OOM 表现形式一样——抛 `java.lang.OutOfMemoryError: Metaspace`。排查思路上，Metaspace 用 classloader 命令而非 MAT。

## 延伸追问

- **Q：如何区分"瞬时大流量 OOM"和"泄漏 OOM"？**
  → 看 Old 区趋势：泄漏是单调增长、Full GC 后不降；瞬时大流量是正常波动后突然 spike。最可靠的是两次 heap dump 做 diff——泄漏类的实例数会一直涨。
- **Q：`-XX:+UseGCOverheadLimit` 默认开启，什么时候该关？**
  → 基本**不要关**。关了之后 GC 会持续死循环直到物理内存耗尽、机器 hang 住。如果关了是为了"争取时间 dump"，不如直接配 `-XX:+HeapDumpOnOutOfMemoryError`。
- **Q：Metaspace 设多大合适？**
  → 一般微服务 128-256m 够用。如果用了大量动态代理/脚本引擎，可以放到 512m。核心是配上限（`-XX:MaxMetaspaceSize`），不配的话默认无限，会吃掉系统内存。

## 我的记法

- **heap space** → MAT 找 retained heap 最大者
- **GC Overhead Limit** → 本质同 heap space，GC 已绝望到极限
- **Metaspace** → Arthas `classloader -l` 看类数量，找 CGLib/Groovy 泄漏
- 三种形态，两种工具：heap 型用 MAT，Metaspace 型用 classloader 命令

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
