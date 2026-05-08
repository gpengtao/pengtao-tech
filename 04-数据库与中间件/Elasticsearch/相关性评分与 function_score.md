---
tags: [P1, ES, 生疏]
相关: "[[04-数据库与中间件/index]]"
---
# 相关性评分与业务排序的结合（function_score）

## 一句话速记

**ES 默认按 `_score`（相关性评分）排序**，基于 BM25（TF-IDF 改进版）计算文本相关性；**业务排序**通常需要综合多个因素（评分、价格、距离、新鲜度）——用 **`function_score` 查询**将业务规则融入评分计算：多个 score function（field_value_factor、gauss 衰减函数等）+ 原始 `_score` 共同决定最终排名。

## 关键细节

### 1）默认相关性评分：BM25

```
TF-IDF（传统）：
  TF（词频）：词在文档中出现越多，评分越高
  IDF（逆文档频率）：词在所有文档中越罕见，越有价值

BM25（ES 5.0+ 默认）：
  对 TF 做饱和处理（TF 高到一定程度不再线性增加）
  参数 k1（TF 饱和度）+ b（长度归一化）
  更符合实际搜索体验
  
  score(D, Q) = ∑ IDF(qi) × TF(qi, D) × (k1+1) / (TF + k1 × (1-b + b × |D|/avgdl))
```

**`_explain` 查看评分细节**：

```json
GET /hotel/_explain/123
{
  "query": { "match": { "name": "机器学习" } }
}
// 返回详细的评分计算过程（各词项的 TF/IDF 和最终得分）
```

### 2）function_score 的完整结构

```json
GET /hotel/_search
{
  "query": {
    "function_score": {
      "query": {                     // 基础查询（决定候选集合）
        "bool": {
          "must": [
            { "match": { "city": "北京" } }
          ],
          "should": [
            { "match": { "name": { "query": "豪华酒店", "boost": 1.5 } } }
          ]
        }
      },
      
      "functions": [                 // 多个 score function（叠加计算）
        
        // Function 1：用评分字段直接影响分数
        {
          "field_value_factor": {
            "field": "star_level",   // 星级字段
            "factor": 1.5,           // 乘数
            "modifier": "log1p",     // 对数处理（防止高值太突出）
            "missing": 1             // 字段缺失时的默认值
          }
        },
        
        // Function 2：距离衰减（越远评分越低）
        {
          "gauss": {
            "location": {
              "origin": "39.9, 116.4",  // 搜索中心点（天安门）
              "scale": "5km",           // 5km 内评分衰减到 0.5
              "decay": 0.5
            }
          }
        },
        
        // Function 3：时间衰减（越旧评分越低）
        {
          "gauss": {
            "created_at": {
              "origin": "now",
              "scale": "30d",           // 30 天内衰减到 0.5
              "decay": 0.5
            }
          }
        },
        
        // Function 4：随机因子（打散排名，避免"马太效应"）
        {
          "random_score": { "seed": 12345 },
          "weight": 0.1
        }
      ],
      
      "score_mode": "multiply",    // 多个 function 的合并方式
      // multiply：所有 function 分数相乘（默认）
      // sum：相加
      // avg：平均
      // max / min：取最大/最小
      // first：只用第一个匹配的 function
      
      "boost_mode": "multiply",    // function 总分与原始 query._score 的合并方式
      // multiply：query._score × function_score
      // sum / replace / avg / max / min
      
      "max_boost": 5.0             // function score 的上限（防止某个 function 分数爆炸）
    }
  }
}
```

### 3）常用 Score Function 详解

**field_value_factor（字段值直接影响评分）**：

```json
{
  "field_value_factor": {
    "field": "rating",          // 用 rating 字段值
    "factor": 2.0,              // 乘以 2.0
    "modifier": "log1p",        // 修饰符：log1p(x) = log(1+x)，平滑处理
    // modifier 选项：none（直接用值）/ log / log1p / log2p / ln / ln1p / sqrt / square
    "missing": 2.5              // rating 字段缺失时用 2.5
  }
  // 最终 score = log1p(rating) × 2.0
}
```

**gauss 衰减函数（距离/时间）**：

