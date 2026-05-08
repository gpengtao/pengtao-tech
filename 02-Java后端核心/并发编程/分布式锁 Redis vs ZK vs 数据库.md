---
tags: [P0, Java方向, 生疏]
相关: "[[02-Java后端核心/index]]"
---
# 分布式锁：Redis vs ZK vs 数据库

## 一句话速记

**三种分布式锁各有优劣**：**Redis**（SET NX EX）最快（< 1ms），但 AP——主从切换时可能丢锁；**ZooKeeper**（临时有序节点）最可靠，CP——Leader 宕机会有短暂不可用，延迟较高（5-10ms）；**数据库**（唯一索引/乐观锁）最简单，但性能差，有连接数压力。**生产主流**：业务锁用 Redis + Redisson（WatchDog 自动续期），强一致性要求用 ZK 或数据库乐观锁。

## 通俗解释（5 分钟版）

**分布式锁要解决的问题**：

```
多实例服务同时执行同一操作 → 需要互斥
例：
  - 防止重复下单（幂等）
  - 定时任务防止多实例同时执行
  - 库存扣减防超卖
```

**三种方案核心思路**：

```
Redis:    SETNX（只有 key 不存在时才 SET）+ EX（超时自动释放）
ZK:       创建临时顺序节点，序号最小的获得锁，Watch 前一个节点释放
数据库:   INSERT unique / UPDATE with version（乐观锁）
```

## 关键细节

### 1）Redis 分布式锁

**最简实现（有坑）**：

```bash
# 加锁
SET lock_key client_id NX EX 30   # NX=不存在才设置，EX=30秒过期

# 释放锁（必须是自己的 lock，用 Lua 保证原子性）
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

**主要坑**：

```
坑1：锁过期但业务没执行完
  → GC STW 停顿 30s，锁过期，另一个实例进来 → 数据竞争
  → 解法：WatchDog 自动续期（Redisson 默认开启）

坑2：主从切换时锁丢失（CAP 的 A 问题）
  → 加锁成功（写 master）→ 主挂了，从节点成为新主（未同步那条 key）
  → 另一个实例以为锁不存在，又加锁 → 两个实例同时持有锁
  → 解法：Redlock（多实例投票），但争议较大

坑3：删别人的锁
  → 不检查 client_id 直接 DEL → 把别人的锁删了
  → 解法：Lua 原子检查 + 删除（见上）
```

**Redisson 使用（推荐）**：

```java
RLock lock = redisson.getLock("order:lock:" + orderId);
try {
    boolean acquired = lock.tryLock(5, 30, TimeUnit.SECONDS);
    if (!acquired) throw new BizException("系统繁忙，请稍后重试");
    
    // 业务逻辑
    processOrder(orderId);
    
} finally {
    if (lock.isHeldByCurrentThread()) {
        lock.unlock();
    }
}
// Redisson 的 WatchDog：
// 默认每 10s 续期一次，只要持有者线程存活就自动延长
// 正常 unlock() → WatchDog 停止
// 持有者 JVM 宕机 → WatchDog 停止 → 锁 30s 后自动过期
```

### 2）ZooKeeper 分布式锁

**原理**：

```
1. 在 /locks/order_lock/ 下创建临时有序节点：
   /locks/order_lock/lock_0001（客户端A）
   /locks/order_lock/lock_0002（客户端B）
   /locks/order_lock/lock_0003（客户端C）

2. 序号最小的获得锁（A 持有）

3. B、C Watch 自己的前一个节点（B watch lock_0001，C watch lock_0002）
   避免"惊群"（不是所有人 Watch lock_0001）

4. A 执行完，删除 lock_0001（或 A 宕机，临时节点自动删除）
   → B 的 Watch 触发 → B 获得锁
```

**优点**：
- 临时节点：客户端宕机，节点自动删除，不会出现"死锁"
- CP：Leader Election，强一致
- 无需担心锁过期（客户端存活 = 节点存在 = 锁有效）

**缺点**：
- 延迟较高（5-10ms，ZK 是 ZAB 协议，每次写需要多数节点确认）
- Leader 宕机时有短暂不可用（几秒）
- 维护成本高

### 3）数据库分布式锁

**方式一：唯一索引**：

```sql
-- 加锁：INSERT（失败代表已有人加锁）
INSERT INTO distributed_lock (lock_name, client_id, expire_time)
VALUES ('order_lock', 'client_abc', NOW() + INTERVAL 30 SECOND);
-- 唯一索引在 lock_name 上，INSERT 失败 = 锁被占

