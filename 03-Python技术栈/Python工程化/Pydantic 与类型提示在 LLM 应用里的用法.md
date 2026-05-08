---
tags: [P0, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: "[[_专题-具身Agent/index]]"
---

# Pydantic 与类型提示在 LLM 应用里的用法

## 一句话速记

Pydantic = **Python 版的 DTO + JSON Schema 自动生成 + 运行时校验**，是连接"LLM 自由文本"和"结构化代码"的桥。一个 `BaseModel` 类同时给：① Function Calling 工具描述、② 结构化输出 schema、③ FastAPI 入参校验、④ Agent state 类型——一次定义、四处复用。

## 通俗解释（5 分钟版）

**类比 Java**：Pydantic ≈ Lombok `@Data` + Jackson 注解 + Bean Validation 三件套，一锅端。
- Lombok 部分：自动生成 init/repr/eq
- Jackson 部分：序列化反序列化 JSON
- Bean Validation 部分：运行时校验字段（必填、范围、格式）

**和原生 Python typing 的区别**：
- 原生 `def f(x: int)` 只是**注释**——传 `f("abc")` 不会报错，类型注解只在 IDE / mypy 静态检查里有用
- Pydantic **运行时强制校验**——`Model(x="abc")` 会抛 `ValidationError`，是真合约

**为什么 LLM 应用离不开它**——四个场景串起来：

```
                 ┌─────────────────────────────────┐
   ┌────────────►│  WeatherQuery(BaseModel)        │
   │             │    city: str = Field(...)        │
   │             │    unit: Literal["C", "F"] = "C" │
   │             └────────────┬────────────────────┘
   │                          │
   │            ① 喂给 LLM    │  ④ Agent state
   │           （JSON Schema）│   字段类型化
   │                          │
   │  ┌─────────┐    ┌────────▼────────┐   ┌──────────────┐
   └──┤ FastAPI │    │  Function       │   │  LangGraph   │
      │ 入参校验│    │  Calling 工具   │   │  state       │
      └─────────┘    └─────────────────┘   └──────────────┘
                              ▲
                              │ ③ LLM 输出 JSON
                              │   model_validate_json
                              │   不通过 → 报错给 LLM 重试
                              ▼
                     ┌────────────────┐
                     │  ② 结构化输出   │
                     │  (instructor等) │
                     └────────────────┘
```

简单说：**LLM 输出是文本，业务代码要结构化对象，Pydantic 做这个翻译 + 校验 + 兜底重试**。

**v1 vs v2**：
- Pydantic v2（2023 年发布）核心用 Rust 重写，比 v1 快 5–50x
- API 略有变动：`Config` → `model_config`、`.dict()` → `.model_dump()`、`.parse_obj()` → `.model_validate()`
- **新项目直接 v2**，老项目升级要改一些代码

## 关键细节 / 数学直觉

**最小完整例子**：
```python
from pydantic import BaseModel, Field, field_validator
from typing import Literal

class WeatherQuery(BaseModel):
    city: str = Field(..., description="城市名，如「北京」")
    unit: Literal["celsius", "fahrenheit"] = "celsius"
    days: int = Field(default=1, ge=1, le=7, description="预报天数 1-7")

    @field_validator("city")
    @classmethod
    def city_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("city 不能为空字符串")
        return v.strip()
```

**与 LLM 的四种用法**：

**① Function Calling 工具描述**
```python
schema = WeatherQuery.model_json_schema()
# 直接喂给 OpenAI / Anthropic 的 tool 定义
# Field(description=...) 的内容会变成 schema 里的 description，给 LLM 看
```

**② 结构化输出（用 instructor 库）**
```python
import instructor
from openai import OpenAI

client = instructor.from_openai(OpenAI())
result: WeatherQuery = client.chat.completions.create(
    model="gpt-4o",
    response_model=WeatherQuery,   # 关键：直接传 Pydantic 类
    messages=[{"role": "user", "content": "明天北京天气怎么样？"}],
)
# result 已经是 WeatherQuery 实例，类型安全
```

**③ FastAPI 集成**
```python
from fastapi import FastAPI

app = FastAPI()

@app.post("/weather")
async def weather(q: WeatherQuery) -> WeatherResp:
    # q 已经被自动校验过了，错的请求 422 由 FastAPI 自动返回
    ...
```

**④ Agent state（LangGraph 风格）**
```python
class AgentState(BaseModel):
    messages: list[Message] = []
    tools_used: list[str] = []
    next_action: Literal["search", "answer", "end"] = "search"
```

**高频特性速查**：
- `Optional[X]` 或 Python 3.10+ 的 `X | None`
- `Field(default_factory=list)` —— **可变默认值必须用 default_factory**，否则共享对象坑
- `Literal["a", "b"]` —— 枚举字段，比 Enum 更轻
- `model_config = ConfigDict(frozen=True)` —— 不可变模型
- 嵌套 model：`class Order(BaseModel): items: list[Item]`，自动递归校验

**序列化反序列化**：
```python
m.model_dump()              # → dict
m.model_dump_json()         # → str
WeatherQuery.model_validate(some_dict)        # ← dict
WeatherQuery.model_validate_json('{"city":"北京"}')  # ← JSON str
```

**LLM 自纠错的标准 pattern**：
```python
for attempt in range(3):
    raw = llm.complete(prompt)
    try:
        return WeatherQuery.model_validate_json(raw)
    except ValidationError as e:
        prompt += f"\n上次输出格式错误：{e}\n请重新按 schema 输出。"
raise RuntimeError("LLM 三次都没给出合法格式")
```

**性能注意**：
- v2 校验快，但**热路径里频繁创建大 Model 仍有开销**
- 极端高 QPS 路径可以考虑 `TypedDict`（无运行时校验）+ mypy 静态检查

## 延伸追问
- **Q：** Pydantic v1 和 v2 的主要差别？  
  → v2 核心 Rust 重写，5–50x 快；API 变动：`Config` → `model_config`、`.dict()` → `.model_dump()`、validator 装饰器换名。
- **Q：** `dataclass` 和 `BaseModel` 怎么选？  
  → dataclass 是标准库自带、零依赖、**无运行时校验**；BaseModel 有依赖、慢一点、**有完整运行时校验** + JSON Schema 生成。LLM 应用必须 BaseModel，纯内存 DTO 用 dataclass。
- **Q：** LLM 输出不符合 Pydantic schema 怎么办？  
  → 标准做法是捕 `ValidationError`，把错误信息塞回 prompt 给 LLM 重试（self-correction）。instructor 库内置这套循环。
- **Q：** LangGraph 的 state 用 TypedDict 还是 BaseModel？  
  → 官方现在偏向 TypedDict（更快、和 LangChain 生态融合好），但 BaseModel 在校验密集场景仍有优势。能简单就 TypedDict。
- **Q：** `Field(default=[])` 为啥是坑？  
  → Python 函数默认参数是**类共享**的，所有实例共用同一个 list。必须用 `Field(default_factory=list)`。

## 我的记法

> Pydantic 让"类型注解"从注释升级为**运行时合约**。一个 `BaseModel` 同时是：JSON Schema、FastAPI 入参、LLM 工具描述、Agent state——LLM 圈的"DTO 通用语言"。Java Lombok + Jackson + Validation 的 Python 合体版。

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 instructor + Pydantic 跑通过结构化输出

## 参考资料
- [Pydantic v2 官方文档](https://docs.pydantic.dev/latest/)
- [instructor — Pydantic + LLM 结构化输出](https://python.useinstructor.com/)
- [Pydantic v1 → v2 Migration Guide](https://docs.pydantic.dev/latest/migration/)