```json
{
  "gauss": {             // gauss / exp（指数）/ linear（线性）
    "price": {
      "origin": 500,     // 目标值（最优价格）
      "scale": 200,      // 200 元内，评分衰减到 decay 值
      "offset": 50,      // ±50 元内不衰减（零分区）
      "decay": 0.5       // 衰减到 0.5（half-life）
    }
  }
  // 价格=500：score=1.0
  // 价格=700（距 500 差 200）：score=0.5
  // 价格=900（距 500 差 400）：score≈0.25
}
```

**script_score（最灵活，用 Painless 脚本）**：

```json
{
  "script_score": {
    "script": {
      "source": """
        double score = 0;
        // 好评数影响
        if (doc['review_count'].size() > 0) {
          score += Math.log1p(doc['review_count'].value) * 2;
        }
        // 近 7 天热度
        if (doc['last_7d_views'].size() > 0) {
          score += doc['last_7d_views'].value * 0.1;
        }
        return score;
      """
    }
  }
  // 注意：script_score 每次查询都在 JVM 中执行，大量文档时有性能开销
}
```

### 4）实际业务场景：酒店搜索

```json
// 需求：搜索北京的酒店，排序考虑：文本相关性 + 星级 + 距离 + 价格区间
GET /hotel/_search
{
  "query": {
    "function_score": {
      "query": {
        "bool": {
          "must": [
            { "term": { "city": "北京" } }
          ],
          "should": [
            { "match": { "name": "商务酒店" } },
            { "match": { "description": "商务" } }
          ]
        }
      },
      "functions": [
        {
          "field_value_factor": {
            "field": "star_level",
            "modifier": "log1p",
            "factor": 1.2
          }
        },
        {
          "gauss": {
            "location": {
              "origin": "39.914, 116.404",  // 搜索中心
              "scale": "10km",
              "decay": 0.5
            }
          },
          "weight": 2  // 地理位置权重 × 2
        }
      ],
      "score_mode": "sum",
      "boost_mode": "multiply"
    }
  },
  "sort": [
    { "_score": "desc" }  // 按综合评分降序
  ]
}
```

### 5）纯业务排序（不用 _score）

```json
// 如果不需要文本相关性，纯按业务字段排序
GET /hotel/_search
{
  "query": { "term": { "city": "北京" } },
  "sort": [
    { "star_level": "desc" },    // 先按星级
    { "review_score": "desc" },  // 再按评分
    { "price": "asc" }           // 最后按价格
  ]
}
// 这种情况：_score 不计算，性能更好（track_scores: false）
```

## 延伸追问

- **Q：`function_score` 中 `score_mode` 和 `boost_mode` 的区别？**
  → `score_mode`：多个 function 之间的合并方式（如 3 个 function 各出一个分数，怎么合并成一个 function score）；`boost_mode`：function score 和原始 `query._score` 的合并方式。通常 `score_mode=sum`（多个因素加权累加）+ `boost_mode=multiply`（再乘以文本相关性）效果较好。
- **Q：排序字段是 text 类型会有什么问题？**
  → text 字段没有 Doc Values（默认），无法排序。需要用 `keyword` 子字段或 `fielddata: true`（高内存开销，不推荐）。正确做法：在 Mapping 设计时，需要排序的字段声明为 `keyword` 或 numeric。
- **Q：function_score 的性能怎么样？**
  → function_score 在候选文档集合（query 匹配的文档）上逐一计算，复杂度 O(匹配文档数 × function 复杂度)。`field_value_factor` 和 `gauss` 用 Doc Values（已预加载到内存）速度很快；`script_score` 有 JVM 执行开销，大量文档时谨慎。可以用 `filter` 先减少候选集，再 function_score。

## 我的记法

- **BM25 = TF-IDF + 词频饱和 + 长度归一化**，ES 默认
- **function_score**：基础查询（候选集）+ functions（业务因素）→ 综合评分
- 常用：`field_value_factor`（数值字段影响评分）、`gauss`（距离/时间衰减）
- `score_mode`：多 function 合并；`boost_mode`：function score 和 query score 合并
- `_explain` 查看评分明细
- 一句话：**「function_score = 把星级/距离/时间等业务因素揉进搜索排序里」**

## 状态
- [ ] 已背速记
- [ ] 能写 function_score 含 field_value_factor + gauss 的查询
- [ ] 能解释 score_mode vs boost_mode
