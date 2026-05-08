---
tags: [P1, 通用, 生疏]
相关: "[[06-线上排障/慢查询与性能/全链路追踪（SkyWalking Zipkin CAT）]]"
---
# 日志规范与 TraceID 串联

## 一句话速记

日志的三条铁律：① **每条日志必须有 TraceID**——用 MDC（Mapped Diagnostic Context）自动注入，不用手动拼；② **关键节点必须打点**——入口（请求参数）、出口（响应）、调下游前后（耗时）、异常（完整堆栈 + 上下文）；③ **日志不要打太多也不要太少**——一个请求正常路径 5-8 条日志，异常路径补 2-3 条。**TraceID 串联 = 网关生成 TraceID → 全链路透传 → 每个服务日志自动带 → `grep <traceId>` 就能串出完整请求生命周期。**

## 通俗解释（5 分钟版）

```
没有 TraceID：
  用户投诉："我刚才下不了单"
  你：grep 用户 ID → 5000 条日志
     grep 订单号  → 100 条日志
     手动对时间戳猜测哪条日志属于哪次请求
     多个服务日志时间戳对不上（NTP 不同步）
  → 10 分钟过去了，还没串起来

有了 TraceID：
  用户投诉："下不了单，订单号 12345"
  你：grep 订单号 → 拿到 TraceID "abc-123-def"
     grep "abc-123-def" 所有服务日志 → 100 条，按时间排序
     一眼看到：OrderService → CouponService → CouponService 返回了 500
  → 30 秒定位到是优惠券服务挂了
```

## 关键细节

### 1）TraceID 的生成和传递

**生成规则**：

```
TraceID 生成位置：网关层（或第一个接收到请求的服务）
格式建议：32 位 hex 或 UUID（不带横线）

生成示例：
  UUID.randomUUID().toString().replace("-", "")
  → "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"

注意：
  - 不要用自增 ID（分布式冲突）
  - 不要用时间戳（同一 ms 多个请求）
  - 可以考虑前 8 位放机器标识 + 后 24 位放随机数（方便反查）
```

**透传方式**：

```java
// 方式 1：HTTP Header（推荐）
// 网关生成：
String traceId = IdGenerator.generateTraceId();
request.setHeader("X-Trace-Id", traceId);

// 每个服务接收：
String traceId = request.getHeader("X-Trace-Id");
if (traceId == null) {
    traceId = IdGenerator.generateTraceId();  // 兜底：自己生成
    log.warn("Missing X-Trace-Id header, generated: {}", traceId);
}
MDC.put("traceId", traceId);

// 调下游时透传：
httpRequest.setHeader("X-Trace-Id", MDC.get("traceId"));

// 方式 2：MQ 消息头
message.setProperty("X-Trace-Id", MDC.get("traceId"));

// 方式 3：gRPC metadata
metadata.put(Metadata.Key.of("X-Trace-Id", Metadata.ASCII_STRING_MARSHALLER), traceId);
```

**Spring Boot Filter 实现**：

```java
@Component
public class TraceIdFilter extends OncePerRequestFilter {
    private static final String TRACE_ID_HEADER = "X-Trace-Id";
    
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws IOException, ServletException {
        String traceId = request.getHeader(TRACE_ID_HEADER);
        if (traceId == null || traceId.isEmpty()) {
            traceId = UUID.randomUUID().toString().replace("-", "");
        }
        MDC.put("traceId", traceId);
        MDC.put("userId", request.getHeader("X-User-Id"));     // 同时注入用户 ID
        MDC.put("requestPath", request.getRequestURI());
        
        response.setHeader(TRACE_ID_HEADER, traceId);          // 返回给调用方
        
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.clear();  // 必须清理！线程池复用场景尤其重要
        }
    }
}
```

### 2）日志格式规范

**Logback 配置**：

```xml
<!-- logback-spring.xml -->
<appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
    <encoder>
        <pattern>
            %d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{traceId:-no-traceId}] %-5level %logger{36} - %msg%n%ex{full}
        </pattern>
    </encoder>
</appender>
```

**输出示例**：
```
2024-01-15 14:30:25.123 [http-nio-8080-exec-3] [a1b2c3d4e5f6] INFO  OrderService - 收到创建订单请求, orderId=12345, userId=67890
2024-01-15 14:30:25.456 [http-nio-8080-exec-3] [a1b2c3d4e5f6] INFO  OrderService - 调用优惠券服务, couponCode=SAVE10
2024-01-15 14:30:27.789 [http-nio-8080-exec-3] [a1b2c3d4e5f6] ERROR OrderService - 调用优惠券服务失败, cost=2333ms
java.net.SocketTimeoutException: Read timed out
    at java.net.SocketInputStream.socketRead0(Native Method)
    ...
```

### 3）打点规范：在哪打、打什么

**每个请求必须打的 5 个点**：

