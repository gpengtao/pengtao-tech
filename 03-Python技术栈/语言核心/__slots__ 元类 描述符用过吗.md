---
tags: [P2, Python方向, 生疏]
相关: [[03-Python技术栈/_MOC]]
---

# `__slots__` / 元类 / 描述符用过吗

## 一句话速记

三个不常用但能体现 Python 深度的特性：**`__slots__`** = 固定类属性集合，减少内存（去掉 `__dict__`）；**元类（Metaclass）** = 类的类，控制类的创建过程，常用于 ORM/框架（Pydantic、SQLAlchemy 底层）；**描述符（Descriptor）** = 实现了 `__get__`/`__set__`/`__delete__` 的对象，`@property`/`@staticmethod`/`@classmethod` 都是描述符。面试中说"有接触，能解释原理"即可，能举框架中的实际用途加分。

## 通俗解释

### __slots__：节省内存的"声明式"属性

```python
# 普通类：每个实例有 __dict__（字典，灵活但占内存）
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

p = Point(1, 2)
p.z = 3    # 可以动态加属性（因为有 __dict__）
p.__dict__ # {'x': 1, 'y': 2, 'z': 3}

# __slots__ 类：没有 __dict__，属性固定，更省内存
class PointSlots:
    __slots__ = ('x', 'y')    # 只允许这两个属性
    
    def __init__(self, x, y):
        self.x = x
        self.y = y

ps = PointSlots(1, 2)
ps.z = 3   # AttributeError: 'PointSlots' object has no attribute 'z'
# ps.__dict__  # AttributeError: 没有 __dict__
```

**何时用**：

```
场景：创建大量（百万级）小对象（如 AI 推理的 Token 对象、坐标点）
效果：每个实例节省 ~40-100 字节内存（去掉 __dict__ 的开销）
代价：不能动态添加属性，继承关系稍复杂
```

### 元类：类的"模具"

```python
# type 是内置元类（所有类的类）
class MyClass:
    pass

type(MyClass)   # <class 'type'>
type(int)       # <class 'type'>
type(str)       # <class 'type'>

# 创建类的两种方式等价：
class Foo:
    x = 1
# 等价于：
Foo = type('Foo', (object,), {'x': 1})
```

**自定义元类的典型用途**：

```python
# 框架用元类来"拦截"类的创建
class SingletonMeta(type):
    _instances = {}
    
    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

class Database(metaclass=SingletonMeta):
    def __init__(self):
        self.conn = connect_db()

db1 = Database()
db2 = Database()
db1 is db2   # True（单例）
```

**Pydantic / SQLAlchemy 用元类做什么**：

```python
# Pydantic BaseModel 在类定义时就验证字段类型定义
# 这是通过元类（ModelMetaclass）实现的：
class User(BaseModel):
    name: str
    age: int

# 类创建时（不是实例化时），ModelMetaclass.__new__ 扫描了所有
# 类型注解，创建了验证器，构建了 JSON Schema
# 这就是为什么 User.model_json_schema() 在任何实例化之前就能调用
```

### 描述符：`@property` 的底层原理

```python
# 描述符协议
class Descriptor:
    def __get__(self, obj, objtype=None):
        print(f"get {obj}")
        return self._value
    
    def __set__(self, obj, value):
        print(f"set {value}")
        self._value = value
    
    def __delete__(self, obj):
        del self._value

class MyClass:
    attr = Descriptor()  # 描述符放在类变量上（重要！）

m = MyClass()
m.attr = 10   # 触发 __set__
m.attr        # 触发 __get__
```

**`@property` 就是内置描述符**：

```python
class Circle:
    def __init__(self, radius):
        self._radius = radius
    
    @property
    def area(self):
        return 3.14 * self._radius ** 2
    
    @area.setter
    def area(self, val):
        # 反算 radius
        self._radius = (val / 3.14) ** 0.5

# property() 内部实现了 __get__/__set__/__delete__
# @property 是语法糖，等价于：
# area = property(fget=area_func, fset=None, fdel=None)
```

## 关键细节

### 描述符 vs `__getattr__` / `__getattribute__`

```python
# 属性访问的查找顺序：
# 1. 数据描述符（有 __get__ + __set__ 的类变量）→ 优先级最高
# 2. 实例 __dict__
# 3. 非数据描述符（只有 __get__ 的类变量） + 类变量
# 4. 调用 __getattr__（只在找不到时调用）

# __getattribute__：所有属性访问都触发（慎重重写，容易递归）
# __getattr__：只在正常查找失败时调用（常用于代理/动态属性）

class DynamicAttr:
    def __getattr__(self, name):
        # 访问不存在的属性时才调用
        if name.startswith('get_'):
            field = name[4:]
            return lambda: self.__dict__.get(field)
        raise AttributeError(name)
```

### 元类的现代替代：`__init_subclass__` 和 `__class_getitem__`

```python
# Python 3.6+ 推荐替代简单元类场景
class PluginBase:
    _registry = {}
    
    def __init_subclass__(cls, plugin_name=None, **kwargs):
        super().__init_subclass__(**kwargs)
        if plugin_name:
            PluginBase._registry[plugin_name] = cls

class MyPlugin(PluginBase, plugin_name="my"):
    pass

PluginBase._registry  # {'my': MyPlugin}
```

## 延伸追问

- **Q：`__slots__` 和 dataclasses 能一起用吗？**
  → 可以：`@dataclass(slots=True)`（Python 3.10+）自动添加 `__slots__`，结合了 dataclass 的便利和 slots 的内存优化，是高性能数据对象的推荐写法。
- **Q：元类和类装饰器的区别？**
  → 类装饰器在类创建**之后**运行（`MyClass = decorator(MyClass)`），只能修改已创建的类；元类在类创建**过程中**介入（`__new__`/`__init__`），可以控制类的属性收集方式。Pydantic v2 迁移到 `__pydantic_init_subclass__` 就是从元类改为更轻量的方式。
- **Q：描述符为什么要放在类变量而不是实例变量？**
  → 描述符协议是通过**类的 MRO 查找**触发的：Python 访问属性时先查类变量，发现有 `__get__` 方法就调用它（传入实例）。如果放在实例变量，就是普通的对象赋值，不会触发描述符协议。

## 我的记法

- `__slots__` = 固定属性 + 省内存，大量小对象时用
- 元类 = "类的类"，ORM/Pydantic 框架用来在 class 定义时做魔法
- 描述符 = `__get__`/`__set__`，`@property` 就是内置描述符
- 描述符要放**类变量**（不是实例变量）才生效
- 简单说：**「@property 是语法糖版描述符，Pydantic 是元类版类型检查」**

## 状态
- [ ] 已背速记
- [ ] 能用 @property 举例描述符
- [ ] 能说出 Pydantic 用元类的场景
