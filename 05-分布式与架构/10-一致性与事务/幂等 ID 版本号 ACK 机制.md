---
tags: [P0, 分布式, 生疏]
相关: "[[05-分布式与架构/index]]"
---
# 幂等 ID / 版本号 / ACK 机制

## 一句话速记

**幂等**：相同操作执行多次，结果与执行一次相同。实现方式：**幂等 ID**（请求携带唯一 ID，服务端去重）+ **数据库唯一键**（INSERT IGNORE）+ **状态机**（只有合法状态转换才执行）；**版本号**：乐观锁，每次更新 WHERE version=old 防并发覆盖；**ACK 机制**：确认应答保证"至少一次"投递，配合幂等保证"Effectively Once"。

## 通俗解释

**为什么需要幂等**：

```
分布式系统中，调用方无法确认接收方是否收到请求：
  请求已收到且处理成功，但响应丢失 → 调用方重试 → 重复处理
  请求超时（网络抖动）→ 调用方重试 → 可能处理两次

幂等确保：重复调用 = 调用一次
  创建订单 × 3 → 只创建 1 个订单
  扣款 × 3 → 只扣 1 次
```

## 关键细节

### 1）幂等 ID（Idempotency Key）

**标准模式**：

```
客户端：生成 UUID（或雪花 ID）作为请求的幂等 ID
  → 每次新业务操作生成新的幂等 ID
  → 重试时复用同一个幂等 ID

服务端：
  1. 查询幂等 ID 是否已存在（Redis 或 DB）
  2. 不存在 → 处理请求，存储幂等 ID + 结果
  3. 已存在 → 直接返回之前的结果（不重复处理）
```

```java
// HTTP 接口的幂等实现
@PostMapping("/orders")
public OrderResponse createOrder(
    @RequestHeader("Idempotency-Key") String idempotencyKey,
    @RequestBody CreateOrderRequest request
) {
    // 1. 查询幂等缓存
    String cachedResult = redis.get("idempotent:" + idempotencyKey);
    if (cachedResult != null) {
        return JSON.parseObject(cachedResult, OrderResponse.class);  // 直接返回历史结果
    }
    
    // 2. 防并发重复（SETNX 原子占位）
    boolean locked = redis.setnx("idempotent:lock:" + idempotencyKey, "1");
    if (!locked) {
        // 另一个请求正在处理，等待后重查
        Thread.sleep(100);
        return getResultOrWait(idempotencyKey);
    }
    
    try {
        // 3. 执行业务
        OrderResponse response = orderService.createOrder(request);
        
        // 4. 存储结果（TTL 设置为业务允许的重复窗口，如 24h）
        redis.setex("idempotent:" + idempotencyKey, 86400, JSON.toJSONString(response));
        return response;
    } finally {
        redis.delete("idempotent:lock:" + idempotencyKey);
    }
}
```

**幂等 ID 的存储选择**：

```
Redis（推荐）：
  SETNX + EX → 原子性 + 自动过期（避免永久占用内存）
  集群模式下用 Lua 脚本保证原子
  TTL = 业务重复时间窗口（通常 24h ~ 7d）

数据库唯一键：
  idempotency_key 字段 + UNIQUE INDEX
  INSERT IGNORE INTO idempotent_log(key, result) VALUES(?, ?)
  → 重复插入直接忽略
  → 适合需要持久化幂等记录的场景（对账）
```

### 2）数据库层面的幂等

**INSERT 幂等**：

```sql
-- 方法 1：INSERT IGNORE（忽略重复键）
INSERT IGNORE INTO orders (order_id, user_id, amount)
VALUES ('ORDER-123', 1001, 100.00);
-- 重复执行无效果（主键或唯一键冲突时忽略）

-- 方法 2：INSERT ... ON DUPLICATE KEY UPDATE
INSERT INTO order_status (order_id, status)
VALUES ('ORDER-123', 'PAID')
ON DUPLICATE KEY UPDATE status='PAID';
-- 幂等更新

-- 方法 3：先 SELECT 后 INSERT（非原子，需应用层处理重复）
```

**UPDATE 幂等（状态机）**：

```sql
-- 只允许合法状态转换，天然幂等
UPDATE orders
SET status = 'PAID'
WHERE order_id = 'ORDER-123'
  AND status = 'CREATED';  -- 只有 CREATED 才能转为 PAID
-- 执行多次：第一次成功，后续 status 已是 PAID，条件不满足，更新行数=0（忽略）
```

### 3）版本号（乐观锁）

**数据库乐观锁**：

```sql
-- 读取时获取 version
SELECT id, balance, version FROM accounts WHERE id = 1001;
-- 假设 version=5，balance=1000

-- 扣款：只有 version 匹配才执行
UPDATE accounts
SET balance = balance - 100,
    version = version + 1
WHERE id = 1001 AND version = 5;
-- 成功（affected_rows=1）：version 变为 6
-- 失败（affected_rows=0）：另一个事务已更新，需重试

-- 重试策略：读最新数据 → 重新校验 → 再次 UPDATE
```

