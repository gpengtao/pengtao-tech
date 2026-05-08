---
tags: [P1, 数据库, 生疏]
相关: "[[04-数据库与中间件/_MOC]]"
---

# 批量 UPDATE 10w 行怎么做（分批大小 / Binlog 对主从延迟的影响）

## 一句话速记

**不要一次 `UPDATE` 10w 行**：会产生一个巨大事务（长时间持锁 + 巨量 Binlog），导致主从延迟飙升、锁表影响业务。正确做法是**分批处理**：每批 500~2000 行，每批 commit 后 sleep 几十毫秒，让从库追上，再处理下一批。分批依据：按主键 ID 范围分段（`WHERE id BETWEEN ? AND ?`），避免 OFFSET 扫描。

## 关键细节

### 1）一次 UPDATE 10w 行的危害

```
1. 长事务 → 长时间持 Row Lock（其他写操作被阻塞）
2. Undo Log 膨胀（MVCC 版本链积累）
3. Binlog 产生巨大事务（10w 行的 ROW Binlog）
4. 从库回放 Binlog 是串行的（MySQL 5.6 以前完全串行）
   → 从库回放时间 >> 主库执行时间 → 主从延迟剧增
5. 如果 MySQL 崩溃，事务回滚时间极长（Undo Log 太大）
```

### 2）分批 UPDATE 的标准写法

```sql
-- 正确：按主键范围分批（效率最高）
SET @batch_size = 1000;
SET @start_id = 0;

LOOP:
  UPDATE orders
  SET status = 2
  WHERE id > @start_id AND id <= @start_id + @batch_size
    AND status = 1;
  
  SET @start_id = @start_id + @batch_size;
  
  -- 每批后 sleep，让从库追上
  DO SLEEP(0.05);  -- 50ms
  
  IF @start_id > (SELECT MAX(id) FROM orders) THEN
    BREAK;
  END IF;
```

**更实用的脚本写法（Shell + MySQL）**：

```bash
#!/bin/bash
BATCH=1000
START=0
MAX=$(mysql -e "SELECT MAX(id) FROM orders" -ss)

while [ $START -lt $MAX ]; do
    END=$((START + BATCH))
    mysql -e "UPDATE orders SET status=2 WHERE id > $START AND id <= $END AND status=1"
    echo "Updated $START to $END"
    START=$END
    sleep 0.05  # 50ms
done
```

**Java 业务代码中的分批**：

```java
@Transactional(propagation = Propagation.NOT_SUPPORTED)  // 不用大事务
public void batchUpdate() {
    int batchSize = 1000;
    long startId = 0;
    long maxId = orderMapper.getMaxId();
    
    while (startId < maxId) {
        long endId = startId + batchSize;
        int affected = orderMapper.batchUpdateByIdRange(startId, endId);
        log.info("Updated {} rows, range [{}, {}]", affected, startId, endId);
        startId = endId;
        
        try {
            Thread.sleep(50); // 50ms sleep
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            break;
        }
    }
}
```

### 3）为什么按 ID 范围而不是 OFFSET 分批

```sql
-- ❌ 错误：OFFSET 分批（越来越慢）
UPDATE orders SET status=2 WHERE status=1 LIMIT 1000 OFFSET 0;
UPDATE orders SET status=2 WHERE status=1 LIMIT 1000 OFFSET 1000;
-- 第 N 批需要扫描前 N*1000 行 → O(N²) 复杂度，最后几批极慢

-- ✅ 正确：ID 范围分批（O(N)）
UPDATE orders SET status=2 WHERE id BETWEEN 1 AND 1000 AND status=1;
UPDATE orders SET status=2 WHERE id BETWEEN 1001 AND 2000 AND status=1;
-- 每批只扫描对应 ID 区间，效率稳定
```

**如果没有单调递增 ID（如按时间范围）**：

