---
tags: [P1, MQ, 生疏]
相关: "[[04-数据库与中间件/index]]"
---
# Kafka vs RocketMQ 取舍矩阵

## 一句话速记

**Kafka**：大数据/日志流场景的王者，吞吐量极高（百万 TPS），但消费延迟稍高（批量拉取），不支持延迟消息和事务消息（原生）；**RocketMQ**：互联网电商业务的首选，支持事务消息、延迟消息、顺序消息，消费延迟低，但吞吐不如 Kafka，运维较复杂。选型关键问题：是否需要**业务特性**（事务/延迟/顺序）→ RocketMQ；是否是**大数据链路/日志采集** → Kafka。

## 关键细节

### 1）核心对比矩阵

```
维度                  Kafka                    RocketMQ
─────────────────────────────────────────────────────────────────────
吞吐量                百万级 TPS（最高）         十万级 TPS（够用）
消息延迟              毫秒级（批量影响延迟）      微秒~毫秒级
顺序消息              Partition 内有序          Queue 内有序（更细粒度控制）
延迟消息              ❌ 原生不支持              ✅ 18 级固定延迟 / 5.0+ 任意
事务消息              ❌（Producer 事务 ≠ 业务事务）✅ 半消息 + 回查机制
死信队列（DLQ）       ❌ 原生无                 ✅ 内置，超限自动转入
消息重试              需业务层实现              ✅ 内置重试策略（指数退避）
消费模式              Pull（自主 pull）         Pull/Push（封装更友好）
协议/生态             Kafka 协议，Flink/Spark 原生支持 OpenMessaging，阿里全系集成
多语言 SDK            完善                     完善（Java 最好）
运维复杂度            较高（ZooKeeper/KRaft）   较高（NameServer + Broker）
Exactly-Once          ✅（idempotent producer + txn）❌（业务幂等）
云原生支持            MSK(AWS), Confluent Cloud  阿里云 RocketMQ
```

### 2）场景选型

```
选 Kafka：
  ✅ 日志收集（ELK, Fluentd → Kafka）
  ✅ 大数据实时流处理（Kafka + Flink/Spark）
  ✅ 指标/事件流（ClickStream, 埋点）
  ✅ CDC（Binlog → Kafka → 数据仓库）
  ✅ 极高吞吐（>100w TPS）
  ✅ 需要 Exactly-Once 语义（Flink + Kafka）

选 RocketMQ：
  ✅ 电商/支付核心链路（订单、支付、库存）
  ✅ 需要事务消息（下单 + 发消息原子）
  ✅ 需要延迟消息（订单超时取消）
  ✅ 需要死信队列（消费失败自动转 DLQ）
  ✅ 需要内置消息回溯
  ✅ 多消费组，每组独立 offset（Kafka 也支持，但 RocketMQ 管理更简单）
```

### 3）优先级队列在 Kafka 里的几种实现方案

```
Kafka 原生不支持优先级队列，几种绕过方案：

方案 1：多 Topic 模拟优先级
  high-priority-topic: 高优消息
  low-priority-topic:  低优消息
  
  Consumer 优先消费 high-priority-topic：
    先 poll high-priority，有消息就处理
    high-priority 空了，再 poll low-priority
    
  缺点：Consumer 需要特殊逻辑，动态优先级难处理

方案 2：多 Consumer Group + 多线程（生产中常用）
  VIP Consumer Group（线程多）→ 高优消息 topic
  Normal Consumer Group（线程少）→ 低优消息 topic
  通过线程数比例控制优先级

方案 3：同一 Topic + 应用层排序
  消息 payload 包含 priority 字段
  Consumer 拉到消息 → 内存优先队列排序 → 高优先处理
  缺点：内存积压大，不适合高吞吐

方案 4：RocketMQ 替代（如果真的需要优先级）
  RocketMQ 4.x 不支持原生优先级，但比 Kafka 更容易用多 Queue 模拟
  RocketMQ 5.0 / Pulsar 有更好的优先级支持
```

### 4）实际项目的混用策略

```
典型互联网架构：
  Kafka：数据链路（日志、埋点、CDC、Flink 计算）
  RocketMQ：业务事件（订单、支付、通知）

原因：
  - 业务消息量通常不大（万级 TPS），RocketMQ 够用且功能丰富
  - 数据链路量大（百万 TPS），Kafka 更合适
  - 两套 MQ 运维成本高，中小公司通常只选一个
  - 如果只选一个：业务为主 → RocketMQ；大数据为主 → Kafka
```

### 5）Kafka vs RocketMQ 的存储架构差异

```
Kafka：
  每个 Partition 对应一组 Segment 文件
  多个 Partition → 多个文件 → 随机 I/O（当 Partition 多时）
  适合：分区数量适中（几十~几百）

RocketMQ：
  所有 Queue 的消息写入同一个 CommitLog 文件（顺序写）
  ConsumeQueue 是索引文件（记录消息在 CommitLog 的偏移）
  优点：写入始终顺序 I/O，大量 Queue 也不影响写性能
  适合：大量 Topic + Queue（电商多业务线）
```

## 延伸追问

- **Q：Kafka 为什么吞吐量比 RocketMQ 高？**
  → 主要靠**批量**：Producer 攒批发送（batch.size + linger.ms），Broker 批量落盘，Consumer 批量拉取；**零拷贝**（sendfile 系统调用，Page Cache → 网络，不经用户态）；**顺序 I/O**（Segment 文件顺序追加，比随机 I/O 快 100x）。
- **Q：RocketMQ 的 Broker 角色有哪些？**
  → Master + Slave 主从架构。Producer 写 Master，Slave 同步复制；Consumer 可从 Master 或 Slave 读（减轻 Master 压力）；5.0 引入 DLedger（Raft 多副本）替代主从，自动选主，高可用性更好。NameServer（轻量注册中心）负责路由发现（类比 Kafka 的 ZooKeeper，但更简单无选举）。
- **Q：Kafka 的消费 offset 存在哪里？**
  → Kafka 0.9+ 默认存在 Kafka 内部 Topic `__consumer_offsets`（之前存 ZooKeeper）。每个 Consumer Group 的 offset 以 `<group, topic, partition>` 为 key 存储。好处：Kafka 自己管理 offset，无需额外依赖；同时支持 `auto.offset.reset`（earliest/latest）控制初始 offset。

## 我的记法

- **Kafka**：日志/大数据/极高吞吐，Flink 搭档，不支持延迟事务
- **RocketMQ**：电商/支付/业务消息，延迟+事务+DLQ 内置
- 优先级队列：Kafka 用多 Topic 模拟，RocketMQ 用多 Queue
- 混用：Kafka 数据链路 + RocketMQ 业务事件（常见架构）
- 一句话：**「大数据流量选 Kafka，业务特性丰富选 RocketMQ」**

## 状态
- [ ] 已背速记（选型矩阵）
- [ ] 能说 Kafka 优先级队列的几种实现
- [ ] 能解释两者存储架构差异
