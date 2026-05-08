---
tags: [P1, 架构方向, 生疏]
---
# 全链路追踪（SkyWalking / Zipkin / CAT）

## 一句话速记

全链路追踪解决「一个请求经过了哪些服务、每段花了多久」。核心概念：**Trace**（一次完整请求链路）→ **Span**（链路中的一段操作）→ **SpanContext**（传递 TraceID + SpanID）。三个主流方案：**SkyWalking**（字节码探针，无侵入，适合 Java 微服务）；**Zipkin**（需要 SDK 埋点，轻量）；**CAT**（美团出品，更偏实时监控报表，追踪能力弱于前两者）。

## 通俗解释（5 分钟版）

```
一次用户请求的完整路径：

用户 → Gateway → OrderService → UserService → MySQL
                                → InventoryService → Redis

没有全链路追踪：
  OrderService P99 500ms，但不知道是 UserService 慢还是 InventoryService 慢
  → 只能逐个服务查日志，用时间戳对

有了全链路追踪：
  一条 Trace 里看到所有 Span 的耗时分布：
  OrderService:  500ms
    ├── UserService:     50ms   ← 正常
    └── InventoryService: 400ms  ← 慢！点进去看细节
         └── Redis:      380ms  ← Redis 这条命令慢
  → 一眼定位到 Redis
```

## 关键细节

### 核心数据模型

```
Trace ID:    请求入口生成的全局唯一 ID，贯穿所有服务
Span ID:     每个服务/操作生成的本地 ID
Parent Span ID: 上游 Span 的 ID，形成父子关系

数据结构（简化）：
{
  traceId: "abc123",
  spans: [
    { spanId: "1", parentId: null,  service: "Gateway",      duration: 500 },
    { spanId: "2", parentId: "1",   service: "OrderService",  duration: 480 },
    { spanId: "3", parentId: "2",   service: "UserService",   duration: 50  },
    { spanId: "4", parentId: "2",   service: "InventorySvc",  duration: 400 },
  ]
}
```

### 三个方案对比

```
维度              SkyWalking             Zipkin                 CAT
──────────────────────────────────────────────────────────────────────
侵入性            无侵入（Java agent）    需要 SDK 埋点           需要 SDK 埋点
                 字节码增强自动采集       
                 
语言支持          Java 最好，其他一般     多语言 SDK 丰富          Java 为主

存储              H2/ES/MySQL/BanyanDB   ES/MySQL/Cassandra     MySQL/HDFS

UI 能力           拓扑图 + 调用链 +       调用链 + 依赖图          实时报表 + 监控
                  性能剖析 + 告警                                 （追踪偏弱）

适用场景          Java 微服务体系          多语言异构体系           偏监控告警 + 实时
                                                              数据报表

采样策略          支持按时间/按错误采样    支持采样率配置           全量采集（会有
                                                              性能开销）

厂商锁定          Apache 基金会            Apache 基金会           美团开源
```

**选型建议**：
```
Java 为主的微服务 → SkyWalking（无侵入，开箱即用）
多语言异构体系     → Zipkin + Brave SDK（生态好）
需要实时业务监控   → CAT（但追踪能力弱，可配合 SkyWalking）
大厂自研/深度定制  → OpenTelemetry（标准协议，灵活组合后端）
```

### SkyWalking 核心概念

```
Agent（探针）：
  - Java agent 启动时加载，字节码增强
  - 自动采集：HTTP/RPC/DB/MQ 调用，无需改代码
  - 支持插件扩展（如自定义 span、忽略某些路径）

OAP（Observability Analysis Platform）：
  - 接收 agent 上报的数据，分析聚合
  - 默认端口 11800（gRPC）、12800（HTTP）
  
Backend Storage：
  - 默认 H2（开发），生产用 ES

UI：
  - 拓扑图：服务间调用关系 + 健康状态（颜色标识）
  - 追踪：单个请求的完整调用链 + 每段耗时
  - 指标：服务/实例/端点的 P99/QPS/错误率
```

**生产必备配置**：

```yaml
# agent/config/agent.config
agent.service_name=my-order-service     # 服务名
agent.sample_n_per_3_secs=1             # 采样率（高 QPS 建议采样）
collector.backend_service=oap:11800     # OAP 地址

# 慢端点阈值（超过则记录为慢查询）
agent.span_limit_per_segment=500        # 单次追踪最大 span 数
agent.ignore_suffix=.jpg,.js,.css,.ico  # 忽略静态资源
```

### 排查实战

**场景 1：找到慢服务**

```
SkyWalking UI → 拓扑图
→ 看到 OrderService → InventoryService 连线是黄色/红色
→ 点进去看 P99：InventoryService P99 500ms（正常 50ms）
→ 看追踪列表：找到慢请求的 TraceID
→ 展开 Trace：
    InventoryService.getStock() = 450ms
      └── Redis.get() = 430ms ← 为什么 Redis 这么慢？
→ 排查 Redis：慢命令 / 大 key / 网络抖动
```

**场景 2：找到错误根源**

```
SkyWalking → 看错误率突增的服务
→ 查看错误 Trace → 找到 error span
→ 看 span 的 log/stack 信息（SkyWalking 会采集异常堆栈）
→ 定位到代码行 → 修复
```

**场景 3：没有全链路时的手工对时**

```
# 如果还没上全链路，用 TraceID 串联日志：
1. 网关生成 TraceID，放 header 里（X-Trace-Id）
2. 每个服务打印日志时带上 TraceID
3. grep <trace_id> *.log → 串出完整链路

# 日志规范示例（Logback）：
<pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{traceId}] %-5level %logger - %msg%n</pattern>

# MDC 设置：
MDC.put("traceId", request.getHeader("X-Trace-Id"));
// ... 处理请求
MDC.clear();  // finally 里清理
```

## 延伸追问

- **Q：全链路追踪有性能开销吗？线上全量采集会不会太重？**
  → SkyWalking agent 开销约 3-10%，主要在网络上报和 span 对象创建。高 QPS 服务建议采样（如 10% 或 N 秒一条），错误请求全量采集。
- **Q：SkyWalking 和 OpenTelemetry 什么关系？**
  → OpenTelemetry（OTel）是 CNCF 的追踪标准协议，目标是统一 API/SDK/数据格式。SkyWalking 可以接收 OTel 数据，也计划逐步兼容 OTel。如果新项目选型，优先考虑 OTel SDK + 任意兼容后端。
- **Q：TraceID 怎么跨线程/跨消息队列传递？**
  → SkyWalking 自动处理线程池和异步调用。MQ 场景需要插件支持或手动埋点：消息发送端把 TraceContext 放入消息 header，消费端从 header 取出并 restore context。

## 我的记法

- **核心三件套**：Trace（全局链路）→ Span（单步操作）→ SpanContext（传递 TraceID）
- **SkyWalking** = Java 无侵入首选，agent 字节码增强
- **排查套路**：拓扑图找慢服务 → Trace 找慢 Span → 定位到方法/DB/Redis 调用
- **有总比没有好**：哪怕只是网关生成 TraceID + 日志打印，也比纯手工对时间戳强 10 倍
- 一句话：**「全链路追踪让你从『谁慢了』的猜谜变成『这一 Span 430ms』的确诊」**

## 参考资料
- SkyWalking 官方文档：https://skywalking.apache.org/docs/
- OpenTelemetry：https://opentelemetry.io/docs/

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