-- 释放：DELETE
DELETE FROM distributed_lock WHERE lock_name='order_lock' AND client_id='client_abc';

-- 定时清理过期锁（防死锁）
DELETE FROM distributed_lock WHERE expire_time < NOW();
```

**方式二：乐观锁（版本号）**：

```sql
-- 读时记录版本
SELECT id, stock, version FROM products WHERE id = 1;
-- stock=10, version=5

-- 更新时带版本号（CAS）
UPDATE products SET stock=9, version=6 WHERE id=1 AND version=5;
-- affectedRows=0 → 别人已经修改了，重试
-- affectedRows=1 → 更新成功
```

**方式三：悲观锁 `SELECT FOR UPDATE`**：

```sql
BEGIN;
SELECT * FROM orders WHERE order_id = 1 FOR UPDATE;  -- 行锁
UPDATE orders SET status = 'PROCESSING' WHERE order_id = 1;
COMMIT;
```

### 4）三者对比

```
维度              Redis           ZooKeeper        数据库
──────────────────────────────────────────────────────────────────
性能              极快 (<1ms)     较快 (5-10ms)    慢 (几十ms)
可靠性            AP（主从切换时   CP（强一致）     取决于 DB 配置
                  可能丢锁）
死锁处理          TTL 自动过期    临时节点自动删除  需要定时清理
实现复杂度        简单（Redisson） 中等（Curator）   简单（SQL）
运维成本          需要 Redis       需要 ZK 集群     已有 DB 即可
适用场景          高并发业务锁    强一致性要求       简单业务/低并发
```

### 5）选型决策树

```
要加分布式锁？
│
├── 已有 Redis？高并发（>100QPS）？→ Redisson（Redis）
│
├── 对锁的强一致性要求极高（金融/核心数据）？→ ZooKeeper
│
├── 业务简单，DB 读多写少？→ 数据库乐观锁（版本号）
│
└── 并发量低，DB 可以接受压力？→ 数据库悲观锁（FOR UPDATE）
```

## 延伸追问

- **Q：Redis 分布式锁超时时间设多少合适？**
  → 没有通用答案。应该是"业务执行时间的 2-3 倍 + 网络超时 buffer"，并配合 Redisson WatchDog 自动续期。不要设太短（业务没完成锁就过期），不要设太长（宕机后长时间无法重新获取）。
- **Q：Redlock 到底可不可靠？**
  → 争议很大，详见下面单独的 Redlock 笔记。简短回答：Redlock 假设各节点时钟准确，但时钟漂移可能使其失效。Martin Kleppmann 等人认为不可靠；Redis 作者 Antirez 反驳。生产中强一致性要求高的场景用 ZK 更稳妥。
- **Q：数据库乐观锁和分布式锁有什么本质区别？**
  → 乐观锁是"先做后检查"——并发时允许多个事务同时进行，提交时才发现冲突，需要重试；分布式锁是"先获取锁才能做"——互斥，同一时间只有一个执行。乐观锁适合冲突概率低的场景，分布式锁适合不能重试或冲突概率高的场景。

## 我的记法

- **Redis = 快（<1ms）+ AP**，用 Redisson 解决续期和删锁原子性问题
- **ZK = 慢（5-10ms）+ CP**，临时节点防死锁，Watch 前一个节点防惊群
- **DB = 最简单**，乐观锁（版本号）性能优于悲观锁（FOR UPDATE）
- Redis 坑：锁过期 + 主从切换 + 删别人锁 → Redisson 全解决
- 生产优先 Redis（Redisson）；强一致场景 ZK 或 DB 乐观锁
- 一句话：**「Redis 加速度，ZK 保正确，DB 兜底用——根据 CAP 需求选」**

## 状态
- [ ] 已背速记（三种方案各一句）
- [ ] 能讲 Redis 三个坑和解法
- [ ] 能答选型追问
