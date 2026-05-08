---
tags: [MOC, Java方向, 架构方向]
priority: P1
---
# 04 · 数据库与中间件 · 内容地图

> **定位**：关系型、缓存、消息、搜索 四类中间件在工程里的典型坑与选型和原理。
> 常深挖：InnoDB 机制、缓存一致性、MQ 语义的落地。

---

## 子模块导航

### MySQL
_典型题：大表、批量写、与 Binlog/CDC/检索链路联动_

- [[MySQL/InnoDB MVCC 在 RR 级别下怎么工作]] #P0 #生疏 — Read View + 版本链 + 快照读
- [[MySQL/幻读在普通 SELECT 和 FOR UPDATE 下的差异]] #P0 #生疏 — MVCC 防快照读幻读，Gap Lock 防当前读幻读
- [[MySQL/间隙锁导致死锁的典型场景]] #P0 #生疏 — Insert Intention Lock 与 Gap Lock 冲突
- [[MySQL/EXPLAIN 的 type rows Extra 怎么看]] #P0 #生疏 — type 优先级 / Using filesort / Using index
- [[MySQL/索引下推 覆盖索引 回表]] #P0 #生疏 — ICP / 延迟关联深分页
- [[MySQL/批量 UPDATE 10w 行怎么做]] #P1 #生疏 — 分批 ID 范围 / Binlog 主从延迟
- [[MySQL/分库分表的路由策略与扩容方案]] #P1 #生疏 — Hash 取模 / 双写不停服扩容

### Redis
_典型题：跑批/聚合旁路、降级兜底、热 key、锁与限流_

- [[Redis/缓存与 DB 一致性]] #P0 #生疏 — 先更 DB 再删缓存 / Canal + MQ 方案
- [[Redis/缓存雪崩 击穿 穿透的防御]] #P0 #生疏 — 随机 TTL / 逻辑过期 / 布隆过滤器
- [[Redis/Redis 分布式锁超时与 Redisson 看门狗]] #P0 #生疏 — SET NX PX / Lua 释放 / Watchdog 续期
- [[Redis/大 Key 如何发现与拆]] #P1 #生疏 — bigkeys / RDB 分析 / UNLINK 异步删
- [[Redis/Redis 持久化 RDB vs AOF]] #P1 #生疏 — 混合持久化 / fork() / 生产配置

### 消息队列
_典型题：与 Kafka / RocketMQ 的取舍_

- [[消息队列/消息不丢不重的完整方案]] #P0 #生疏 — acks=all / 手动 ACK / 本地消息表 / 幂等
- [[消息队列/消费端单条处理 20s 的坑]] #P0 #生疏 — max.poll.interval.ms / Rebalance / 异步处理
- [[消息队列/MQ 选型 Kafka vs RocketMQ]] #P1 #生疏 — 吞吐 vs 业务特性 / 优先级队列方案
- [[消息队列/顺序消息与延迟消息的实现]] #P1 #生疏 — 同 key 同 Queue / RocketMQ 18 级 / 时间轮

### Elasticsearch
_典型题：Mapping / Shard / 深分页 / 相关性_

- [[Elasticsearch/倒排索引的基本原理]] #P0 #生疏 — 词项字典 + Posting List + 跳表
- [[Elasticsearch/Mapping 设计与 Shard 数怎么定]] #P0 #生疏 — text/keyword / dynamic:strict / Shard 大小原则
- [[Elasticsearch/ReIndex 不停服与深分页]] #P1 #生疏 — 别名原子切换 / search_after + PIT
- [[Elasticsearch/Version 冲突与乐观并发控制]] #P1 #生疏 — if_seq_no + if_primary_term / 409 重试
- [[Elasticsearch/相关性评分与 function_score]] #P1 #生疏 — BM25 / field_value_factor / gauss 衰减

---

## 本模块动态视图

```dataview
TABLE file.mtime AS "最近更新", tags AS "标签"
FROM "04-数据库与中间件"
WHERE contains(tags, "生疏") OR contains(tags, "未动")
SORT file.mtime ASC
```
