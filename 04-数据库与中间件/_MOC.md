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

_待补清单_
- InnoDB MVCC 在 RR 级别下怎么工作
- 幻读在普通 SELECT 和 `SELECT ... FOR UPDATE` 下的差异
- 间隙锁导致死锁的典型场景
- 批量 UPDATE 10w 行怎么做（分批大小 / Binlog 对主从延迟的影响）
- EXPLAIN 的 type / rows / Extra 怎么看
- 索引下推 / 覆盖索引 / 回表
- 分库分表的路由策略 / 扩容方案

### Redis
_典型题：跑批/聚合旁路、降级兜底、热 key、锁与限流_

_待补清单_
- 缓存与 DB 一致性：先删缓存 / 先更 DB / 延迟双删，什么场景选哪个
- 缓存雪崩 / 击穿 / 穿透的防御
- 大 Key 如何发现 / 如何拆
- Redis 分布式锁超时 + 业务执行超过锁超时的处理
- Redisson 看门狗续期机制
- Redis 持久化：RDB / AOF 的取舍

### 消息队列
_部分团队使用**企业内自研消息队列**（如业务相关的轻量实现）；常被追问与 Kafka / RocketMQ 的取舍_

_待补清单_
- qmq vs Kafka vs RocketMQ 取舍矩阵
- 优先级队列在 Kafka 里的几种实现方案
- 消息"不丢 + 不重"的完整方案（生产端 / Broker / 消费端）
- 消费端单条处理 20s 的坑（心跳 / 重平衡）
- 顺序消息的实现
- 延迟消息的实现（RocketMQ 的 18 级 / Kafka 的时间轮）

### Elasticsearch
_QDD 项目的灵魂 · 去哪儿时期的硬背景_

_待补清单_
- Mapping 设计 / Shard 数怎么定
- ReIndex 如何做到不停服
- Version 冲突 / 乐观并发控制（if_seq_no + if_primary_term）
- 深分页：search_after + PIT vs scroll
- 相关性评分与业务排序的结合（function_score）
- 倒排索引的基本原理

---

## 本模块动态视图

```dataview
TABLE file.mtime AS "最近更新", tags AS "标签"
FROM "04-数据库与中间件"
WHERE contains(tags, "生疏") OR contains(tags, "未动")
SORT file.mtime ASC
```
