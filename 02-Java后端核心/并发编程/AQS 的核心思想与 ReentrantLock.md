---
tags: [P0, Java方向, 生疏]
相关: "[[02-Java后端核心/_MOC]]"
---

# AQS 的核心思想 / ReentrantLock vs synchronized

## 一句话速记

**AQS（AbstractQueuedSynchronizer）= Java 并发的骨架**，通过一个 `volatile int state` + 一个 **CLH 变体等待队列**，把"锁/同步器"的核心逻辑抽出来复用——`ReentrantLock`、`Semaphore`、`CountDownLatch`、`ReadWriteLock` 都是 AQS 的子类/包装。**ReentrantLock vs synchronized**：功能上 ReentrantLock 更强（超时/可中断/公平/多条件），性能上两者相近；实现上 synchronized 是 JVM 内置 + monitorenter/monitorexit 指令，ReentrantLock 是 Java 代码 + AQS + CAS。

## 通俗解释（5 分钟版）

**AQS 解决了什么问题**：
- 写一个新的同步器（如 `CountDownLatch`）要实现：原子状态变更、等待队列管理、线程挂起/唤醒——这些逻辑高度重复
- AQS 把这些**通用机制**提炼出来，子类只需实现 `tryAcquire` / `tryRelease` 等几个方法

**AQS 的核心结构**：

```java
public abstract class AbstractQueuedSynchronizer {
    volatile int state;          // 核心状态（锁计数/许可数/闸门数）
    
    Node head;                   // 等待队列头（虚拟头节点）
    Node tail;                   // 等待队列尾
    
    // 子类实现以下方法：
    protected boolean tryAcquire(int arg) {...}     // 尝试获取（独占）
    protected boolean tryRelease(int arg) {...}     // 尝试释放（独占）
    protected int tryAcquireShared(int arg) {...}   // 尝试获取（共享）
    protected boolean tryReleaseShared(int arg) {...} // 尝试释放（共享）
}
```

**等待队列（CLH 变体）**：

```
head(虚拟) → Node(T1) → Node(T2) → Node(T3) → tail
               park        park        park
               
T1 释放锁 → unpark T2（头节点的后继）→ T2 CAS 抢 state → 成功则持有锁
```

## 关键细节

### 1）AQS acquire 的完整流程

```
Thread.lock() 调用 AQS.acquire(1)
│
├── tryAcquire(1) 成功？
│       YES → 获得锁，返回
│       NO  → 继续
│
├── 加入等待队列（addWaiter）
│       CAS 把新 Node 加到队尾
│
└── 自旋等待（acquireQueued）
        while (true):
            前驱是 head？
                YES → tryAcquire 再试一次
                      成功 → 设自己为 head，返回
                      失败 → 继续
            NO → park()（挂起）
                 等待 unpark，被唤醒后继续循环
```

**关键**：CLH 队列的**有序唤醒**确保公平（默认非公平锁的公平是局部的——队列里的等待者有序，但新来的线程可以"插队"抢一次）。

### 2）ReentrantLock 的公平/非公平

```java
// 非公平锁（默认，性能更好）
new ReentrantLock(false);

// 非公平的"插队"机会：
public final void lock() {
    if (compareAndSetState(0, 1))  // 新来线程直接 CAS 试一下
        setExclusiveOwnerThread(Thread.currentThread());  // 成功即持有，跳过队列
    else
        acquire(1);  // 失败才进队列
}

// 公平锁：
// tryAcquire 里多一个判断：
if (!hasQueuedPredecessors())  // 没有等待更久的线程才 CAS
    compareAndSetState(0, 1);
```

**非公平锁更快的原因**：新线程进来时，如果锁刚好释放，它可以立刻拿到，**不用先 park 再 unpark**（park/unpark 是系统调用，很贵）。

### 3）ReentrantLock 重入的实现

