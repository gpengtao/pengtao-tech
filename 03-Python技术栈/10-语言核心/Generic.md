`Generic` 是 Python `typing` 模块提供的基类，**专门用来定义泛型类**。

---

**为什么需要它？**

假设你写一个盒子类，想让它能装任意类型：

```python
class Box:
    def __init__(self, value):
        self.value = value
    
    def get(self):
        return self.value
```

这样写可以运行，但 IDE 不知道 `get()` 返回什么类型，没法帮你检查。

---

**用 `Generic` 加上类型信息：**

```python
from typing import Generic, TypeVar

T = TypeVar("T")          # T 是占位符，代表"某种类型"

class Box(Generic[T]):
    def __init__(self, value: T):
        self.value = value
    
    def get(self) -> T:   # 返回类型和传入类型一致
        return self.value
```

现在 IDE 知道了：

```python
box = Box(123)        # T 推断为 int
x = box.get()         # x 的类型是 int ✅

box2 = Box("hello")   # T 推断为 str
y = box2.get()        # y 的类型是 str ✅

box3 = Box("hello")
z: int = box3.get()   # ❌ IDE 报错：str 不能赋给 int
```

---

**和 `StateGraph` 的关系：**

```python
T1 = TypeVar("StateT")
T2 = TypeVar("ContextT")
# ...

class StateGraph(Generic[StateT, ContextT, InputT, OutputT]):
    ...
```

就是同一个道理，只是占位符从 1 个变成了 4 个。**运行时没有任何影响**，纯粹是给 IDE / 类型检查器提供信息。