---
tags: [P0, 数据库, 生疏]
相关: "[[04-数据库与中间件/index]]"
---

# EXPLAIN 的 type / rows / Extra 怎么看

## 一句话速记

**`type` 是最重要的字段**，代表"扫描方式"，从最优到最差：`system > const > eq_ref > ref > range > index > ALL`；**`rows` 是估算扫描行数**（越小越好）；**`Extra`** 中出现 `Using filesort` 或 `Using temporary` 是危险信号，说明有额外排序或临时表，需要优化。实战中先看 type 是否达到 ref/range 以上，再看 rows 量级，最后看 Extra。

## 关键细节

### 1）type 字段详解

```
type 值       含义                        举例
──────────────────────────────────────────────────────────────────────
system        系统表/只有 1 行             查 information_schema 系统表
const         主键/唯一索引等值查询（最多1行）WHERE id=1（id 是主键）
eq_ref        JOIN 时，被驱动表用主键/唯一索引  A JOIN B ON A.id=B.id（B.id 是主键）
ref           非唯一索引等值查询            WHERE status=1（status 有索引但不唯一）
ref_or_null   ref + IS NULL 查询           WHERE name='Alice' OR name IS NULL
range         索引范围查询                 WHERE id BETWEEN 1 AND 100 / WHERE id > 5
index         全索引扫描（比 ALL 好一点）   SELECT id FROM t（id 是索引，扫描索引树）
ALL           全表扫描                    没有索引或无法用索引
```

**记忆技巧**：`const > eq_ref > ref > range > index > ALL`

- `const`：拿钥匙直接开门（等值 + 唯一）
- `ref`：按楼层找（索引等值，可能多行）
- `range`：按区间找（索引范围）
- `ALL`：逐个房间搜（全表扫描）

**实战标准**：
- 生产查询至少要求 `range` 或以上
- `ALL` 在大表（100w+）是灾难，立即优化
- `index` 看起来用了索引但实际全扫索引树，大表同样危险

### 2）rows 字段

```
rows = 优化器估算需要检查的行数
实际含义：
  - 不是精确值，是基于统计信息的估算
  - INNODB 的统计信息通过采样得到，可能不准
  - rows × filtered(%) = 实际预计返回行数

-- 查看实际执行行数（MySQL 8.0+）：
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id=1;
-- 输出包含：actual rows=xxx（实际扫描行数），与 rows 估算对比
```

**rows 估算不准怎么办**：

```sql
-- 强制更新统计信息
ANALYZE TABLE orders;

-- 查看索引统计
SHOW INDEX FROM orders;
-- Cardinality 列：索引的基数估算（唯一值数量）
-- Cardinality 越大，区分度越高，索引越有价值
```

### 3）Extra 字段详解

```
Extra 值                    含义                          危险程度
────────────────────────────────────────────────────────────────────
Using where                 在存储引擎返回后用 WHERE 过滤    正常（联合索引部分匹配）
Using index                 覆盖索引（不需要回表）          ✅ 最优
Using index condition       索引下推（ICP）                ✅ 优化
Using filesort              额外排序（可能内存或磁盘）       ⚠️ 需优化
Using temporary             用了临时表（GROUP BY/DISTINCT） ⚠️ 严重
Using join buffer           Block Nested Loop JOIN          ⚠️ 缺 JOIN 索引
NULL                        正常，索引查找直接匹配           正常
```

**关键 Extra 值详解**：

```sql
-- ✅ Using index（覆盖索引）
-- 查询的列都在索引里，不需要回表
CREATE INDEX idx_name_age ON users(name, age);
EXPLAIN SELECT name, age FROM users WHERE name='Alice';
-- Extra: Using index（name 和 age 都在联合索引里）

-- ⚠️ Using filesort（文件排序）
-- ORDER BY 的列不在索引里，或顺序不对
EXPLAIN SELECT * FROM users WHERE status=1 ORDER BY created_at DESC;
-- 如果 created_at 没有索引，就需要 filesort
-- 修复：添加 (status, created_at) 联合索引

-- ⚠️ Using temporary（临时表）
-- GROUP BY 分组字段没有索引
EXPLAIN SELECT status, COUNT(*) FROM users GROUP BY status;
-- 如果 status 没有索引 → Using temporary; Using filesort
-- 修复：给 status 加索引

-- ✅ Using index condition（索引下推 ICP）
-- MySQL 5.6+ 在索引层过滤（减少回表次数）
CREATE INDEX idx_name_age ON users(name, age);
EXPLAIN SELECT * FROM users WHERE name LIKE 'Alice%' AND age > 20;
-- name LIKE 'Alice%' 可以用前缀索引，age>20 在存储引擎层过滤（ICP）
-- 不用把所有 name LIKE 'Alice%' 的行都回表再过滤 age
```