```sql
-- 按时间范围分批（注意：覆盖同一批的 status 改变会导致跳过）
-- 更安全：先查出 ID，再按 ID 批量更新
SELECT id FROM orders WHERE status=1 AND created_at < '2024-01-01' LIMIT 1000;
-- 拿到 id 列表，再 UPDATE WHERE id IN (...)
```

### 4）Binlog 对主从延迟的影响

```
Binlog 类型对主从延迟的影响：

Statement-Based Replication (SBR)：
  记录 SQL 语句
  批量 UPDATE: 一条 SQL → Binlog 很小
  但可能主从不一致（非确定性函数，RC 隔离级别下）

Row-Based Replication (RBR)：
  记录每行的变化（before + after 镜像）
  批量 UPDATE 10w 行 → Binlog 中 10w 条行变化记录 → Binlog 极大
  从库回放：读取每条行变化，逐行应用 → 时间长 → 延迟大

从库并行复制（解决延迟的关键）：
  MySQL 5.6：基于 Schema 的并行复制（不同库并行）
  MySQL 5.7：基于 Logical Clock 的并行复制（同一 Group Commit 的事务并行）
  MySQL 8.0：WRITESET 复制（不冲突的事务并行，更优）

分批 UPDATE 的好处：
  每批是独立小事务 → 主库 Group Commit 可以并发提交
  → 从库并行回放（不同批次无冲突）
  → 大幅减少主从延迟
```

### 5）实际场景：online DDL vs pt-online-schema-change

```
大表加字段/加索引的选择：

MySQL 5.6+ Online DDL：
  ALTER TABLE t ADD COLUMN c INT DEFAULT 0;
  → 不阻塞 DML（读写），但会加元数据锁（MDL）
  → 期间产生大量 row log，完成时合并 → 影响写性能
  → 适合：中小表（< 5 亿行）

pt-online-schema-change（pt-osc）：
  创建影子表 → 增量同步 → 原子切换
  → 分批复制数据，控制速度，主从延迟低
  → 适合：超大表、对主从延迟敏感的场景

gh-ost（GitHub Online Schema Tool）：
  读 Binlog 而非触发器 → 对主库压力更小
  → 适合：高并发大表，对主库压力敏感
```

## 延伸追问

- **Q：分批 UPDATE 中途失败了怎么办？**
  → 因为每批是独立事务，失败只影响当前批次，重新从失败的 ID 范围继续即可。记录最后成功的 `start_id`（写到 Redis 或配置文件），重启时从这里继续。这是幂等性设计——`UPDATE ... WHERE status=1` 对已更新的行无效。
- **Q：分批 UPDATE 期间，业务还在写入新数据，会漏掉吗？**
  → 取决于分批策略。如果按当前最大 ID 分段，之后新插入的行（更大 ID）不在范围内，确实漏掉。需要在分批结束后再做一次全量扫描（`WHERE status=1 AND id <= snapshot_max_id`），或者分批结束后跑一次 `UPDATE` 覆盖新增范围。
- **Q：如何监控主从延迟？**
  → `SHOW SLAVE STATUS\G` 看 `Seconds_Behind_Master`（不够精准）；更精准：Percona PMM、Prometheus + mysqld_exporter（`mysql_slave_lag_seconds` 指标）。或用 Heartbeat 表（pt-heartbeat）：主库定时写时间戳，从库读时间戳差值即为真实延迟。

## 我的记法

- **分批核心**：按主键 ID 范围，每批 500~2000，批间 sleep 50ms
- 不用 OFFSET（越来越慢），不用一次性大事务（延迟 + 锁）
- Binlog ROW 格式下，10w 行 = 10w 条 Binlog 记录 → 从库回放慢
- 分批 → 小事务 → 从库并行回放 → 延迟可控
- 一句话：**「大批量更新 = 切成 1000 行一批 + 批间 sleep，让从库喘气」**

## 状态
- [ ] 已背速记
- [ ] 能写分批更新的 SQL/代码框架
- [ ] 能解释 Binlog 对主从延迟的影响
