# 强制关键字参数（keyword-only arguments）

`*` 单独出现在函数参数列表中时，不是可变参数，而是一个**分隔符**：它之后的所有参数调用时必须用关键字方式传，不能按位置传。

---

## 语法

```python
def func(a, b, *, c, d=None):
    ...
```

| 参数 | 能否按位置传 | 能否按关键字传 |
|------|------------|--------------|
| `a`  | ✅ | ✅ |
| `b`  | ✅ | ✅ |
| `c`  | ❌ 只能关键字 | ✅ |
| `d`  | ❌ 只能关键字 | ✅ |

---

## 示例

```python
# ✅ 正确
func(1, 2, c=3)
func(1, 2, c=3, d=4)

# ❌ 报错：c 不能按位置传
func(1, 2, 3)
# TypeError: func() takes 2 positional arguments but 3 were given
```

---

## 真实案例：LangGraph 的 StateGraph

```python
def __init__(
    self,
    state_schema: type[StateT],            # 可以按位置传（核心参数）
    context_schema: type[ContextT] = None, # 可以按位置传
    *,                                     # ← 分隔线
    input_schema: type[InputT] = None,     # 必须用关键字
    output_schema: type[OutputT] = None,   # 必须用关键字
)
```

```python
# ✅ 正确
StateGraph(AgentState)
StateGraph(AgentState, input_schema=MyInput)

# ❌ 报错
StateGraph(AgentState, None, MyInput)
```

---

## 为什么这么设计？

强制关键字参数适合：
- **可选的配置项**：让调用方必须写出参数名，代码自解释
- **参数较多容易搞混顺序**时，避免位置传参出错
- **API 设计**：保留未来增加参数的灵活性，不破坏已有调用

---

## 相关：`/` 强制位置参数

与 `*` 对称，`/` 之前的参数**只能按位置传，不能用关键字**：

```python
def func(a, b, /, c, d):
    ...

func(1, 2, 3, 4)          # ✅
func(1, 2, c=3, d=4)      # ✅
func(a=1, b=2, c=3, d=4)  # ❌ a、b 不能用关键字
```

两者可以组合：

```python
def func(a, b, /, c, *, d):
    # a、b 只能位置传
    # c   两种方式都可以
    # d   只能关键字传
    ...
```
