---
tags: [P1, Java方向, 生疏]
相关: "[[02-Java后端核心/_MOC]]"
---

# Redlock 算法的争议

## 一句话速记

**Redlock = Redis 作者 Antirez 提出的多节点 Redis 分布式锁方案**：向 N 个独立 Redis 节点加锁，多数（N/2+1）成功则视为获得锁，防止单 Redis 主从切换时锁丢失。**争议**：Martin Kleppmann 等人认为 Redlock 不可靠——时钟漂移（NTP 跳变、GC STW）可能导致锁过期但持有者不知道，仍有并发安全问题；Antirez 认为在可接受的时钟误差内 Redlock 是安全的。**实践建议**：强一致性要求（金融）→ ZooKeeper；高性能 + 弱一致性可接受 → 单 Redis + Redisson。

## 通俗解释（5 分钟版）

**Redlock 解决的问题**：

```
单 Redis 主从：
  客户端 A 在 master 加锁成功
  master 宕机，slave 成为新 master
  slave 没有同步那个 key
  客户端 B 也能加锁成功 → 两人同时持锁！

Redlock 解法：
  用 5 个独立 Redis 节点（不是主从，是独立实例）
  客户端 A 依次向 5 个节点加锁：
  ① 成功 ② 成功 ③ 成功 ④ 失败 ⑤ 失败
  多数（≥3）成功 → 视为获得锁
  
  即使一个节点宕机，其他节点上的锁仍然有效
```

**Kleppmann 的质疑**：

```
场景：GC STW 或 NTP 时钟跳变
  
  时间线：
  t1: A 获得 Redlock（有效期 30s）
  t2: A 发生 GC STW，暂停 40s
  t3: 锁自动过期（30s < 40s）
  t4: B 获得同一个锁
  t5: A 的 GC 结束，A 认为自己还持有锁！→ A 和 B 同时在临界区
```

**核心问题**：Redlock 依赖时间（过期时间）保证安全性，但**分布式系统里时间是不可靠的**（GC STW、NTP 跳变、进程挂起），锁已经过期但持有者不知道。

## 关键细节

### 1）Redlock 的完整算法

```
1. 记录当前时间 t1

2. 依次向 N 个 Redis 节点用相同 key/value、相同 TTL 加锁
   （每个节点的加锁超时要短，如 TTL/5，防止等一个慢节点浪费太多时间）

3. 统计加锁成功的节点数 successCount
   计算经过时间 elapsed = now - t1

4. 判断：
   successCount >= N/2 + 1（多数）
   AND elapsed < TTL（还没到期）
   → 获得锁，有效时间 = TTL - elapsed
   
   否则 → 向所有节点发送释放命令

5. 释放：向所有 N 个节点发送 DEL 命令（包括失败的节点，防止网络分区情况）
```

**Java 实现（Redisson RedissonRedLock）**：

```java
RLock lock1 = redisson1.getLock("lock");
RLock lock2 = redisson2.getLock("lock");
RLock lock3 = redisson3.getLock("lock");

RedissonRedLock redLock = new RedissonRedLock(lock1, lock2, lock3);
boolean acquired = redLock.tryLock(5, 30, TimeUnit.SECONDS);
```

### 2）Kleppmann 的完整论证

**论点一：时钟漂移**

```
分布式系统里，各节点时钟不同步
NTP 可能有跳变（向前或向后调时间）
GC STW 可能暂停几秒到几十秒

Redlock 依赖"获得锁之后，在 TTL 内完成操作"
但如果 STW 期间锁已经过期，持有者感知不到
```

**论点二：Fencing Token 才是正确解法**

```
Kleppmann 认为正确的分布式锁应该配合 Fencing Token：
  获得锁时，锁服务返回一个单调递增的 token（如 ZK 的节点序号）
  写操作时把 token 带上
  存储系统检查：当前 token > 历史最大 token？
    YES → 操作合法
    NO  → 拒绝（说明是过期锁的持有者在操作）
```

**Antirez 的反驳**：

```
- 时钟漂移在现实中是有限的（NTP 通常 < 1ms/s，GC STW 只是偶发）
- 如果时钟漂移到秒级，整个分布式系统都会出问题，不只是 Redlock
- Fencing Token 要求存储层配合，很多场景下存储层没法做这个
- Redlock 在"合理的时钟误差"内是安全的
```

### 3）实际使用建议

```
场景                         建议
──────────────────────────────────────────────────────────
金融、幂等、数据不允许重复     ZooKeeper（Curator InterProcessMutex）
高并发、可接受极端情况下出错   单 Redis + Redisson WatchDog
追求高可用 + 稍强一致性        Redlock（接受 Kleppmann 的质疑，作为工程妥协）
DB 并发量低                   数据库乐观锁（最简单）
```

**多数公司的实践**：用单 Redis 主从 + Redisson（WatchDog 解决续期问题）。真正用 Redlock 的很少，因为维护 5 个独立 Redis 实例成本不小，而且争议不断。

### 4）Redlock 的工程问题（除了正确性争议）

```
问题                          说明
───────────────────────────────────────────────────────
需要 N 个独立 Redis 实例       N=5 成本翻 5 倍
网络延迟影响有效时间            向 5 个节点加锁消耗时间 → 有效 TTL 缩短
部分节点失败时的异常处理         复杂
"最终成功"但超时的处理          加锁成功了但有效时间 < 0（算法要求释放）
```

## 延伸追问

- **Q：Redlock 争议到今天有定论了吗？**
  → 没有完全定论，但工程界的普遍共识是：**强一致性要求用 ZK，高性能弱一致性用单 Redis Redisson**。Redlock 是一个"用更多资源换取稍好一致性但仍非完全可靠"的中间方案，实际采用率不高。
- **Q：ZooKeeper 的分布式锁就完全没有时钟问题吗？**
  → ZK 的临时节点靠 **Session 心跳**（不是 TTL）维持——客户端存活（能发心跳）= 节点存在 = 持锁。GC STW 期间如果 Session 超时（默认 30s），ZK 会自动删除临时节点。所以 ZK 不依赖时钟，但长时间 GC STW（> Session timeout）仍然会导致锁被释放——这和 Redlock 的问题本质相同，只是触发条件不一样。
- **Q：实际工程中如何防止 GC STW 导致的锁过期问题？**
  → ① 优化 GC（ZGC，减少 STW）② Redisson WatchDog 续期（缓解但不能完全解决极端情况）③ 业务侧幂等设计（锁失效了最多重跑一次，用幂等键防重）。**没有银弹，最终靠业务幂等保证正确性**。

## 我的记法

- Redlock = 向 N 个独立 Redis 节点加锁，多数成功才算持锁
- Kleppmann 质疑：**时钟漂移/GC STW 可能导致锁过期而持有者不知道**
- Kleppmann 方案：**Fencing Token**（存储层配合拒绝过期 token 的写）
- Antirez 反驳：合理时钟误差内是安全的
- 实践：金融 → ZK，高并发 → 单 Redis Redisson，Redlock 少用
- 一句话：**「Redlock 聪明但脆弱——时钟是分布式系统里不可靠的东西，正确性要靠幂等+存储层 fencing，不能靠锁本身」**

## 状态
- [ ] 已背速记
- [ ] 能讲 Kleppmann 的时钟漂移论证
- [ ] 能说清楚工程实践建议
