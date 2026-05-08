---
tags: [P1, Redis, 生疏]
相关: "[[04-数据库与中间件/index]]"
---

# Redis 持久化：RDB / AOF 的取舍

## 一句话速记

**RDB**（快照）= 某时刻全量数据的二进制快照，恢复快但有数据丢失风险（上次快照后的数据）；**AOF**（日志）= 记录每条写命令，丢失数据少（最多 1s），但文件大、恢复慢；**混合持久化**（Redis 4.0+）= AOF 文件内嵌 RDB 快照 + 增量命令，兼顾恢复速度和数据安全，**生产推荐混合模式**。

## 关键细节

### 1）RDB（Redis Database）

**原理**：

```
redis.conf 配置触发条件：
  save 900 1    # 900 秒内至少 1 次写操作 → 触发
  save 300 10   # 300 秒内至少 10 次写操作 → 触发
  save 60 10000 # 60 秒内至少 10000 次写操作 → 触发

触发方式：
  SAVE：同步，阻塞 Redis（危险！）
  BGSAVE：后台 fork() 子进程做快照，主进程继续服务（推荐）
  
fork() 的写时复制（COW）：
  父进程 fork 出子进程（共享内存），写时才复制修改页
  → 快照期间父进程的写操作不影响子进程看到的数据（快照时刻的一致视图）
  → 但如果写操作很频繁，COW 触发大量页复制 → 内存占用峰值翻倍
```

**RDB 的优缺点**：

```
优点：
  - 文件紧凑（二进制压缩），远小于 AOF
  - 恢复速度快（直接 load 整个数据集）
  - 适合备份和灾难恢复（定时 BGSAVE 传到对象存储）
  - fork() 后对主进程影响小

缺点：
  - 数据丢失风险：上次快照到宕机期间的写操作丢失（可能几分钟到几小时）
  - fork() 本身有开销（大内存实例 fork 需要几百毫秒）
  - 不适合要求低数据丢失的场景
```

### 2）AOF（Append Only File）

**原理**：

```
每条写命令追加到 AOF 文件（文本格式）：
  SET key value → 追加 "*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n"

fsync 策略（何时将 AOF buffer 落盘）：
  appendfsync always    → 每条命令 fsync（最安全，性能最差）
  appendfsync everysec  → 每秒 fsync（推荐，最多丢 1 秒数据）
  appendfsync no        → 由 OS 决定（最快，可能丢数据）

AOF 重写（解决 AOF 文件膨胀）：
  BGREWRITEAOF：后台进程重写 AOF
  将历史命令压缩为当前数据的最小指令集
  SET key 1; SET key 2; SET key 3 → 只保留 SET key 3
  触发条件：
    auto-aof-rewrite-percentage 100  # AOF 文件比上次重写后大 100%
    auto-aof-rewrite-min-size 64mb   # 且大于 64MB
```

**AOF 的优缺点**：

```
优点：
  - 数据安全：everysec 最多丢 1 秒，always 完全不丢
  - 可读性：文本格式，可以手动修复（删除错误命令）
  
缺点：
  - 文件大：相同数据 AOF >> RDB（命令多，重复记录中间状态）
  - 恢复慢：需要重放所有命令（大数据集需要几分钟到几十分钟）
  - 重写期间双 buffer 占用内存
```

### 3）混合持久化（推荐，Redis 4.0+）

```
aof-use-rdb-preamble yes  # 开启混合持久化

混合持久化的 AOF 文件结构：
  [RDB 格式快照] + [RDB 快照后的 AOF 增量命令]

重写时：
  子进程将当前数据以 RDB 格式写入 AOF 文件前部分
  主进程的增量写命令追加到 AOF 文件后部分

恢复时：
  先加载 RDB 部分（快速，恢复大部分数据）
  再重放 AOF 增量命令（少量，快速）
  
优点：
  - 恢复速度接近 RDB（快）
  - 数据丢失量接近 AOF（最多 1 秒）
  - 文件大小介于 RDB 和纯 AOF 之间
```

### 4）生产配置建议

```
场景                         推荐方案
──────────────────────────────────────────────────────────────
缓存（丢数据无所谓）         不开持久化（save "" 禁用 RDB，关闭 AOF）
会话/令牌存储（少量丢可以）  RDB（定时快照，简单）
限流/计数器（轻微丢可以）    RDB 或关闭持久化
队列/锁（丢失影响较大）      AOF everysec 或混合模式
主要数据存储（不允许丢失）   混合持久化 + 主从复制
```

**标准生产 redis.conf**：

```conf
# 混合持久化（推荐）
aof-use-rdb-preamble yes
appendonly yes
appendfsync everysec
no-appendfsync-on-rewrite yes  # 重写时不 fsync（减少 I/O）

# 禁用 RDB 定时快照（混合模式下 RDB 由 AOF 重写包含）
save ""

# 或同时开启 RDB（提供额外的备份）
save 86400 1  # 每天至少一次快照

# 内存配置
maxmemory 16gb
maxmemory-policy allkeys-lru  # 内存满了按 LRU 淘汰
```

### 5）主从复制 + 持久化（高可用方案）

```
生产标准架构：
  Master → Slave1（同步复制）
         → Slave2（同步复制）
  
  Master：关闭 RDB 和 AOF（减少持久化开销，提高写性能）
  Slave：开启 AOF everysec（承担持久化，不影响 Master）
  
  哨兵（Sentinel）：监控主从，Master 宕机时自动切换 Slave 为 Master
  
  注意：
    如果 Master 重启时没有持久化文件 → 空实例
    → 同步到 Slave → Slave 数据被清空（主从都没数据了！）
    → 所以 Master 也要开启 RDB 或 AOF 作为保险
```

## 延伸追问

- **Q：Redis 主进程 fork() 时会阻塞多久？**
  → fork() 本身在 Linux 下是写时复制，对内存的复制是懒惰的（不实际复制页），但需要复制页表（page table）。内存越大，fork 耗时越长：通常 1GB 内存约 10ms，16GB 约 200ms。在这段时间里 Redis 无法响应请求。优化：减少单实例内存（<8GB），避免大内存单实例。
- **Q：AOF 重写时如果进程崩溃，数据会丢失吗？**
  → 不会。重写是原子切换：旧 AOF 文件继续追加命令，子进程写临时文件（temp-rewriteaof-pid.aof），重写完成后原子重命名（rename 系统调用）替换旧文件。崩溃时旧文件还在，不丢数据。
- **Q：关闭持久化的 Redis 实例，主从之间怎么同步？**
  → 主从复制本身是实时的（TCP 流同步），不依赖持久化文件。Slave 连接 Master 时，Master 执行 BGSAVE 生成临时 RDB 传给 Slave（全量同步），之后实时同步写命令（增量）。关闭持久化只影响数据能否在宕机后恢复，不影响主从复制。

## 我的记法

- **RDB**：快照，恢复快，可能丢几分钟数据，适合备份
- **AOF**：命令日志，everysec 丢 ≤1 秒，恢复慢
- **混合模式**（aof-use-rdb-preamble=yes）：**生产推荐**，快速恢复 + 数据安全
- **纯缓存场景**：关闭所有持久化（提高性能）
- fork() 阻塞 → 控制单实例内存大小（< 8GB）
- 一句话：**「生产用混合持久化，缓存场景不持久化，主从分担持久化压力」**

## 状态
- [ ] 已背速记
- [ ] 能说混合持久化的文件结构
- [ ] 能说生产标准 redis.conf 配置