```
位置              日志级别       内容                                 目的
──────────────────────────────────────────────────────────────────────
请求入口           INFO          方法名 + 关键参数 + TraceID           接到什么请求
调下游前           DEBUG         下游名 + 方法 + 入参 + TraceID        谁调了谁
调下游后（成功）    DEBUG         下游名 + 耗时 + 返回值摘要 + TraceID  下游耗时多少
调下游后（失败）    ERROR         下游名 + 耗时 + 异常堆栈 + TraceID    为什么失败
响应出口           INFO          方法名 + 耗时 + 返回值 + TraceID      处理结果
```

**一个完整请求的日志轨迹**：

```
[2024-01-15 14:30:25.100] [traceId=abc123] INFO  Gateway → 收到请求 /api/order/create
[2024-01-15 14:30:25.101] [traceId=abc123] INFO  Gateway → 转发到 OrderService
[2024-01-15 14:30:25.102] [traceId=abc123] INFO  OrderService.createOrder() 入参 userId=67890, items=[...]
[2024-01-15 14:30:25.103] [traceId=abc123] DEBUG OrderService → 调 UserService.getUser(67890)
[2024-01-15 14:30:25.150] [traceId=abc123] DEBUG OrderService ← UserService.getUser() 耗时 47ms, 返回 {...}
[2024-01-15 14:30:25.151] [traceId=abc123] DEBUG OrderService → 调 CouponService.validateCoupon(SAVE10)
[2024-01-15 14:30:29.456] [traceId=abc123] ERROR OrderService ← CouponService 超时, 耗时 4305ms
[2024-01-15 14:30:29.457] [traceId=abc123] WARN  OrderService 优惠券校验降级: 跳过优惠券
[2024-01-15 14:30:29.460] [traceId=abc123] INFO  OrderService.createOrder() 耗时 4358ms, 返回 orderId=ORD-2024-0567
[2024-01-15 14:30:29.461] [traceId=abc123] INFO  Gateway ← 响应 200, 耗时 4361ms

grep "abc123" *.log → 完整的请求轨迹，一步到位
```

### 4）不该打日志的情况

```
❌ 不要在循环里打 INFO/DEBUG 日志
   for (Item item : items) {
       log.info("processing item: {}", item);  // 10000 条日志！
   }

❌ 不要打印大对象
   log.info("request body: {}", requestBody);  // 2MB JSON

❌ 不要打印敏感信息
   log.info("user password: {}", password);    // 密码、Token、身份证号

❌ 不要在 FINEST/TRACE 级别打高频日志但仍然在生产开启
   即使是 DEBUG 级别，高频路径每秒几千条也会打满磁盘

✅ 日志中掩码敏感字段
   log.info("user mobile: {}", maskMobile(mobile));  // 138****1234
```

### 5）日志聚合和查询

```bash
# 单机排查（紧急，没有日志平台时）
grep "abc123" /var/log/app.log /var/log/app.log.1

# 多机排查：如果日志分散在多台机器
# 方案 A：用 Ansible 批量 grep
ansible all -m shell -a "grep 'abc123' /var/log/app.log" | grep -v "SUCCESS"

# 方案 B：ELK/Loki/SLS 查询（推荐）
# Kibana / Grafana Loki：
{service="order-service"} |= "abc123" | sort @timestamp

# 方案 C：阿里云 SLS
traceId: abc123 | SELECT * FROM log ORDER BY __time__
```

## 延伸追问

- **Q：TraceID 和 SkyWalking 的 TraceID 是什么关系？**
  → 可以统一。SkyWalking agent 会自动生成 TraceID 并注入到 MDC 的 `traceId` key。如果你自己又在 Filter 里生成了一个，可能冲突。建议：如果接入了 SkyWalking，直接用它的 TraceID（`MDC.get("traceId")` 就能拿到），不用自己生成。如果没有全链路追踪，就自己生成。
- **Q：异步线程/MQ 消费端怎么拿到 TraceID？**
  → 从主线程切换到异步线程时，需要手动传递 MDC 上下文。可以用 `MDC.getCopyOfContextMap()` 拿到当前上下文，在异步线程里 `MDC.setContextMap(context)` 恢复。MQ 场景：生产者把 TraceID 放进消息 properties，消费者从 properties 取出放入 MDC。
- **Q：日志花了太多磁盘空间，怎么控制？**
  → ① 调整日志级别（生产用 INFO，调下游用 DEBUG 但在 logback 里单独控制）；② 缩短保留时间（本地 3 天，ELK 30 天）；③ 开启压缩轮转；④ 别把大响应体打到日志里。

## 我的记法

- **三条铁律**：每条日志带 TraceID、关键节点必打点、不多不少刚好够
- **TraceID 一条龙**：网关生成 → Header 透传 → MDC 注入 → 日志自动带 → grep 串联
- **5 个必打点**：入口、调下游前、调下游后、异常、出口
- 一句话：**「没有 TraceID 的日志就是废纸——对不上请求，找不到上游，没法串链路」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
