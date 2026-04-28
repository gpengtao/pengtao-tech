---
tags: [P0, Python方向, 生疏]
相关: [[03-Python技术栈/_MOC]]
---

# FastAPI 的核心价值（Pydantic + OpenAPI 自动生成）

## 一句话速记

**FastAPI 的核心价值**：**① Pydantic 自动数据验证**（类型注解即 Schema，入参自动 validate + 序列化）；**② OpenAPI 文档自动生成**（`/docs` Swagger，零配置）；**③ 基于 ASGI + async/await**（比 Flask 更适合高并发 I/O 密集服务）；**④ 依赖注入系统**（DI，用于数据库连接、认证等横切逻辑）。对于 AI/LLM 服务后端，FastAPI 是目前最主流的选择（vLLM、Ollama 的 HTTP 接口都用 FastAPI）。

## 通俗解释（5 分钟版）

**Flask 写一个接口需要的样板代码**：

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/users", methods=["POST"])
def create_user():
    data = request.get_json()
    
    # 手动验证每个字段
    if "name" not in data:
        return jsonify({"error": "name required"}), 400
    if not isinstance(data["name"], str):
        return jsonify({"error": "name must be string"}), 400
    if "age" not in data:
        return jsonify({"error": "age required"}), 400
    if data["age"] < 0:
        return jsonify({"error": "age must be positive"}), 400
    
    # 手动文档（或者装配 Flask-Swagger）
    user = create_user_in_db(data["name"], data["age"])
    return jsonify(user)
```

**FastAPI 版本**：

```python
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()

class UserCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    age: int = Field(..., ge=0, le=150)

@app.post("/users", response_model=UserResponse)
async def create_user(user: UserCreate):
    # user 已经是验证过的对象（错误请求直接 422）
    result = await create_user_in_db(user.name, user.age)
    return result
# OpenAPI 文档自动生成，访问 /docs 看 Swagger
```

## 关键细节

### 1）Pydantic 数据验证的工作原理

```python
from pydantic import BaseModel, Field, validator
from typing import Optional
from datetime import datetime

class ChatRequest(BaseModel):
    messages: list[dict]
    model: str = "gpt-4"
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(None, gt=0)
    
    # 自定义验证器
    @validator("messages")
    def messages_not_empty(cls, v):
        if not v:
            raise ValueError("messages cannot be empty")
        return v

# 使用：
req = ChatRequest(
    messages=[{"role": "user", "content": "hi"}],
    temperature=1.5
)
# 自动验证：temperature 1.5 ≤ 2.0 ✓

req = ChatRequest(messages=[], temperature=3.0)
# ValidationError: temperature must be ≤ 2.0

# FastAPI 里作为路由参数：
@app.post("/chat")
async def chat(request: ChatRequest):
    # 进来的 request 已经是验证过的 ChatRequest 实例
    ...
```

**Pydantic v2 的改进**（2024+）：

```python
# v2 用 model_validator 和 field_validator
from pydantic import BaseModel, field_validator, model_validator

class User(BaseModel):
    name: str
    age: int
    
    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        return v.strip()
    
    @model_validator(mode="after")  # 所有字段验证完后
    def check_age_and_name(self):
        if self.age < 18 and "admin" in self.name:
            raise ValueError("Admin must be adult")
        return self

# v2 比 v1 快 5-50x（Rust 实现的核心验证器）
```

### 2）OpenAPI / Swagger 自动生成

```python
from fastapi import FastAPI, Query, Path
from pydantic import BaseModel
from typing import Optional

app = FastAPI(
    title="LLM Service API",
    version="1.0.0",
    description="AI 推理服务 API 文档"
)

class InferenceRequest(BaseModel):
    """推理请求体"""
    prompt: str             # 字段注释 → OpenAPI description
    max_tokens: int = 512

class InferenceResponse(BaseModel):
    text: str
    tokens_used: int

