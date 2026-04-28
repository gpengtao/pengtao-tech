---
tags: [P0, Java方向, 生疏]
相关: [[02-Java后端核心/_MOC]]
---

# synchronized 锁升级全过程

## 一句话速记

**synchronized 有 4 种状态，只能升级不能降级**：**无锁 → 偏向锁 → 轻量级锁 → 重量级锁**。**偏向锁**：同一线程反复进入，CAS 写线程 ID 到 mark word，几乎零开销；**轻量级锁**：有竞争但不激烈，CAS 自旋抢锁，不阻塞；**重量级锁**：自旋失败，膨胀为 OS mutex，线程挂起。升级的触发条件：有第二个线程竞争偏向锁 → 撤销升轻量级；轻量级自旋超次/超时 → 膨胀重量级。

## 通俗解释（5 分钟版）

**为什么需要锁升级**：
- OS mutex 开销极大（用户态→内核态切换，约 1μs）
- 大量 synchronized 代码其实**很少真正竞争**（同一线程反复进入）
- JVM 从便宜到贵，按需升级

**4 个状态**：

```
无锁
  ↓ 第一个线程访问
偏向锁（Biased Locking）
  ↓ 第二个线程来争夺（偏向撤销）
轻量级锁（Thin Lock / CAS 自旋锁）
  ↓ 自旋超过阈值（默认 10 次）
重量级锁（Fat Lock / OS Mutex）
```

**Mark Word 状态变化**：

```
64位 Mark Word 布局（未锁定对象）：
[hashcode(31) | age(4) | biased_lock(1=0) | lock(2=01)]

偏向锁：
[thread_id(54) | epoch(2) | age(4) | biased_lock(1=1) | lock(2=01)]

轻量级锁：
[指向栈帧 Lock Record 的指针(62) | lock(2=00)]

重量级锁：
[指向 ObjectMonitor 的指针(62)   | lock(2=10)]
```

## 关键细节

### 1）偏向锁详解

```
首次加锁：
  CAS 把线程 ID 写入 mark word
  → 成功：获得偏向锁
  → 失败：说明已经有偏向，进入撤销流程

再次加锁（同一线程）：
  检查 mark word 里的线程 ID == 当前线程 ID → 直接进入，无 CAS
  
不同线程来竞争（偏向撤销 Bias Revocation）：
  STW → 检查持有偏向锁的线程是否还活着
  还活着 → 升级为轻量级锁（在持有线程栈帧里建 Lock Record）
  已退出 → 变为无锁或直接膨胀
```

**偏向锁的代价**：撤销需要 STW，**高竞争场景关掉偏向锁反而更快**：
```bash
-XX:-UseBiasedLocking    # JDK 15 以前默认开
# JDK 15 之后偏向锁默认禁用（Deprecated），JDK 18 移除
```

### 2）轻量级锁详解

```
加锁（CAS 自旋）：
  在当前线程栈帧上创建 Lock Record
  CAS 把对象 mark word 替换成指向 Lock Record 的指针
  → 成功：持有轻量级锁
  → 失败（别人已持有）：自旋重试

自旋升级重量级锁的条件：
  JDK 6 以前：默认 spin 10 次（-XX:PreBlockSpin）
  JDK 6+：自适应自旋（Adaptive Spinning）
    - 上次自旋成功过 → 自旋更久
    - 上次自旋没成功 → 自旋更少甚至不自旋
  
解锁：
  CAS 把 Lock Record 写回 mark word
  → 成功：完成
  → 失败（说明期间有人等待）：需要唤醒 ObjectMonitor 里的等待线程
```

### 3）重量级锁（ObjectMonitor）

```
结构：
ObjectMonitor {
    _header         // 保存原 mark word
    _owner          // 当前持有线程
    _WaitSet        // wait() 的线程队列
    _EntryList      // 等待获取锁的线程队列
    _count
}

加锁：
  _owner == null → CAS 设为当前线程 → 成功
  _owner != null → 进入 _EntryList → OS park（线程挂起）
  
解锁：
  清空 _owner
  从 _EntryList 唤醒一个线程（OS unpark）
```

**重量级锁的代价**：用户态→内核态切换，典型延迟 1-10μs，并发高时显著影响吞吐。

### 4）锁消除 vs 锁粗化

```java
// 锁消除（Lock Elision）：
// JIT 分析到这个 StringBuffer 不逃逸，锁消除
void foo() {
    StringBuffer sb = new StringBuffer();  // 不逃逸
    sb.append("a");  // 内部 synchronized，但被 JIT 消除
}

// 锁粗化（Lock Coarsening）：
// JIT 把循环里的锁合并成一次
for (int i = 0; i < n; i++) {
    synchronized (lock) { ... }  // 合并成一个大锁
}
```

### 5）synchronized vs ReentrantLock

```
维度              synchronized    ReentrantLock
───────────────────────────────────────────────
语法              关键字，自动释放  代码，必须手动 unlock
可中断加锁        不支持           lockInterruptibly()
超时加锁          不支持           tryLock(timeout)
公平锁            不支持           new ReentrantLock(true)
多条件            不支持（只有 wait/notify）  Condition
JVM 优化（偏向等）内置             不享受偏向锁优化
性能（无竞争）    差不多           差不多
性能（高竞争）    差不多           略胜（更灵活）
```

**简单场景用 synchronized，需要高级特性（超时/公平/可中断）用 ReentrantLock**。

## 延伸追问

- **Q：JDK 15+ 偏向锁被弃用，影响大吗？**
  → 对大多数服务影响极小——因为大量 synchronized 块竞争本来就低，直接从无锁 → 轻量级锁，跳过偏向锁流程。只有极端"同一线程长时间反复无竞争"的场景才明显受影响。JDK 21+ 已经完全移除。
- **Q：synchronized 方法和 synchronized 块有什么区别？**
  → 字节码指令不同：方法级是 `ACC_SYNCHRONIZED` 标志；代码块是 `monitorenter/monitorexit`。行为上等价，锁对象分别是 `this`（实例方法）或 `ClassName.class`（静态方法）或代码块里指定的对象。
- **Q：为什么 `wait()/notify()` 只能在 synchronized 里调用？**
  → 因为 wait/notify 操作的是 ObjectMonitor 里的 `_WaitSet`，而 ObjectMonitor 只在重量级锁时创建。必须先持有锁（进入 synchronized）才能访问 ObjectMonitor 做 wait/notify，不然 JVM 抛 `IllegalMonitorStateException`。

## 我的记法

- **4 阶段**：无锁 → 偏向（单线程零开销）→ 轻量（CAS 自旋）→ 重量（OS mutex）
- 偏向升级条件：**另一个线程来竞争 → STW 撤销**
- 轻量升级条件：**CAS 自旋次数/自适应失败 → 膨胀**
- JDK 15+ 偏向锁已弃用，JDK 21 移除
- 重量级锁 = ObjectMonitor = 内核 mutex，有线程挂起/唤醒开销
- 锁消除 = JIT 优化，锁粗化 = JIT 合并循环锁
- 一句话：**「synchronized 从便宜到贵按需升级——偏向→自旋→OS挂起」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能画出 mark word 变化图