**版本号的设计**：

```
单调递增整数（最常用）：
  每次成功更新 +1
  简单，判断方式：WHERE version=old_version

时间戳（慎用）：
  WHERE updated_at=old_timestamp
  问题：时钟回拨可能导致 version 倒退（不安全）

Sequence 号：
  结合分布式 ID 生成器，保证全局单调递增
  适合多节点并发写同一记录

ES 的 _seq_no + _primary_term：
  见 [[04-数据库与中间件/Elasticsearch/Version 冲突与乐观并发控制]]
```

### 4）ACK 机制（消息队列场景）

**三种投递语义**：

```
At-Most-Once（最多一次，可能丢失）：
  发送后不等 ACK，失败不重试
  用途：日志、监控（丢了无所谓）

At-Least-Once（至少一次，可能重复）：
  必须收到 ACK 才认为成功，超时重试
  → 消费端可能收到重复消息
  → 需要消费端幂等处理
  → Kafka 默认，大多数业务 MQ

Exactly-Once（恰好一次）：
  At-Least-Once + 消费幂等 = "Effectively Once"（工程层面）
  Kafka Transactions + Flink 可以实现真正 Exactly-Once（流处理）
```

**消费端 ACK 的实现**：

```java
// Kafka 手动 ACK（At-Least-Once）
@KafkaListener(topics = "payments")
public void handlePayment(ConsumerRecord<String, String> record,
                           Acknowledgment ack) {
    try {
        processPayment(record.value());  // 业务处理（幂等）
        ack.acknowledge();               // 手动提交 offset（处理成功才 ACK）
    } catch (Exception e) {
        // 不 ACK → 下次重新消费
        log.error("Process failed, will retry: {}", record.key(), e);
    }
}
```

**ACK 超时与重试**：

```
RPC 调用 ACK：
  客户端发送请求 → 等待响应（ACK）
  超时 → 重试（幂等 ID 保证重复请求不重复处理）
  
  重试策略：
    固定间隔：每 1s 重试一次（简单但可能雪崩）
    指数退避：1s, 2s, 4s, 8s...（推荐）
    Jitter（随机抖动）：在指数退避基础上加随机量（防止惊群效应）
```

### 5）中心到边缘节点的下发与最终一致

```
场景：中心服务更新配置 → 下发到边缘节点（可能有 1000 个节点）

下发模式：
  Push（推送）：中心主动推，节点 ACK，无 ACK 则重试
  Pull（拉取）：节点定时拉取，中心维护版本号
  
版本号设计：
  配置版本：config_version（单调递增）
  节点启动/定期：GET /config?since_version=N → 返回最新版本和内容
  
最终一致保证：
  节点启动时全量拉取最新配置
  运行时按版本号增量拉取（减少数据传输）
  中心记录每个节点的 ack_version，超时未 ACK 主动重推
  
补偿机制：
  中心定时扫描 ack_version < latest_version 的节点
  主动 Push（重试）
```

## 延伸追问

- **Q：幂等 ID 的 TTL 到期后，重复请求还会重复处理吗？**
  → 会。TTL 的选择基于业务的"重复时间窗口"——超过这个时间的重复请求认为是新请求。例如：支付幂等 ID TTL=24h，说明 24h 后的相同幂等 ID 会被重新处理。业务上需要保证在 24h 内不会有超出原因的重复调用。
- **Q：高并发下，SETNX 去重有并发问题吗？**
  → Redis 单线程处理命令，`SET key value NX EX ttl` 是原子操作，天然无并发问题。问题在于：如果业务处理失败后要删除幂等 key（允许重试），需要注意用 Lua 脚本原子地"检查 key 是否是自己设的再删除"，避免误删他人的 key。
- **Q：乐观锁的 CAS 和 synchronized 怎么选？**
  → 并发冲突少（大多数情况无竞争）→ 乐观锁（CAS）；并发冲突多（竞争激烈，CAS 重试次数多，CPU 浪费）→ 悲观锁（synchronized/分布式锁）。数据库场景：低并发 + 写操作少 → 乐观锁（version 字段）；高并发秒杀 → Redis 预扣（减少 DB 压力）+ 悲观锁。

## 我的记法

- **幂等 ID**：请求带唯一 ID，服务端 Redis SETNX 去重，TTL=重复窗口
- **数据库幂等**：INSERT IGNORE + 唯一键；UPDATE WHERE status=合法前置状态
- **版本号（乐观锁）**：WHERE version=old，affected_rows=0 则重试
- **ACK 语义**：At-Most-Once / At-Least-Once（+幂等=Effectively Once）
- 指数退避 + Jitter 防雪崩重试
- 一句话：**「幂等 = 请求带 ID + 服务端去重，版本号 = 更新时加 WHERE version 条件」**

## 状态
- [ ] 已背速记
- [ ] 能写幂等 ID 的 Redis SETNX 代码
- [ ] 能写乐观锁的 UPDATE WHERE version=N
