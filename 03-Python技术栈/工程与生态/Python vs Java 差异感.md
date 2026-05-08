---
tags: [P1, Python方向, 生疏]
相关: "[[03-Python技术栈/_MOC]]"
---

# Python vs Java：ORM / 泛型 / 错误处理 / 包管理的差异感

## 一句话速记

从 Java 背景转向 Python，最大的心智切换在于：**Python 是动态类型 + 鸭子类型**，很多 Java 里"必须"的东西（接口声明、类型参数、checked exception）在 Python 里是可选的。但 AI 时代的 Python 已经大量使用**类型注解 + Pydantic**，让代码接近静态类型风格——两种语言的工程实践正在收敛。

## 关键对比

### 1）ORM 差异

**Java（JPA/Hibernate + Spring Data）**：

```java
// 实体类
@Entity
@Table(name = "users")
public class User {
    @Id @GeneratedValue
    private Long id;
    
    @Column(nullable = false)
    private String name;
    
    @OneToMany(mappedBy = "user", fetch = FetchType.LAZY)
    private List<Order> orders;
}

// Repository
@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    List<User> findByNameContaining(String name);
    
    @Query("SELECT u FROM User u WHERE u.age > :age")
    List<User> findAdults(@Param("age") int age);
}
```

**Python（SQLAlchemy）**：

```python
# 同步版（SQLAlchemy 1.x 风格，类比 JPA）
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship
from database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    orders = relationship("Order", back_populates="user", lazy="select")

# 查询（类比 JPQL）
from sqlalchemy.orm import Session

def get_users_by_name(db: Session, name: str):
    return db.query(User).filter(User.name.contains(name)).all()

# Python 3.11+ 异步版（FastAPI 推荐）
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

async def get_users(db: AsyncSession, name: str):
    result = await db.execute(
        select(User).where(User.name.contains(name))
    )
    return result.scalars().all()
```

**关键差异**：

```
Java JPA/Hibernate            Python SQLAlchemy
──────────────────────────────────────────────────
@Entity 注解声明实体           继承 Base（声明式元类）
@Column 类型安全               Column(String, Integer) 运行时
Spring Data 方法名派生查询      没有（需手写 filter 条件）
@OneToMany EAGER/LAZY          relationship(lazy="select/joined/dynamic")
@Transactional                 with Session.begin() 或 async with
TypedQuery<User>               query().all() 返回 List（无泛型）
生成 migration（Flyway）        Alembic（类比 Flyway）
```

**Tortoise ORM（更 Django-like）**：

```python
# Tortoise ORM：Python 原生异步 ORM，适合 FastAPI
from tortoise import fields, Model

class User(Model):
    id = fields.IntField(pk=True)
    name = fields.CharField(max_length=100)
    orders: fields.ReverseRelation["Order"]
    
    class Meta:
        table = "users"

# 查询
users = await User.filter(name__contains="john").all()
user = await User.get_or_none(id=1)
```

### 2）泛型差异

**Java（强制泛型，编译期类型安全）**：

```java
// Java 泛型是必须的，否则是 raw type
List<String> names = new ArrayList<>();
Map<String, List<User>> groupedUsers = new HashMap<>();

// 泛型方法
public <T extends Comparable<T>> T max(List<T> list) {
    return list.stream().max(Comparator.naturalOrder()).orElseThrow();
}

// 泛型类
public class Repository<T, ID> {
    public Optional<T> findById(ID id) { ... }
}
```

**Python（可选类型注解，运行时不强制）**：

```python
# Python 泛型是注解，运行时不检查（只有 mypy/pyright 等工具检查）
from typing import TypeVar, Generic

names: list[str] = []  # Python 3.9+（不需要 from typing import List）
grouped: dict[str, list[User]] = {}

# 泛型函数
from typing import TypeVar
T = TypeVar("T")

def first(lst: list[T]) -> T:
    return lst[0]

# 泛型类
class Repository(Generic[T]):
    def find_by_id(self, id: int) -> T | None: ...
```

**Pydantic 里的泛型（AI 应用常用）**：

