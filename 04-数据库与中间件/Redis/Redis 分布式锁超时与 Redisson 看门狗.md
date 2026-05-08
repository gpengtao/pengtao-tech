---
tags: [P0, Redis, 生疏]
相关: "[[04-数据库与中间件/index]]"
---
# Redis 分布式锁超时 + 业务执行超过锁超时的处理 / Redisson 看门狗续期机制

## 一句话速记

**问题**：Redis 分布式锁设了 30s TTL，但业务执行了 35s（GC、网络慢等），锁自动过期后其他节点获取到锁，两个节点同时执行 → 破坏互斥。**解法**：**Redisson 看门狗（Watchdog）**——持有锁的线程启动一个后台定时任务，每 10s（锁超时/3）自动续期（重置 TTL 为 30s），直到业务完成主动释放。**只要持锁进程存活，锁就不会自动过期**。

## 通俗解释

**问题**：

```
t=0：进程 A 获取锁，TTL=30s，开始执行业务
t=28s：业务还没完成
t=30s：锁过期！Redis 自动删除 lock key
t=30.1s：进程 B 获取到同一把锁，开始执行
t=35s：进程 A 业务完成，尝试释放锁 → 释放的是进程 B 的锁！→ 进程 C 又进来了
→ 互斥性被破坏
```

**Redisson 看门狗解法**：

```
t=0：进程 A 获取锁，TTL=30s，启动 Watchdog 线程
t=10s：Watchdog 自动续期 → TTL 重置为 30s（还剩 30s）
t=20s：Watchdog 自动续期 → TTL 重置为 30s
t=30s：（本来这里会过期，但 Watchdog 在 t=20 已续期，还有 20s）
t=35s：业务完成，进程 A 主动释放锁，Watchdog 停止
→ 整个过程只有进程 A 持锁，互斥性保证
```

## 关键细节

### 1）Redis 分布式锁的正确实现

**基本实现（不带续期）**：

```python
import redis
import uuid
import time

def acquire_lock(redis_client, lock_name: str, ttl_ms: int) -> str | None:
    """
    SET lock_name unique_value NX PX ttl_ms
    NX: 只在不存在时设置（互斥）
    PX: 毫秒过期
    返回：锁的唯一标识（用于安全释放）
    """
    lock_value = str(uuid.uuid4())
    result = redis_client.set(
        lock_name, lock_value,
        nx=True, px=ttl_ms
    )
    return lock_value if result else None

def release_lock(redis_client, lock_name: str, lock_value: str) -> bool:
    """
    使用 Lua 脚本保证原子性：
    只有当 value 匹配时才删除（避免误删别人的锁）
    """
    lua_script = """
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
    else
        return 0
    end
    """
    result = redis_client.eval(lua_script, 1, lock_name, lock_value)
    return result == 1
```

**为什么释放锁要用 Lua 脚本**：

```
❌ 错误：GET + DEL（非原子）
  GET lock → 得到 my_value
  （此时锁过期，其他进程获取到锁）
  DEL lock → 删除了其他进程的锁！

✅ 正确：Lua 脚本（原子）
  GET + DEL 在单个原子操作里执行
  value 不匹配则不删（保护其他进程的锁）
```

### 2）Redisson 看门狗原理

**Java Redisson 使用**：

```java
// Maven: redisson:3.x
RLock lock = redissonClient.getLock("myLock");

// 加锁（不设 leaseTime → 启用看门狗）
lock.lock();  // 自动设置 30s TTL + 启动看门狗

try {
    // 业务代码（可能耗时很长）
    doHeavyWork();
} finally {
    lock.unlock();  // 释放锁，停止看门狗
}

// 带超时的加锁（设置 leaseTime → 不启用看门狗）
boolean locked = lock.tryLock(
    10,     // waitTime：等待获取锁最多 10 秒
    60,     // leaseTime：持锁最长 60 秒（到时强制释放）
    TimeUnit.SECONDS
);
```

**看门狗内部实现（简化）**：

```java
// Redisson 内部（简化版本）
private void scheduleExpirationRenewal(long threadId) {
    ExpirationEntry entry = new ExpirationEntry();
    
    Timeout task = commandExecutor.getConnectionManager().newTimeout(
        new TimerTask() {
            @Override
            public void run(Timeout timeout) {
                // 续期：重置 TTL = lockWatchdogTimeout（默认 30s）
                renewExpiration(threadId);
            }
        },
        lockWatchdogTimeout / 3,  // 每隔 TTL/3（默认 10s）续期一次
        TimeUnit.MILLISECONDS
    );
    
    entry.addTimeout(task);
    EXPIRATION_RENEWAL_MAP.put(getEntryName(), entry);
}

private void renewExpiration(long threadId) {
    // 如果锁还被当前线程持有，续期 TTL
    CompletableFuture<Boolean> renewed = renewExpirationAsync(threadId);
    renewed.thenAccept(result -> {
        if (result) {
            // 续期成功，再次调度（循环）
            scheduleExpirationRenewal(threadId);
        }
        // 续期失败（可能锁已被释放）→ 停止续期
    });
}
```