```java
// state 记录重入次数（不只是 0/1）
protected final boolean tryAcquire(int acquires) {
    Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        // 未锁定，CAS 获取
        if (compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    } else if (current == getExclusiveOwnerThread()) {
        // 已持有，重入：state += 1
        setState(c + acquires);
        return true;
    }
    return false;
}

// 解锁：state -= 1，到 0 才真正释放
```

`synchronized` 的重入由 JVM 在 ObjectMonitor 里通过 `_recursions` 计数器实现，逻辑类似。

### 4）Condition（等价于 Object.wait/notify）

```java
ReentrantLock lock = new ReentrantLock();
Condition notFull = lock.newCondition();
Condition notEmpty = lock.newCondition();

// 生产者
lock.lock();
try {
    while (queue.isFull()) notFull.await();   // 类似 wait()，释放锁+挂起
    queue.add(item);
    notEmpty.signal();  // 类似 notify()
} finally {
    lock.unlock();
}
```

**Condition vs synchronized + wait/notify**：
- Condition 支持**多个等待集**（`notFull` / `notEmpty` 是两个队列）
- `synchronized` 只有一个等待集，`notify()` 可能唤醒错误线程

### 5）基于 AQS 的其他同步器

```
同步器              state 含义            acquire/release 语义
──────────────────────────────────────────────────────────────
ReentrantLock       0=未锁，n=重入次数     独占
ReadWriteLock       高16位读，低16位写     读共享/写独占
Semaphore           剩余许可数             获取 = state--；释放 = state++
CountDownLatch      倒数值（n→0）          await：state>0 就阻塞；countDown：state--
CyclicBarrier       用 ReentrantLock 实现  等 n 个线程到齐后同时放行
```

### 6）ReentrantLock vs synchronized 对比

```
能力                ReentrantLock               synchronized
─────────────────────────────────────────────────────────────────
可中断加锁          lockInterruptibly()         不支持
超时加锁            tryLock(1, TimeUnit.SEC)     不支持
公平锁              new ReentrantLock(true)      不支持
多条件变量          newCondition()               只有 wait/notify（一个等待集）
自动释放锁          不支持（需 try-finally）      离开 synchronized 块自动释放
JVM 内置优化        不享受偏向/轻量级优化         享受
代码简洁性          稍复杂                        简洁
```

## 延伸追问

- **Q：AQS 的等待队列为什么叫 CLH 变体？**
  → 原始 CLH（Craig, Landin, and Hagersten）队列每个节点自旋检查前驱节点的状态；AQS 变体里线程不是自旋而是 `park()`——减少 CPU 占用。"变体"在于把自旋改成了挂起/唤醒。
- **Q：`LockSupport.park()` 和 `Thread.sleep()` 有什么区别？**
  → `park()` 可以被 `unpark()` 精确唤醒特定线程，不需要抛 `InterruptedException`；`sleep()` 是固定时间且不能被精确唤醒。AQS 用 park/unpark 而不是 sleep 的原因就是精确唤醒。
- **Q：ReentrantReadWriteLock 读锁可重入吗？**
  → 可以，读锁的重入计数存在每个线程的 ThreadLocal 里（高位 state 是总读锁持有数，ThreadLocal 是当前线程的计数）。写锁独占且可重入，计数在 state 低 16 位。

## 我的记法

- AQS = `volatile state` + **CLH 变体等待队列** + park/unpark
- 子类只需实现 `tryAcquire/tryRelease`，队列管理全由 AQS 搞定
- **非公平锁插队**：新线程来先 CAS 试一次，不用排队，减少 park/unpark 开销
- ReentrantLock 额外能力：**可中断 / 超时 / 公平 / 多 Condition**
- `synchronized` 更简洁，有 JVM 偏向/轻量级优化
- 一句话：**「AQS 是 state + 队列的骨架，所有 java.util.concurrent 同步器都站在它上面」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能画出 AQS acquire 流程图