### 4）一个完整 EXPLAIN 分析示例

```sql
EXPLAIN
SELECT u.name, o.amount
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.status = 1 AND o.amount > 100
ORDER BY o.created_at DESC
LIMIT 10;
```

```
+----+-------+-------+------+--------------+------+----------+------------------------------+
| id | table | type  | key  | rows         | filt | filtered | Extra                        |
+----+-------+-------+------+--------------+------+----------+------------------------------+
|  1 | u     | ref   | idx_status | 5000  | 100.0 |         | Using where; Using index     |
|  1 | o     | ref   | idx_uid    | 8     | 50.0  |         | Using where; Using filesort  |
+----+-------+-------+------+--------------+------+----------+------------------------------+

分析：
- u 表：type=ref（status 有索引），rows=5000（估算），Extra Using index condition
- o 表：type=ref（user_id 有索引），rows=8，但 Extra 有 Using filesort
  → ORDER BY created_at 没有用到索引，需要排序

优化方向：
  - 给 orders 加联合索引 (user_id, created_at, amount)
  - 或者接受 filesort（如果结果集小，filesort 在内存完成，影响不大）
```

### 5）实战 Checklist

```
看到 EXPLAIN 时的处理步骤：

1. 找 type=ALL 的表 → 立即检查是否需要加索引
2. 找 Extra 含 Using filesort → 检查 ORDER BY 字段是否在索引里
3. 找 Extra 含 Using temporary → 检查 GROUP BY/DISTINCT 字段是否有索引
4. 看 rows 量级 → 多表 JOIN 时，rows 的乘积就是全部扫描量
5. 看 key 字段 → 是否用了预期的索引（优化器可能选错索引）
6. 强制指定索引（非常手段）：SELECT ... FROM t FORCE INDEX(idx_name) ...
```

## 延伸追问

- **Q：`possible_keys` 和 `key` 的区别？**
  → `possible_keys` 是优化器认为可能用到的索引候选；`key` 是实际选择的索引。如果 `possible_keys` 非空但 `key` 是 NULL，说明优化器判断全表扫描更划算（如数据量极小，或统计信息不准）——可以用 `FORCE INDEX` 强制指定。
- **Q：`filtered` 字段是什么？**
  → `filtered` 是估算的过滤率（%），表示经过 WHERE 条件过滤后剩余多少行。`rows × filtered / 100` = 预计传递给下一步的行数。JOIN 优化时这个值很重要——驱动表选过滤后行数最少的。
- **Q：怎么快速判断索引是否有效（被优化器使用）？**
  → 看 `key` 字段非 NULL 且 `type` 不是 `ALL` 或 `index`（全扫描）。最快的验证：`EXPLAIN SELECT 1 FROM t WHERE cond LIMIT 1`，如果 type=ref/range，索引有效。

## 我的记法

- type 优先级：`const > eq_ref > ref > range > index > ALL`，生产要 `range` 以上
- `rows` 是估算，越小越好，可用 `EXPLAIN ANALYZE` 看实际值
- **Extra 红旗**：`Using filesort`（ORDER BY 没用上索引）、`Using temporary`（GROUP BY 没索引）
- `Using index` = 覆盖索引，最优，不回表
- 一句话：**「看 EXPLAIN 先看 type 是否全表扫，再看 Extra 有没有 filesort/temporary」**

## 状态
- [ ] 已背速记（type 优先级）
- [ ] 能解释 Using filesort 和 Using index 的区别
- [ ] 能分析一个多表 JOIN 的 EXPLAIN 输出
