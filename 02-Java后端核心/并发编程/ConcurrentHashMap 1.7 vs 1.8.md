---
tags: [P0, Java方向, 生疏]
相关: "[[02-Java后端核心/_MOC]]"
---

# ConcurrentHashMap 1.7 vs 1.8

## 一句话速记

**JDK 1.7：Segment 分段锁**（16 个 Segment，每个 Segment 是一把 ReentrantLock，并发度 = Segment 数）；**JDK 1.8：数组 + 链表/红黑树 + CAS + synchronized**（锁粒度细化到单个桶 Node，并发度 = 数组长度）。1.8 并发度更高、内存更少、代码更复杂；废弃了 Segment，但保留了序列化兼容。**核心区别**：锁粒度从 Segment（管一组桶）→ 单个桶头节点。

## 通俗解释（5 分钟版）

**JDK 1.7 结构**：

```
ConcurrentHashMap
├── Segment[0]  (ReentrantLock)
│     ├── HashEntry[0..7]  (链表)
│     └── ...
├── Segment[1]  (ReentrantLock)
│     └── ...
└── ... （默认 16 个 Segment）

并发度 = 16：最多 16 个线程同时写不同 Segment
```

**JDK 1.8 结构（和 HashMap 相似）**：

```
ConcurrentHashMap
├── Node[] table  （数组，初始 16，扩容 2 倍）
│     ├── Node（链表，长度 < 8）
│     └── TreeBin → TreeNode（红黑树，长度 ≥ 8）

并发度 = table.length：最多 N 个线程同时写不同桶
锁 = synchronized(桶头节点) + CAS 操作空桶
```

## 关键细节

### 1）JDK 1.7 的问题

```
1. 内存开销大：
   每个 Segment 继承 ReentrantLock，包含等待队列等结构
   即使 Segment 从未被竞争，也占内存

2. 并发度固定：
   默认 16，创建时确定不能改
   数据量小时 16 个 Segment 都存在（浪费）
   数据量大时只有 16 并发度（不够）

3. 跨 Segment 操作慢：
   size() 要锁所有 Segment 或重试直到一致
```

### 2）JDK 1.8 的核心操作

**put 流程**：

```java
// 伪代码
void put(K key, V value) {
    hash = spread(key.hashCode());
    for (;;) {
        Node[] tab = table;
        
        if (tab == null) {
            initTable();  // CAS 初始化
            continue;
        }
        
        Node f = tabAt(tab, i = (tab.length-1) & hash);
        
        if (f == null) {
            // 空桶：CAS 写入新节点，无需加锁
            if (casTabAt(tab, i, null, new Node(hash, key, value)))
                break;
        } else if (f.hash == MOVED) {
            // 正在扩容：帮助迁移
            tab = helpTransfer(tab, f);
        } else {
            // 桶非空：synchronized 锁住桶头节点
            synchronized (f) {
                if (f.hash >= 0) {
                    // 链表插入/更新
                } else if (f instanceof TreeBin) {
                    // 红黑树插入/更新
                }
            }
            // 链表长度 >= 8 → 转红黑树
            if (binCount >= TREEIFY_THRESHOLD) treeifyBin(tab, i);
        }
    }
    addCount(1L, binCount);  // 更新 size（分段计数 + LongAdder 思想）
}
```

**get 流程（无锁）**：

```java
// get 完全无锁：
// Node.val 和 Node.next 是 volatile，保证可见性
V get(Object key) {
    Node e = tabAt(table, (n-1) & hash);
    while (e != null) {
        if (e.hash == hash && key.equals(e.key))
            return e.val;
        e = e.next;
    }
    return null;
}
```

### 3）size() 的实现差异

**1.7**：
```
先不加锁统计 2 次，如果两次结果一样就返回（乐观）
如果不一样就锁所有 Segment 再统计（悲观）
```

**1.8**：
```
用 LongAdder 思想：
  baseCount + CounterCell[] 数组
  每个线程写自己的 CounterCell，减少竞争
  size() = baseCount + sum(CounterCells)
  
→ 类似 AtomicLong 但竞争时分散到多个 cell，降低 CAS 失败率
```

### 4）红黑树的阈值设计

```
链表 → 红黑树：桶中节点数 >= 8 且 table.length >= 64
红黑树 → 链表：缩容或节点数 <= 6

为什么是 8？
  泊松分布下，负载因子 0.75 时，桶节点数 = 8 的概率约 0.00000006
  正常哈希分布下几乎不出现，出现就说明哈希很差或数据量极大
  8 也是链表 O(n) vs 红黑树 O(log n) 的交叉点（红黑树有树化开销）
```

### 5）扩容：协助迁移（多线程并发扩容）

```
1.8 ConcurrentHashMap 支持多线程并发扩容：
  检测到 ForwardingNode（hash=MOVED）的线程会 helpTransfer()
  → 多个线程各自负责一段桶的迁移
  → 迁移速度随并发度扩展
  
1.7 扩容在锁内单线程进行（每个 Segment 独立扩容）
```

### 6）常见面试高频问题

**Q：1.8 的 synchronized 不是重量级锁吗？为什么比 1.7 快？**
→ 1.8 的 synchronized 锁的是**单个桶头节点**（粒度极细），而且 JDK 6+ 的 synchronized 有偏向/轻量级锁优化——**大多数情况下用的是轻量级锁（CAS 自旋）而不是重量级**。1.7 的 ReentrantLock 则一直走 AQS 路径。

**Q：ConcurrentHashMap 允许 null key/value 吗？**
→ **不允许**（和 HashMap 不同）。原因：在并发场景下 `map.get(key) == null` 无法区分"key 不存在"和"value 是 null"——因为两次调用之间状态可能变化，没法用 `containsKey` 安全地二次检查。

**Q：ConcurrentHashMap 能保证复合操作的原子性吗？**
→ 单次 put/get 是原子的，但复合操作（`if not exist then put`）不是原子的，要用 `putIfAbsent()`、`compute()`、`computeIfAbsent()` 等原子方法。

## 延伸追问

- **Q：什么场景下 ConcurrentHashMap 会退化成单线程瓶颈？**
  → 所有 key 哈希冲突到同一个桶（哈希攻击），退化为链表/红黑树，这个桶的锁成为热点。防御：覆盖 `hashCode()` 确保分布均匀；使用带盐的哈希（Java 8 的 `spread()` 函数有此考虑）。
- **Q：`putIfAbsent` 和 `computeIfAbsent` 有什么区别？**
  → `putIfAbsent(k, v)` 传入的是已有 value，无论如何都会创建 `v`（可能无效浪费）；`computeIfAbsent(k, f)` 传入的是 `Function`，只有 key 不存在时才调用 `f` 创建值——适合**按需创建**（如缓存）。

## 我的记法

- **1.7 = Segment 分段锁（16 个 ReentrantLock）**
- **1.8 = CAS + synchronized（锁单个桶头节点）**
- 1.8 并发度更高：lock 粒度从 Segment（一组桶）→ 单桶
- get 无锁：Node.val 是 volatile
- size：1.7 锁 Segment，1.8 类 LongAdder 分散计数
- 链表→红黑树：桶 ≥ 8 节点 + table ≥ 64
- 不允许 null key/value（与 HashMap 的关键区别）
- 一句话：**「1.8 用 CAS+synchronized(桶头)取代分段锁，锁粒度更细，并发度随数组长度扩展」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答 null key/value 和 putIfAbsent 追问