**看门狗的关键配置**：

```java
// 看门狗超时时间（默认 30s）
Config config = new Config();
config.setLockWatchdogTimeout(30000);  // 30000ms = 30s

// 自动续期：每 30s/3 = 10s 续期一次，续期后 TTL 重置为 30s
// 即：只要持锁进程存活，每 10s 续期，锁不会自动过期

RedissonClient redisson = Redisson.create(config);
```

### 3）看门狗失效的场景

```
场景 1：进程 crash（JVM 崩溃）
  看门狗线程也跟着死了，不再续期
  → TTL 自然过期，锁释放（安全）

场景 2：进程 full GC / 长时间 STW（Stop-The-World）
  GC 期间，看门狗线程被暂停
  如果 GC 时间 > TTL，锁可能过期
  → 另一个进程获得锁，恢复后两个进程同时执行（危险！）
  解法：增大锁 TTL（适当冗余），监控 GC STW 时间

场景 3：显式设置 leaseTime
  lock.lock(10, TimeUnit.MINUTES)  → 不启用看门狗！
  → 10 分钟后强制释放，不管业务是否完成
  → 需要业务确保 10 分钟内完成

场景 4：Redis 节点故障（主从切换）
  主节点 SET NX 成功后崩溃，Slave 还未同步
  → Slave 升为主，锁数据丢失
  → 另一个进程可以获取"同一把"锁（Redlock 解决此问题）
```

### 4）实际使用建议

```java
// 建议 1：不要省略 finally，否则锁永远不释放
lock.lock();
try {
    doWork();
} finally {
    lock.unlock();  // 必须！
}

// 建议 2：避免过长持锁（超过看门狗续期间隔很多倍）
// 如果业务真的需要很长时间，考虑业务拆分 + 幂等设计

// 建议 3：tryLock 设置等待超时，避免无限等待
if (lock.tryLock(5, TimeUnit.SECONDS)) {  // 等最多 5 秒
    try {
        doWork();
    } finally {
        lock.unlock();
    }
} else {
    throw new ServiceUnavailableException("获取锁超时，请重试");
}

// 建议 4：锁名包含业务维度，避免不同业务互斥
String lockName = "order:pay:" + orderId;  // ✓
String lockName = "global_lock";            // ✗ 全局锁，吞吐量极低
```

## 延伸追问

- **Q：Redis 主从切换时分布式锁会失效，Redlock 怎么解决？**
  → Redlock 向多个（奇数，如 5 个）独立 Redis 实例分别加锁，获取到 N/2+1 个成功才算加锁成功。任何一个实例宕机，剩余实例还持有锁，不影响。但 Redlock 有争议（Martin Kleppmann 指出时钟漂移可能破坏锁的安全性）——详见 [[并发编程/Redlock 算法的争议]]。
- **Q：看门狗的续期操作也是 Redis 操作，如果 Redis 短暂抖动（几秒不可用）会怎样？**
  → 续期失败！如果 Redis 抖动时间超过锁的剩余 TTL，锁自动过期，其他进程可以获取。Redisson 对续期失败有日志告警，但不会抛异常（业务不感知）。生产中 Redis 高可用（哨兵/Cluster）是前提。
- **Q：分布式锁和数据库乐观锁怎么选？**
  → 锁竞争少（大多数时候无冲突）→ 乐观锁（数据库 version 字段）更高效；锁竞争激烈（高并发争同一资源）→ Redis 分布式锁（减少数据库压力，避免大量乐观锁重试）。秒杀等超高并发场景 → Redis 预扣，不走 DB 乐观锁。

## 我的记法

- **核心问题**：业务执行超过锁 TTL → 锁自动过期 → 互斥失效
- **看门狗**：每 `TTL/3` 续期一次，重置 TTL，持锁线程死则自动停
- **释放锁必须 Lua 脚本**：GET + DEL 原子，防止释放别人的锁
- 不设 leaseTime = 启用看门狗；设了 leaseTime = 固定时间，不续期
- 一句话：**「看门狗每 10s 给锁续命，进程活着锁就活着，进程死了锁自然过期」**

## 状态
- [ ] 已背速记
- [ ] 能写正确的 Redis 分布式锁（SET NX PX + Lua 释放）
- [ ] 能解释看门狗的续期时机
