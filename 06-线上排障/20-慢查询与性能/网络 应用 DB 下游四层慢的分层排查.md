---
tags: [P1, 通用, 生疏]
相关: "[[02-Java后端核心/JVM与GC/CPU 100% 完整排查命令序列]]"
---
# 网络 / 应用 / DB / 下游四层慢的分层排查

## 一句话速记

接口变慢，先定位是哪一层：**网络层**（丢包/重传/带宽 → `ss -i` / `ping -c 100` 看延迟分布）；**应用层**（CPU 高/GC 频繁/线程池满/锁竞争 → arthas `dashboard` / `thread -n 5`）；**DB 层**（慢查询/锁等待/连接池耗尽 → `SHOW PROCESSLIST` + slow log）；**下游层**（调用超时/熔断 → 全链路追踪看 span 耗时分布）。**逐层二分法定界，先排除网络和 DB，再查应用和下游。**

## 通俗解释（5 分钟版）

```
用户投诉「页面打不开」→ 排查路径：

网络层    ping/telnet 通不通？延迟多少？
  ↓ 通
应用层    请求进来了吗？进来的耗时多少？CPU/GC 正常吗？
  ↓ 请求进来了
DB 层    慢查询吗？锁等待吗？连接池满了吗？
  ↓ DB 正常
下游层    调了哪些下游？哪个下游慢？还是下游熔断了？
  ↓ 下游正常
→ 继续深挖：序列化慢？日志刷盘慢？磁盘 IO？
```

**核心原则**：永远先排除最外层（网络），然后按请求流经路径逐层排查。不要上来就猜"是不是 GC 导致的"——先用数据说话。

## 关键细节

### 第一层：网络（10 秒确认）

```bash
# 1. 基本连通性
ping -c 100 <host>          # 看丢包率（> 0.1% 就得查）和延迟分布
mtr -r -c 100 <host>        # 看每一跳的延迟和丢包（比 ping 更全面）

# 2. TCP 连接状态
ss -s                        # 总连接数概览
ss -tan state time-wait | wc -l    # TIME_WAIT 数量
ss -tan state close-wait | wc -l   # CLOSE_WAIT 数量（> 100 → 应用没 close socket）
ss -i                        # 看每个连接的重传/拥塞窗口

# 3. 网卡流量
sar -n DEV 1 10             # 查看网络吞吐，看是否打满网卡带宽
iftop -i eth0               # 实时看哪个 IP 流量最大

# 4. DNS
nslookup <domain>           # DNS 解析是否慢
# 应用层 DNS 缓存没配 → 每次调用都解析 → 累积几百 ms
```

**网络层排查 30 秒结论**：
```
ping 丢包 > 1%        → 网络问题，联系运维/云厂商
TIME_WAIT > 5000      → 短连接太多，改长连接或调内核参数
CLOSE_WAIT > 100      → 应用层 socket 泄漏（没 close）
网卡流量接近带宽上限   → 加带宽或限流
```

### 第二层：应用（最复杂）

```bash
# 1. 快速看整体
arthas> dashboard
# 关注：CPU 使用率、GC 次数/耗时、线程数、内存使用率

# 2. 找 CPU 最高线程
arthas> thread -n 5
# 如果某个线程长期 CPU 最高 → 可能是死循环或计算密集
# 如果 CPU 都不高但接口慢 → 可能是 IO 等待/锁竞争

# 3. 看锁竞争
arthas> thread -b          # 找 BLOCKED 线程
# BLOCKED 线程多 → synchronized 锁竞争 → 并发能力下降

# 4. 看 GC 停顿
jstat -gc <pid> 1s 20
# FGCT 持续增长 + GC 频繁 → GC 占用了大量 CPU 时间
# 接口 P99 慢 + 与 GC 时间线吻合 → GC 是根因

# 5. 看线程池
arthas> thread | grep pool | wc -l    # 线程池线程数
# 线程数接近 maxPoolSize → 线程池打满，新请求在排队
# arthas> thread --state BLOCKED | grep -c "pool"  → 线程池中有多少在等锁
```

**应用层快速判断矩阵**：
```
观察到的现象                 可能的根因             下一步
───────────────────────────────────────────────────────────
CPU 高（> 80%）            死循环/计算密集          thread -n 3 找热点方法
GC 频繁 + 停顿时间长        堆内存不够/泄漏          jstat -gc 验证 + dump
BLOCKED 线程多              锁竞争                  thread -b 找死锁/阻塞
WAITING 线程多 > 正常空闲    线程池打满/下游慢        trace 看哪步慢
CPU 正常但接口慢             等待 IO/网络/DB         看下一步
```

