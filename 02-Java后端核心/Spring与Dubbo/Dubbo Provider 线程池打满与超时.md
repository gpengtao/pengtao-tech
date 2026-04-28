---
tags: [P0, Java方向, 生疏]
相关: [[02-Java后端核心/_MOC]]
---

# Dubbo Provider 线程池打满 / 超时从哪一刻开始算

## 一句话速记

**Provider 线程池打满的表现**：Consumer 端大量超时，Provider 日志有 `Thread pool is EXHAUSTED` 或 `RejectedExecutionException`，但 Provider 服务本身可能"看起来正常"。**根因**：业务处理慢（DB 慢查询/下游超时）导致线程积压；或突发流量超过线程池容量。**超时起算点**：Dubbo 超时从 **Consumer 发出请求**那一刻开始算（不是 Provider 接到请求），包含网络传输时间；Provider 超时后**仍然继续执行**，Consumer 已经返回失败——这是重要的幂等性来源。

## 通俗解释（5 分钟版）

### Provider 线程池打满的场景

```
正常：
  Consumer → 请求 → Provider [IO线程 → 业务线程池 → 执行 → 返回]
  业务线程池 200 个，请求 100ms，并发 50 QPS → 平均占用 5 线程，很健康

线程池打满：
  下游 DB 突然变慢（100ms → 3s）
  并发 50 QPS → 每个请求占用 3s → 同时积压 50*3=150 个线程
  150 > 200? 不一定，但 QPS 突增或 DB 继续变慢就会满
  
  线程池满了 → 新请求被拒绝 → Consumer 超时
  
  表象：Consumer 看到大量超时，报告 Provider 不可用
  实际：Provider 在努力处理（只是慢），但新请求进不来
```

### 超时起算点

```
时间线：
│
T0: Consumer 发出请求（Dubbo timeout 从这里开始计）
│
T1: 请求到达 Provider（网络延迟，T1 - T0 = 5ms）
│
T2: Provider 业务线程开始处理（从线程池 dispatcher，T2 = T1 + 排队时间）
│
T3: Provider 业务处理完成
│
T4: Consumer 收到响应

Provider 视角的"处理时间" = T3 - T2
Consumer 视角的"超时时间" = T4 - T0（包含网络+排队+处理）
```

**重要推论**：
```
Consumer 配置 timeout=1000ms
Provider 业务实际处理 800ms（快于 1000ms）
但网络 100ms + 线程排队 200ms = 300ms
→ Consumer 在 T0 + 1000ms 就超时了，但 Provider 还在处理！

结果：
Consumer 返回超时错误 → 业务层认为失败 → 可能重试
Provider 完成了操作 → 数据已经写入数据库！
→ 重试 + 幂等问题！
```

## 关键细节

### 1）Provider 线程池打满的排查

```bash
# 第一步：确认是线程池问题
# Provider 日志关键词：
grep "Thread pool is EXHAUSTED" provider.log
grep "RejectedExecutionException" provider.log
grep "Discard" provider.log  # Dubbo 丢弃消息

# 第二步：看 Consumer 超时错误
# Consumer 日志关键词：
grep "TimeoutException" consumer.log
grep "Waiting server-side response timeout" consumer.log

# 第三步：看 Provider 线程池监控
# Dubbo 默认暴露 QosServer（端口 22222）
telnet localhost 22222
> ls        # 列出所有命令
> status    # 查看线程池状态
> count [service] [method]  # 查看调用统计

# 第四步：Arthas 看 Provider 线程状态
thread --state RUNNABLE  # 找业务线程在干什么
# 如果大量线程 RUNNABLE 在 DB 操作 → DB 慢查询
# 如果大量线程 WAITING → 等下游服务（下游超时）
```

### 2）线程池打满的根本原因分类

```
类型              表现                          解法
──────────────────────────────────────────────────────────────
DB 慢查询         线程 RUNNABLE 在 DB 操作       SQL 优化 / 索引 / 读写分离
下游服务慢        线程 WAITING 在 RPC/HTTP       下游熔断/超时配置
突发流量          短时间内超过线程池容量          流量控制/限流/熔断
业务逻辑重计算    线程 RUNNABLE 在 CPU 计算       异步化/缓存
线程泄漏          线程数持续增长，不下降          找未释放的资源
```

### 3）Provider 线程池参数调优

