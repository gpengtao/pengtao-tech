---
tags: [P1, Java方向, 生疏]
相关: "[[02-Java后端核心/Spring与Dubbo/Dubbo Provider 线程池打满与超时]]"
---
# HikariCP 连接池耗尽的现象与 leakDetectionThreshold

## 一句话速记

HikariCP 连接池耗尽的典型现象：接口突然开始报 `Connection is not available, request timed out after Xms`，且所有需要 DB 的接口同步受影响。三个核心诊断指标：**ActiveConnections**（当前在用）≈ **MaxPoolSize**（池已满）、**PendingConnections**（排队等连接）> 0、**ConnectionTimeout**（等待超时）。根因分两类：① 慢查询导致连接持有时间过长（最常见）；② 连接泄漏（拿了没还）。**`leakDetectionThreshold`** 是发现连接泄漏的关键参数——连接被持有超过阈值时自动打印泄漏堆栈。

## 通俗解释（5 分钟版）

```
HikariCP 连接池 = 图书馆的阅览座位

MaxPoolSize = 20          = 图书馆只有 20 个座位
ActiveConnections = 20    = 20 个座位都有人
PendingConnections = 5    = 5 个人在门口排队等位
ConnectionTimeout = 30s   = 等 30 秒还没位就离开（抛异常）

正常情况：
  读者借书→坐下→看完→还书离开→座位释放→下一个人坐
  持有时间 = 10ms（一个简单查询）

异常情况：
  某读者坐下后开始写论文（慢查询 5 分钟）
  → 20 个座位被占满，所有人都在等
  → 排队的人超时离开（抛 Connection is not available）
```

## 关键细节

### 现象

**1. 日志中的典型错误**：

```
# HikariCP 4.x
java.sql.SQLTransientConnectionException: HikariPool-1 - Connection is not available,
  request timed out after 30000ms.

# 意思是：线程等了 30 秒，连接池还是没给连接
```

**2. 监控指标变化**：

```
正常状态              异常状态
Active: 2-5           Active: 20（= MaxPoolSize）
Idle: 15-18            Idle: 0
Pending: 0             Pending: 5, 10, 15...（持续增长）
Wait: 0ms              Wait: 30000ms（超时）
```

### 诊断步骤

```bash
# 1. 查看 HikariCP 指标（Spring Boot Actuator + Micrometer）
GET /actuator/metrics/hikaricp.connections.active
GET /actuator/metrics/hikaricp.connections.pending
GET /actuator/metrics/hikaricp.connections.idle
GET /actuator/metrics/hikaricp.connections.timeout

# 2. 查看连接池配置
GET /actuator/configprops
# 找 spring.datasource.hikari.* 配置
```

```java
// 3. 通过 HikariCP 自身 API 获取
HikariPoolMXBean poolMXBean = hikariDataSource.getHikariPoolMXBean();
System.out.println("Active: " + poolMXBean.getActiveConnections());
System.out.println("Idle: " + poolMXBean.getIdleConnections());
System.out.println("Total: " + poolMXBean.getTotalConnections());
System.out.println("Threads Awaiting: " + poolMXBean.getThreadsAwaitingConnection());
```

### 根因 1：慢查询占着连接不放（最常见）

**排查**：

```bash
# 先查 DB 端：哪些连接在干什么
mysql> SHOW FULL PROCESSLIST;
# 看 Time 列 > 5s 的查询 → 这些连接对应的应用连接被慢查询持有

# 确认是哪些 SQL 慢
mysql> SELECT * FROM information_schema.PROCESSLIST
       WHERE TIME > 5 AND COMMAND != 'Sleep'
       ORDER BY TIME DESC;

# 用 pt-query-digest 分析慢查询日志
pt-query-digest /var/log/mysql/slow.log
```

**特征**：Active 持续满，但连接都会被归还（只是很慢）。修复慢查询后自动恢复。

### 根因 2：连接泄漏（拿了没还）

**排查**：

```yaml
# 开启 leakDetectionThreshold（生产可开，开销极小）
spring:
  datasource:
    hikari:
      leak-detection-threshold: 60000  # 60 秒，连接持有超过此值打印泄漏堆栈
```