### 第三层：DB

```sql
-- 1. 找当前慢查询
SHOW FULL PROCESSLIST;
-- 关注：Time > 5s 的查询、State = 'Sending data'/'Creating sort index'/'Locked'

-- 2. 看锁等待
SELECT * FROM information_schema.INNODB_TRX;           -- 当前事务
SELECT * FROM information_schema.INNODB_LOCKS;         -- 当前锁
SELECT * FROM information_schema.INNODB_LOCK_WAITS;    -- 锁等待关系

-- 3. 看连接数
SHOW STATUS LIKE 'Threads_connected';   -- 当前连接数
SHOW VARIABLES LIKE 'max_connections';  -- 最大连接数
-- Threads_connected / max_connections > 0.7 → 连接池或连接泄漏问题

-- 4. 慢查询日志分析
-- 用 pt-query-digest 分析 slow log
pt-query-digest /var/log/mysql/slow.log
-- 关注：Query_time 分布、Rows_examined 很大的查询（没走索引）
```

**DB 层典型问题和对策**：
```
慢查询                        加索引 / 优化 SQL / 分库分表
锁等待（Lock wait timeout）    捋事务顺序 / 缩短事务 / 减小锁定范围
连接池满                       检查连接泄漏 / 增大连接池 / 加只读实例
CPU 高                         可能是慢查询导致排序/临时表 → 查 processlist
```

### 第四层：下游

```bash
# 1. 全链路追踪（SkyWalking / Zipkin / Jaeger）
# 找出耗时最长的 span → 定位到具体下游接口

# 2. 没有全链路？查日志
grep "调用.*超时\|timeout\|connect.*refused" /var/log/app.log | tail -100

# 3. 看熔断状态
# Sentinel / Hystrix 的 dashboard 看熔断器是否打开
# 熔断打开 → 下游已经挂了，快速失败是正常的
```

**下游排查清单**：
```
下游接口 P99 是多少？              → 全链路追踪 span 耗时
下游有没有超时/熔断？               → 监控 dashboard
超时时间设得合理吗？                → 你的 timeout 和下游 P99 的关系
有没有重试？重试是否放大了请求？     → 重试策略检查
连接池是否耗尽？（http client pool） → 同应用层线程池排查
```

### 完整排查流程总结

```
用户：接口 P99 从 200ms 涨到 3s

1. 网络（10 秒，先排除）
   ping/mtr → 正常（排除网络）

2. 应用（2 分钟，看仪表盘）
   dashboard → CPU 30% 正常
   jstat -gc → Full GC 不频繁
   thread -n 5 → CPU 不高，没死循环
   thread -b → 没有 BLOCKED
   → 不太像应用自身问题

3. DB（1 分钟）
   SHOW PROCESSLIST → 发现 5 个查询 State=Sending data, Time>10s
   → DB 层！某个慢查询拖慢了整个接口
   explain → 没走索引，全表扫描 200w 行

4. 修复
   加索引 → P99 回到 200ms
```

## 延伸追问

- **Q：四层都没问题，但接口就是慢？**
  → 查日志框架（logback 同步写盘可能 100ms+）、序列化（大对象 JSON 序列化）、安全框架（每次请求查 DB 鉴权）、过滤器链（某个 Filter 做了耗时操作）。用 arthas `trace` 追每一层耗时。
- **Q：应用层 CPU 不高但接口慢，最常见原因？**
  → IO 等待（等 DB/等下游/等网络），线程在 WAITING 状态而非 RUNNABLE。看 jstack 的 WAITING 线程比例，arthas `trace` 看哪步 IO 耗时最大。
- **Q：网络排查中 MTR 比 ping 好在哪？**
  → ping 只看端到端，MTR 看每一跳。如果第 3 跳丢包 30% 但后面正常 → 可能只是那台路由器不响应 ICMP。如果最后 3 跳同步丢包 → 链路上有真实丢包。

## 我的记法

- **四层法**：网络（ping/ss/mtr）→ 应用（dashboard/thread/jstat）→ DB（PROCESSLIST/locks）→ 下游（全链路 span）
- **核心原则**：逐层二分法定界，先排除最简单的（网络），再查最复杂的（应用）
- **快速定位**：70% 的慢接口问题在 DB 层（慢查询/锁/连接池），20% 在下游，10% 在应用/网络
- 一句话：**「从外到内逐层排查，拿着数据说哪层慢，别猜」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