```xml
<!-- Dubbo XML 配置 -->
<dubbo:provider threads="200" />  <!-- 业务线程池大小，默认 200 -->
<dubbo:provider threadpool="fixed" />  <!-- fixed/cached/limited/eager -->
<dubbo:provider queues="0" />  <!-- 队列大小，0=SynchronousQueue（不排队，立即拒绝） -->
<dubbo:provider accepts="1000" />  <!-- 最大 accept 连接数 -->

<!-- 注意：queues=0 + threads=200 意味着超过 200 并发直接拒绝 -->
<!-- 设置队列可以缓冲突发，但可能增加延迟 -->
```

**Dubbo 3.x 的 eager 线程池**：

```
eager（Dubbo 3 推荐）：
  核心线程 → 满了立即创建新线程（不等队列满）→ 到 max 才进队列
  vs 默认行为：核心线程满了先进队列，队列满了才扩线程

适合：响应时间敏感的接口（宁可多创建线程也不要排队）
```

### 4）超时配置的层级关系

```
优先级（高到低）：
方法级 > 接口级 > Consumer 全局 > Provider 全局

Consumer 侧（调用方）：
  @DubboReference(timeout=3000)  // 方法级/接口级
  dubbo.consumer.timeout=1000    // Consumer 全局默认

Provider 侧：
  @DubboService(timeout=5000)    // 接口/方法级
  dubbo.provider.timeout=5000    // Provider 全局

一般：Consumer 的 timeout 优先级高于 Provider 的
实践：timeout 通常由 Consumer 控制（调用方知道能等多久）
```

### 5）Provider 超时继续执行的危害与处理

```
危害：
  Consumer 超时返回 → 上游认为失败 → 重试
  Provider 继续执行完成 → DB 有数据
  重试再次执行 → 重复操作！

常见场景：
  下单接口：Consumer 超时重试 → 重复下单
  扣款接口：Consumer 超时重试 → 重复扣款

防止方案（双保险）：
  1. 接口幂等（主要方案）：
     唯一键约束（order_id UNIQUE）
     INSERT INTO orders ... ON DUPLICATE KEY UPDATE ...（MySQL）
  
  2. 超时不重试（FailFast + retries=0）：
     @DubboReference(cluster="failfast", retries=0)
     → 超时直接返回失败，不重试
  
  3. 请求时带幂等键：
     Consumer 端生成 requestId（UUID）
     Provider 端基于 requestId 去重
```

### 6）Dubbo 超时 vs Dubbo 线程池等待时间的区别

```
Dubbo timeout：Consumer 端设置，等待 Provider 响应的总时间
               = 网络传输 + Provider 排队 + Provider 执行 + 网络返回
               
Provider 线程池排队时间：
  任务进入 BlockingQueue 等待被线程处理的时间
  如果设了队列且队列满，会超出 timeout 但 Provider 还在排队！
  
关键：
  如果 Provider 设了大队列（queues=1000）
  请求可能在队列里等 500ms，再执行 800ms = 1300ms
  Consumer timeout=1000ms，早就超时了
  Provider 还在排队甚至没开始执行！
  
→ 队列大小 + 超时配置要配合调：
  超时小时队列不要太大（否则排队的请求都超时了还没执行）
```

## 延伸追问

- **Q：怎么设置合理的 timeout？**
  → 先 benchmark：统计接口 TP99（99% 请求的处理时间），设 timeout = TP99 * 1.5-2。太小导致正常请求超时，太大导致雪崩时资源长时间占用。**不同接口分别设置**，不要用全局一刀切。
- **Q：Dubbo 有熔断器吗？**
  → Dubbo 3.x 内置了 sentinel/resilience4j 集成，但 2.x 主要靠 Hystrix 或 Sentinel 配合使用。熔断器（Circuit Breaker）和超时是互补的：超时处理单次调用，熔断器处理连续失败的服务节点（快速失败，不发请求）。
- **Q：Consumer 和 Provider 各自设超时，冲突了怎么办？**
  → Consumer 优先。Dubbo 超时控制在 Consumer 侧：Consumer 到时间就不等了，Provider 继续处理是 Provider 的事。有时候 Provider 设更长的 timeout 是为了保护自己（告诉 Consumer "给我更多时间"），但 Consumer 不一定听——实际以 Consumer 配置为准。

## 我的记法

- **线程池打满排查**：Consumer 超时 + Provider 日志 `EXHAUSTED` → 看线程在干什么（DB慢/下游慢）
- **超时起算点**：Consumer 发出请求那一刻（不是 Provider 接到！）
- Provider 超时继续执行 → **幂等设计是唯一解**（不能靠 Dubbo 框架保证）
- 线程池配置：`threads=200`（默认），考虑 `queues` 大小和超时配合
- 一句话：**「线程池打满 = 业务慢撑死线程；超时起算在 Consumer 发出时——Provider 超时还在跑，幂等必须做」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能画出超时时间线