```python
from pydantic import BaseModel
from typing import Generic, TypeVar

T = TypeVar("T")

class ApiResponse(BaseModel, Generic[T]):
    data: T
    code: int = 0
    message: str = "ok"

class UserData(BaseModel):
    name: str
    age: int

# 使用
response: ApiResponse[UserData] = ApiResponse(
    data=UserData(name="Alice", age=30)
)
response.data.name  # 类型安全（mypy/IDE 可以推导）
```

### 3）错误处理差异

**Java（Checked Exception 强制处理）**：

```java
// 必须声明或 catch（checked exception）
public String readFile(String path) throws IOException {
    return Files.readString(Path.of(path));
}

// 调用方必须处理
try {
    String content = readFile("a.txt");
} catch (IOException e) {
    log.error("Failed to read file", e);
    throw new RuntimeException(e);
}
```

**Python（都是 unchecked exception）**：

```python
# 不需要声明，可以不 catch（和 Java RuntimeException 类似）
def read_file(path: str) -> str:
    return open(path).read()

# 可以 catch，也可以不 catch（让异常向上冒泡）
try:
    content = read_file("a.txt")
except FileNotFoundError as e:
    logger.error(f"File not found: {e}")
    raise  # 重新抛出（不丢失原始 traceback）

# Python 的 except 更灵活：
except (FileNotFoundError, PermissionError) as e:  # 多类型
    ...
except Exception as e:  # 所有异常（类比 catch(Exception e)）
    ...
finally:
    cleanup()
```

**FastAPI 的异常处理**：

```python
# 自定义异常（类比 Spring @ExceptionHandler）
from fastapi import HTTPException

@app.get("/user/{id}")
async def get_user(id: int):
    user = await db.get(User, id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

# 全局异常处理器
from fastapi.responses import JSONResponse

@app.exception_handler(ValueError)
async def value_error_handler(request, exc):
    return JSONResponse(status_code=400, content={"error": str(exc)})
```

### 4）关键思维转变

```
Java 思维                         Python 思维
─────────────────────────────────────────────────────────────────
接口（interface）是第一等公民       鸭子类型：有 .read() 方法就是 reader
Getter/Setter + 封装原则           直接访问属性（@property 按需加）
工厂模式、策略模式 everywhere       函数是一等公民，直接传函数
Spring Bean 生命周期管理           模块级单例（或者 Depends()）
@Transactional 声明式事务          with session.begin() 上下文管理器
Java Stream API                    列表推导、生成器表达式更 Pythonic
Optional<T> 防止 NPE              直接用 None + 类型注解 X | None
```

## 延伸追问

- **Q：Python 没有 interface，怎么做面向接口编程？**
  → 两种方式：1) `abc.ABC` + `@abstractmethod`（类似 Java 抽象类）；2) `typing.Protocol`（结构类型，只要实现了方法就满足，不需要显式继承）。Python 推荐 Protocol——更灵活，不需要修改已有类。
- **Q：Python 的 with 语句和 Java 的 try-with-resources 等价吗？**
  → 是的，语义相同（保证资源释放）。Python `with obj` 调用 `obj.__enter__` 和 `__exit__`；Java `try(Resource r = new Resource())` 调用 `r.close()`。Python 还可以 `async with`（asyncio 上下文管理器）。
- **Q：Python 的 dataclasses 和 Java 的 record 有什么区别？**
  → 语义相似（都是数据载体类）。Java record（Java 14+）是不可变的，自动 equals/hashCode/toString；Python `@dataclass` 默认可变，`@dataclass(frozen=True)` 不可变。AI 应用推荐 Pydantic BaseModel（带验证）替代 dataclass。

## 我的记法

- **ORM**：SQLAlchemy ≈ Hibernate，relationship = @OneToMany，Alembic = Flyway
- **泛型**：Python 类型注解是可选的，mypy 做静态检查，运行时无强制
- **异常**：Python 全是 unchecked（像 Java RuntimeException），不需要 throws
- **思维转变**：鸭子类型 > 接口、函数一等公民 > 工厂模式、推导式 > Stream
- 一句话：**「Python 和 Java 越来越像（都在加类型注解），但 Python 默认更宽松，鸭子类型用好了更优雅」**

## 状态
- [ ] 已背速记（四个维度差异）
- [ ] 能解释鸭子类型 vs Java 接口
- [ ] 能写 SQLAlchemy async 查询
