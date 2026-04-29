---
tags: [P1, 系统设计, 生疏]
相关: [[05-分布式与架构/_MOC]]
---

# 设计多租户的 LLM 平台隔离（算力 / 配额 / 审计）

## 一句话速记

多租户 LLM 平台的核心挑战：**隔离**（租户间互不影响）+ **配额控制**（防止一个租户耗尽资源）+ **审计**（每次调用可追溯）。实现方式：租户 API Key 鉴权 → 配额检查（Redis 令牌桶）→ 路由到模型实例 → 流式代理 → 异步记录用量 → 账单结算。

## 系统需求

```
功能：
  租户管理（注册、配置模型访问权限、配额设置）
  API 兼容 OpenAI 格式（减少接入成本）
  多模型支持（GPT-4o, Claude, 自部署 Llama）
  配额：Token 数/天、请求数/分钟、并发数
  审计：每次调用的 prompt/response/token 数/耗时/费用

规模：
  1000 个租户
  峰值 10 万 QPS（主要是向 LLM 的代理调用）
  LLM 响应：平均 2-10 秒（流式）
```

## 核心设计

### 1）租户隔离层次

```
Level 1：网络隔离（最强，成本最高）
  每个租户独立 VPC，专用网络通道
  适用：金融/医疗/政府（数据安全合规）

Level 2：进程/Pod 隔离（中等）
  每个租户独立 Pod 或进程
  适用：Enterprise 客户，愿意付高价

Level 3：逻辑隔离（轻量，成本低）
  共享基础设施，通过代码逻辑隔离（配额、数据权限）
  适用：SaaS 大多数租户（SMB 客户）

互联网 LLM 平台通常：
  大租户（Enterprise）→ Level 2
  中小租户 → Level 3
```

### 2）认证与鉴权

```python
# 每个租户生成 API Key（类似 OpenAI sk-xxx）
# 格式：llm-{tenant_id}-{random_hex_32}

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    api_key = request.headers.get("Authorization", "").replace("Bearer ", "")
    
    if not api_key.startswith("llm-"):
        return JSONResponse({"error": "Invalid API key"}, status_code=401)
    
    # 查 Redis（热路径，DB 太慢）
    tenant = redis.hgetall(f"tenant:{api_key}")
    if not tenant:
        # Redis 未命中，查 DB
        tenant_record = db.query("SELECT * FROM tenants WHERE api_key=?", api_key)
        if not tenant_record:
            return JSONResponse({"error": "Invalid API key"}, status_code=401)
        # 写入 Redis（TTL=5min，5分钟内不查 DB）
        redis.hmset(f"tenant:{api_key}", {...tenant_record})
        redis.expire(f"tenant:{api_key}", 300)
        tenant = tenant_record
    
    # 注入 tenant 上下文
    request.state.tenant_id = tenant["tenant_id"]
    request.state.tenant_config = tenant
    return await call_next(request)
```

### 3）配额控制（多维度）

**维度 1：请求速率限制（RPM）**：

```python
# Redis 滑动窗口限流
async def check_rpm(tenant_id: str, limit: int) -> bool:
    """检查每分钟请求数"""
    key = f"quota:rpm:{tenant_id}"
    now = int(time.time() * 1000)  # 毫秒时间戳
    window = 60_000  # 60 秒窗口
    
    pipeline = redis.pipeline()
    pipeline.zremrangebyscore(key, 0, now - window)
    pipeline.zadd(key, {str(now): now})
    pipeline.zcard(key)
    pipeline.expire(key, 60)
    results = await pipeline.execute()
    
    current_count = results[2]
    return current_count <= limit
```

**维度 2：Token 配额（每日/每月）**：

```python
async def check_and_reserve_tokens(tenant_id: str, estimated_tokens: int) -> bool:
    """预检查 + 预占配额（请求前）"""
    key = f"quota:tokens:{tenant_id}:{date.today()}"
    
    # 原子操作：检查剩余配额 + 预占
    script = """
        local remaining = tonumber(redis.call('get', KEYS[1]) or '0')
        local limit = tonumber(ARGV[1])
        local need = tonumber(ARGV[2])
        if remaining + need > limit then
            return -1  -- 超出配额
        end
        return redis.call('incrby', KEYS[1], need)
    """
    result = await redis.eval(script, 1, key, daily_limit, estimated_tokens)
    return result != -1

async def update_actual_tokens(tenant_id: str, estimated: int, actual: int):
    """请求完成后修正实际用量"""
    key = f"quota:tokens:{tenant_id}:{date.today()}"
    diff = actual - estimated
    if diff != 0:
        await redis.incrby(key, diff)  # 正值=多用，负值=少用（退回）
```

