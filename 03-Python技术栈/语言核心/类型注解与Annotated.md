# 类型注解 与 Annotated

## 第一层：类型注解（Type Hints）

Python 3.5 加入，冒号后写类型。**运行时不报错不校验**，纯粹给人和 IDE 看：

```python
name: str = "张三"
age: int = 18
messages: list = []
```

---

## 第二层：TypedDict 里的类型注解

继承 `TypedDict` 后，注解不是普通变量声明，而是在**声明字典的 key 和值类型**：

```python
from typing import TypedDict

class AgentState(TypedDict):
    messages: list   # 声明这个 dict 有 key="messages"，值类型是 list
```

用起来是普通 dict，但 IDE 知道有哪些 key：

```python
state: AgentState = {"messages": []}
state["messages"]   # ✅ IDE 有补全
state["xxx"]        # ⚠️ IDE 报警：没有这个 key
```

---

## 第三层：Annotated — 给类型贴"便利贴"

Python 3.9 加入，格式：

```python
from typing import Annotated

Annotated[实际类型, 便利贴1, 便利贴2, ...]
```

便利贴可以是任何东西，**Python 运行时完全忽略**，只有框架/工具自己按需读取：

```python
# 对 IDE 和运行时来说，这三行等价，都是 list 类型
messages: list
messages: Annotated[list, "随便写点啥"]
messages: Annotated[list, some_function]
```

---

## 三层叠加的真实案例：LangGraph

```python
from typing import Annotated, TypedDict
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
```

逐层解读：

| 层次 | 语法 | 作用 |
|------|------|------|
| TypedDict | `class AgentState(TypedDict)` | 声明字典结构，`messages` 是一个 key |
| 类型注解 | `Annotated[list, ...]` | 告诉 IDE：值类型是 `list` |
| Annotated 元数据 | `, add_messages` | 告诉 LangGraph：更新此字段时用 `add_messages` 函数合并（追加），不覆盖 |

**一句话：一行代码干了两件事——告诉 IDE 类型是 list，告诉框架合并策略是追加。**

---

## Annotated 的常见使用场景

```python
# 1. FastAPI：声明参数来源和校验规则
from fastapi import Query
def search(q: Annotated[str, Query(min_length=3)]): ...

# 2. Pydantic：字段约束
from pydantic import Field
class User(BaseModel):
    age: Annotated[int, Field(ge=0, le=150)]

# 3. LangGraph：reducer 函数
messages: Annotated[list, add_messages]
```

共同点：**类型本身不变，元数据由各框架自行解读**，互不干扰。