```
开启后，连接泄漏时日志打印：

[HikariPool-1 housekeeper] WARN  com.zaxxer.hikari.pool.ProxyLeakTask -
  Connection leak detection triggered for conn 1823942342 on thread http-nio-8080-exec-3,
  stack trace follows:
    java.lang.Exception: Apparent connection leak detected
        at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:190)
        at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:160)
        at com.zaxxer.hikari.HikariDataSource.getConnection(HikariDataSource.java:100)
        at com.example.dao.OrderDao.findOrder(OrderDao.java:25)     ← 泄漏点！
        at com.example.service.OrderService.process(OrderService.java:42)

# 看是从哪个方法拿的连接没还 → 检查该方法是否在 finally 里 close 了连接
```

**泄漏的常见代码模式**：

```java
// ❌ 泄漏：异常时连接没关闭
Connection conn = dataSource.getConnection();
PreparedStatement stmt = conn.prepareStatement(sql);
ResultSet rs = stmt.executeQuery();
// 如果这里抛异常，conn 永远不会 close

// ✅ 正确：try-with-resources 或 finally
try (Connection conn = dataSource.getConnection();
     PreparedStatement stmt = conn.prepareStatement(sql);
     ResultSet rs = stmt.executeQuery()) {
    // 处理结果
}
// try-with-resources 保证异常时也会 close
```

### 配置建议

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20              # 默认 10，根据并发量调
      minimum-idle: 5                    # 最小空闲连接
      connection-timeout: 30000          # 等待连接超时（ms）
      idle-timeout: 600000               # 空闲连接超时（10 分钟）
      max-lifetime: 1800000              # 连接最大存活（30 分钟，比 DB wait_timeout 短）
      leak-detection-threshold: 60000    # 泄漏检测（生产建议开 60s）
      connection-test-query: "SELECT 1"  # 连接有效性验证（MySQL）
      
      # 常用公式：
      # MaxPoolSize = (核心接口 QPS × DB 查询耗时) × 1.5 余量
      # 例：(100 QPS × 0.05s) × 1.5 = 7.5 → 设 10
```

### 和 Druid 的对比

```
功能              HikariCP          Druid
──────────────────────────────────────────
连接泄漏检测        leakDetectionThreshold  removeAbandoned（更激进，自动关闭）
SQL 监控           无（用全链路追踪）       自带 SQL 统计/Wall 防火墙
性能              极佳（字节码级优化）      良好
Spring Boot 默认   是                     否
适用场景          追求性能                 需要 SQL 监控/安全防护
```

## 延伸追问

- **Q：`leakDetectionThreshold` 设多少合适？**
  → 设为你正常查询时间的 10-20 倍。比如你的 DB 查询 P99 是 3 秒，就设 60 秒（60000ms）。太短会误报（正常慢查询也报警），太长会延迟发现泄漏。
- **Q：连接池满了，临时怎么止血？**
  → ① 调大 `maximum-pool-size`（但别超过 DB `max_connections` 的 50%）；② 限流入口；③ 如果确认是慢查询→kill 慢查询释放连接；④ 重启应用（最后手段）。
- **Q：为什么 `max-lifetime` 要比 MySQL `wait_timeout` 短？**
  → 如果连接池持有一个连接超过了 MySQL 的 `wait_timeout`，MySQL 端已经关了，但连接池不知道——拿这个连接用就会报 `CommunicationsException`。`max-lifetime` 设短 1-2 分钟可以确保连接在 MySQL 关闭前先被连接池回收。

## 我的记法

- **现象**：`Connection is not available, request timed out`
- **诊断三指标**：Active ≈ MaxPool + Pending > 0 + Wait timeout
- **根因二选一**：慢查询（DB processlist 找慢 SQL） vs 连接泄漏（`leakDetectionThreshold` 找没 close 的代码）
- **核心配置**：MaxPoolSize、ConnectionTimeout、leakDetectionThreshold
- 一句话：**「连接池耗尽时，先去 DB 看 processlist 找慢查询，开了 leakDetectionThreshold 再确认不是泄漏」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