@app.post(
    "/v1/inference",
    response_model=InferenceResponse,
    summary="文本生成",
    description="调用 LLM 生成文本",
    tags=["inference"]
)
async def inference(
    request: InferenceRequest,
    temperature: float = Query(0.7, ge=0, le=2, description="采样温度"),
):
    ...

# 访问 http://localhost:8000/docs → Swagger UI
# 访问 http://localhost:8000/redoc → ReDoc
# 访问 http://localhost:8000/openapi.json → OpenAPI JSON Schema
```

### 3）依赖注入（Dependency Injection）

```python
from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

# 数据库 Session 注入
async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

# 认证注入
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    user = await authenticate_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user

# 路由里使用：
@app.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@app.post("/posts")
async def create_post(
    post: PostCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    ...
```

**DI 的优势**：
- 关注点分离（路由逻辑 ≠ 认证逻辑 ≠ DB 管理）
- 可测试性（测试时 mock 依赖）
- 自动管理生命周期（yield 依赖的 finally 保证关闭）

### 4）FastAPI 流式响应（LLM 场景）

```python
from fastapi.responses import StreamingResponse
import asyncio

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    async def generate():
        async for token in llm_stream(request.messages):
            # SSE（Server-Sent Events）格式
            yield f"data: {token}\n\n"
        yield "data: [DONE]\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"}
    )

# 客户端（JavaScript）：
# const evtSource = new EventSource("/chat/stream");
# evtSource.onmessage = (e) => console.log(e.data);
```

### 5）FastAPI vs Flask vs Django REST

```
维度              FastAPI           Flask             Django REST
─────────────────────────────────────────────────────────────────
编程模型          async/sync 都支持  sync（WSGI）       sync（WSGI）
数据验证          Pydantic 内置      需手动或扩展       DRF Serializer
OpenAPI 文档      自动生成           需 flask-apispec   需 drf-yasg
依赖注入          内置               无                 有限
适合场景          AI/LLM 服务        轻量脚本/微服务    大型传统 Web 应用
性能              最高               中等               中等
学习曲线          中等               低                 高
生态              AI 友好            广泛               广泛
```

## 延伸追问

- **Q：Pydantic 是每次请求都重新验证，还是有缓存？**
  → Pydantic v2 对 Schema 的**编译**（JSON Schema 生成、validator 注册）是在类定义时一次性完成（缓存在类对象上）；每次请求的**数据验证**（实例化）是实时进行的，但 v2 的 Rust 核心让每次验证极快（通常 < 0.1ms）。
- **Q：FastAPI 的 `response_model` 和 Pydantic 返回有什么区别？**
  → `response_model` 在返回时做**数据过滤**（只保留 response model 定义的字段，去掉内部字段如密码），并自动序列化；如果路由直接 `return dict`，不会过滤，但 FastAPI 会尝试序列化。建议关键接口都加 `response_model` 避免信息泄漏。
- **Q：FastAPI 能处理多少并发？**
  → 纯 I/O 密集服务，单进程 asyncio 可处理**数千到数万**并发连接（取决于服务器硬件和 I/O 延迟）；比较：Flask+gunicorn 多进程通常配 4-8 个 worker，每个 worker 处理 1 个请求，总并发受 worker 数限制。实践中 FastAPI 在推理服务场景（I/O 等待多）并发能力显著强于 Flask。

## 我的记法

- FastAPI 三大核心：**Pydantic 验证 + OpenAPI 自动文档 + async ASGI**
- `@app.post("/path", response_model=XxxResponse)` → 路由 + 文档 + 输出过滤
- `Depends(...)` → 依赖注入（DB、认证、配置）
- **AI 服务首选 FastAPI**：streaming response、pydantic request schema 天然契合 OpenAI API 风格
- 一句话：**「FastAPI = 类型注解即文档、即验证、即序列化，写一次全有了」**

## 状态
- [ ] 已背速记
- [ ] 能写 Pydantic model + FastAPI 路由
- [ ] 能实现流式 SSE 响应