**维度 3：并发数限制**：

```python
from asyncio import Semaphore

# 每个租户最多 10 个并发请求
tenant_semaphores: dict[str, Semaphore] = {}

async def get_semaphore(tenant_id: str, max_concurrent: int) -> Semaphore:
    if tenant_id not in tenant_semaphores:
        tenant_semaphores[tenant_id] = Semaphore(max_concurrent)
    return tenant_semaphores[tenant_id]

async def proxy_llm(tenant_id: str, request: LLMRequest):
    sem = await get_semaphore(tenant_id, max_concurrent=10)
    async with sem:  # 超出并发则等待（或超时返回 429）
        return await forward_to_llm(request)
```

### 4）模型路由

```python
# 根据租户配置路由到不同模型
MODEL_ROUTES = {
    "gpt-4o":       "https://api.openai.com/v1/chat/completions",
    "claude-3-5":   "https://api.anthropic.com/v1/messages",
    "llama-3-70b":  "http://self-hosted-vllm:8000/v1/chat/completions",  # 自部署
}

async def route_request(request: LLMRequest, tenant: dict) -> AsyncIterator[str]:
    # 检查租户是否有该模型权限
    if request.model not in tenant["allowed_models"]:
        raise PermissionError(f"租户无权访问模型: {request.model}")
    
    # 负载均衡（同一模型可能有多个实例）
    backend_url = load_balancer.select(request.model)
    
    # 流式代理
    async with httpx.AsyncClient() as client:
        async with client.stream("POST", backend_url, json=request.dict(),
                                  headers={"Authorization": f"Bearer {get_api_key(request.model)}"}) as resp:
            async for chunk in resp.aiter_text():
                yield chunk
```

### 5）审计日志

```python
# 异步写审计日志（不阻塞请求）
async def record_audit(tenant_id: str, request: LLMRequest, 
                         response: LLMResponse, meta: dict):
    audit_event = {
        "tenant_id": tenant_id,
        "request_id": meta["request_id"],
        "model": request.model,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
        "total_tokens": response.usage.total_tokens,
        "latency_ms": meta["latency_ms"],
        "cost_usd": calculate_cost(request.model, response.usage),
        "prompt_hash": hashlib.sha256(str(request.messages).encode()).hexdigest(),
        # 注意：根据合规要求，可能不存储明文 prompt
        "timestamp": datetime.utcnow().isoformat(),
        "ip": meta["client_ip"],
    }
    
    # 写 MQ（异步，不阻塞主流程）
    await kafka.send("llm_audit", audit_event)

# Kafka 消费者：批量写入 ClickHouse（分析用）
# ClickHouse 适合大量写入 + 聚合查询（账单统计、用量分析）
```

### 6）账单与成本分摊

```sql
-- ClickHouse 查询（每日账单）
SELECT 
    tenant_id,
    model,
    SUM(prompt_tokens) as total_prompt_tokens,
    SUM(completion_tokens) as total_completion_tokens,
    SUM(cost_usd) as total_cost,
    COUNT(*) as request_count
FROM llm_audit_log
WHERE toDate(timestamp) = today()
GROUP BY tenant_id, model
ORDER BY total_cost DESC;
```

## 延伸追问

- **Q：配额超出后怎么处理？直接拒绝还是排队？**
  → 通常直接返回 429（Too Many Requests），在响应 Header 中返回剩余配额和重置时间（`Retry-After: 60`）。对于按月配额超出，拒绝后告知租户升级套餐。高级套餐可以支持"超额按量计费"（超出后不拒绝，但计费不同）。
- **Q：如何防止 Prompt 注入攻击（租户 A 通过 Prompt 影响其他租户）？**
  → 每个请求独立（无状态），Prompt 不跨租户共享；对 Prompt 做 Content Policy 检查（OpenAI Moderation API 或自训练分类器）；系统 Prompt 隔离（租户的 System Prompt 不对外可见）。

## 我的记法

- 隔离：逻辑隔离（配额+权限）为主，大客户 Pod 隔离
- 认证：API Key → Redis 缓存 → DB（热路径避免 DB 查询）
- 配额：**RPM（滑动窗口）+ Token/日（Redis INCRBY）+ 并发（Semaphore）**
- 审计：异步 MQ → ClickHouse（账单+分析）
- 一句话：**「API Key 鉴权，三维配额（速率/Token/并发），流式代理，异步审计」**

## 状态
- [ ] 已背速记
- [ ] 能说三个配额维度的实现方式
- [ ] 能解释审计日志的异步写入链路
