---
tags: [P0, Redis, 生疏]
相关: "[[04-数据库与中间件/index]]"
---
# 缓存与 DB 一致性：先删缓存 / 先更 DB / 延迟双删，什么场景选哪个

## 一句话速记

**最推荐方案：先更 DB，再删缓存**（Cache-Aside 写模式），大多数场景够用；**延迟双删**解决"写操作中途有读操作缓存了旧值"的并发窗口问题；先删缓存存在"删缓存成功但 DB 更新失败"的问题，不推荐。生产中通过 **Canal + MQ 异步删缓存** 实现最终一致性是最稳的方案。

## 通俗解释

**三种写策略**：

```
策略 1：先删缓存，再更 DB（不推荐）
  步骤：del(cache) → update(db)
  问题：del 成功，update 失败 → 缓存被删但 DB 没更新 → 不一致
        并发问题：A 删缓存 → B 读缓存未命中 → B 读 DB 旧值写入缓存 → A 更新 DB
                → 缓存里是旧值，DB 是新值（不一致，且持续到缓存过期）

策略 2：先更 DB，再删缓存（推荐，Cache-Aside 标准模式）
  步骤：update(db) → del(cache)
  优点：DB 更新成功才删缓存，DB 失败则缓存不动，一致性好
  问题：del(cache) 失败怎么办？→ 重试（消息队列保证）

策略 3：延迟双删
  步骤：del(cache) → update(db) → sleep(N ms) → del(cache) 再次
  解决：防止并发写-读的脏缓存，但 sleep 时间难以确定
```

## 关键细节

### 1）"先更 DB，再删缓存"的一致性分析

```
正常流程：
  写请求：update DB(id=1, val=B) → del cache(id=1)
  读请求（之后）：cache miss → read DB → cache(id=1, val=B)
  → 最终一致 ✓

并发异常场景（极低概率）：
  1. 读请求：cache miss（缓存失效）
  2. 读请求：read DB（读到旧值 A）
  3. 写请求：update DB（更新为 B）
  4. 写请求：del cache（缓存已不存在，del 无效）
  5. 读请求：write cache（写入旧值 A！）
  
  条件：缓存恰好在 update 之前失效 + 读操作在 update 和 del 之间
  → 脏缓存，持续到 TTL 过期
  → 实际非常低概率，大多数业务可接受
```

### 2）延迟双删（应对上述并发场景）

```python
def update_with_delayed_double_delete(key, new_value):
    # 第一次删：清除可能的旧缓存
    redis.delete(key)
    
    # 更新 DB
    db.update(new_value)
    
    # 延迟删：sleep 后再删一次，清除并发读写入的脏缓存
    time.sleep(0.1)  # 100ms，需根据业务读 DB 的最大时间调整
    redis.delete(key)

# 问题 1：sleep 阻塞当前线程（可以用异步任务替代）
# 问题 2：sleep 时间难以确定（太短不够，太长影响性能）
# 适用：写操作少、一致性要求不极高的场景
```

**异步版本（不阻塞）**：

```python
async def update_with_async_double_delete(key, new_value):
    redis.delete(key)
    db.update(new_value)
    
    # 投递延迟消息（如 RocketMQ 延迟消息）
    mq.send_delayed(
        topic="cache_invalidation",
        body={"key": key},
        delay_ms=500  # 500ms 后投递
    )

# Consumer 端处理：
def handle_cache_invalidation(msg):
    redis.delete(msg["key"])  # 再次删除
```

### 3）Canal + MQ 方案（生产最稳方案）

```
架构：
  应用层 → 只更新 DB
  Canal（监听 MySQL Binlog）→ 捕获行变更
  Canal → 发送到 MQ（Kafka/RocketMQ）
  Consumer → 删除/更新 Redis

优点：
  1. 应用层不需要关心缓存删除（解耦）
  2. 即使 Canal 延迟，DB 已更新，读缓存 miss 后读 DB 得到新值
  3. 天然支持重试（MQ + Consumer 重试机制）
  4. 适合多个服务写同一 DB 的场景

缺点：
  延迟（通常 < 100ms），对强一致性要求高的场景不适用
```

```
Canal 工作原理：
  Canal 伪装成 MySQL Slave
  接收 Master 的 Binlog
  解析出 INSERT/UPDATE/DELETE 的表和行数据
  → 转发给消费端处理
```

### 4）场景选型决策

```
场景                              推荐方案
────────────────────────────────────────────────────────────
读多写少，允许短暂不一致（秒级）    先更 DB + 删缓存 + 设置 TTL（兜底）
写多读多，一致性要求较高           Canal + MQ 异步删缓存
金融/支付，强一致性要求            不用缓存（直接读 DB）或加分布式锁
多服务写同一 DB                   Canal + MQ（全局统一）
简单业务，并发低                   直接设置短 TTL（缓存自然失效）
```

### 5）缓存更新 vs 缓存删除

```
为什么推荐删缓存，而不是更新缓存？

情况 1：缓存的值需要计算（如用户积分 = 多表 JOIN 结果）
  更新缓存 = 立即重新计算（可能是 N 次写操作，每次都触发昂贵计算）
  删缓存 = 懒加载，下次读时才计算（大多数写操作不需要立即重新加载）

情况 2：并发写
  事务 A 更新缓存 value=10
  事务 B 更新缓存 value=20
  乱序（B 先写，A 后覆盖）→ 缓存 value=10，DB value=20（不一致）
  删缓存没有这个问题（都是 del，幂等）

结论：Write-Around（更新 DB + 删缓存）> Write-Through（同时更新）
```

## 延迟追问

- **Q：缓存删除失败怎么办（del 失败）？**
  → 引入重试机制：失败后投递到 MQ 消息队列，Consumer 重试删除，设置最大重试次数（如 5 次）+ 指数退避。如果最终失败，依赖 TTL 兜底（设置合理的过期时间，如 5 分钟）。
- **Q：Read-Through 和 Cache-Aside 有什么区别？**
  → Cache-Aside：应用层负责读缓存、写缓存、更新 DB——逻辑在应用代码里；Read-Through：缓存层负责从 DB 加载数据，应用只和缓存交互——逻辑在缓存框架里（如 NCache、Ehcache 的 Read-Through 模式）。Cache-Aside 更灵活，Read-Through 更简洁但框架侵入性强。
- **Q：强一致性场景（金融）如何处理？**
  → 核心账务直接读 DB，不走缓存；查询接口（如余额展示）可以缓存，但设置极短 TTL（1~5s）+ 写操作主动删缓存；或者用数据库乐观锁 + 版本号，确保读到的是最新版本。

## 我的记法

- **推荐**：先更 DB，再删缓存（Cache-Aside，简单有效）
- **del 失败兜底**：MQ 重试 + TTL 兜底
- **延迟双删**：解决并发写-读的脏缓存窗口，但 sleep 时间难定
- **Canal + MQ**：生产最稳，解耦，支持重试
- **删缓存 > 更新缓存**：幂等，避免并发写乱序
- 一句话：**「先更 DB 再删缓存，删失败靠 MQ 重试，极端一致性用 Canal」**

## 状态
- [ ] 已背速记
- [ ] 能解释先删 vs 先更的区别
- [ ] 能画出 Canal + MQ 方案架构
