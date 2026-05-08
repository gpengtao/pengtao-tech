---
tags: [P0, Java方向, 生疏]
相关: "[[02-Java后端核心/index]]"
---

# Spring 事务失效的典型场景

## 一句话速记

**Spring 事务基于 AOP 代理实现，任何绕过代理的调用都会导致事务失效**。最常见的 5 类：① **同类内部调用**（`this.xxx()` 绕过代理）② **方法非 public**（CGLib/JDK 代理无法拦截）③ **异常被吞**（catch 后不 rethrow）④ **异常类型不对**（非 RuntimeException 默认不回滚）⑤ **数据库不支持事务**（MyISAM）。此外 `@Transactional` 的传播机制误用也是高频坑（`REQUIRES_NEW` vs `NESTED`）。

## 通俗解释（5 分钟版）

**Spring 事务的工作原理**：

```
@Service
class OrderService {
    @Transactional
    void createOrder() { ... }
}

// Spring 实际注入的不是 OrderService，而是它的代理：
// OrderServiceProxy.createOrder() {
//     开始事务
//     try {
//         orderService.createOrder();  // 委托给目标
//         提交
//     } catch (Exception e) {
//         回滚
//         throw e;
//     }
// }
```

**事务失效的本质 = 代理没有生效 / 没有看到正确的异常**。

## 关键细节

### 1）同类内部调用（最常见坑）

```java
@Service
class OrderService {
    
    @Transactional
    public void createOrder() {
        // ❌ 直接调用 this.updateStock()，this = 原始对象，不经过代理！
        this.updateStock();
        saveOrder();
    }
    
    @Transactional(propagation = REQUIRES_NEW)
    public void updateStock() {
        // 这里的 @Transactional 不生效！
        // 因为调用者是 this（原始对象），不是代理对象
    }
}
```

**解法**：

```java
// 方法 1：注入自身（会触发循环依赖，Spring 可以处理）
@Autowired
@Lazy
private OrderService self;
self.updateStock();  // 通过代理调用

// 方法 2：从 ApplicationContext 获取代理
OrderService proxy = applicationContext.getBean(OrderService.class);
proxy.updateStock();

// 方法 3：用 AopContext.currentProxy()（需要 @EnableAspectJAutoProxy(exposeProxy=true)）
((OrderService) AopContext.currentProxy()).updateStock();

// 方法 4：把 updateStock 抽到另一个 bean（推荐）
@Service class StockService {
    @Transactional(propagation = REQUIRES_NEW)
    public void updateStock() { ... }
}
```

### 2）方法非 public

```java
@Service
class OrderService {
    @Transactional
    void createOrder() { }  // package-private，事务不生效
    
    @Transactional
    protected void init() { }  // protected，CGLib 代理可以拦截，JDK 动态代理不行
    
    @Transactional
    private void internalProcess() { }  // private，任何代理都无法拦截
}
```

**规则**：
- `public` → 两种代理都能拦截（生效）
- `protected` → CGLib 能（生效），JDK 代理不能
- `private` / `default` → 任何代理都不能（不生效）

### 3）异常被吞

```java
@Transactional
public void createOrder() {
    try {
        insertOrder();
        // ❌ 异常被捕获，没有传播出去，Spring 认为方法正常完成 → 提交
    } catch (Exception e) {
        log.error("order failed", e);  // 只记录日志，不 rethrow
    }
}
```

**解法**：

```java
// 1. 重新抛出
} catch (Exception e) {
    log.error("order failed", e);
    throw new BizException(e);  // 抛 RuntimeException 或在 rollbackFor 里
}

// 2. 手动标记回滚（不想抛异常但要回滚）
} catch (Exception e) {
    TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
}
```

### 4）异常类型不对

```java
@Transactional
public void createOrder() throws IOException {
    // ❌ IOException 是 checked exception，默认不触发回滚！
    processFile();  // 可能抛 IOException
}
```

**Spring 默认回滚规则**：只回滚 `RuntimeException` 和 `Error`，不回滚 `CheckedException`。

**解法**：

```java
// 显式指定回滚的异常类型
@Transactional(rollbackFor = Exception.class)
public void createOrder() throws IOException { ... }

// 或只回滚指定异常
@Transactional(rollbackFor = {IOException.class, BizException.class})
```

### 5）传播机制误用

```java
@Transactional
void methodA() {
    methodB();  // 这里 @Transactional 的传播机制决定了行为
}

@Transactional(propagation = Propagation.REQUIRES_NEW)
void methodB() {
    // 开启新事务，methodA 的事务挂起
    // methodB 失败 → 只回滚 methodB，methodA 不受影响
    // 前提：methodB 是通过代理调用的（不能是同类内部调用！）
}
```

**传播类型速查**：

```
REQUIRED（默认）  有事务则加入，没有则新开
REQUIRES_NEW      总是新开事务，挂起当前事务
NESTED            嵌套事务（savepoint），外部事务回滚时内部也回滚
SUPPORTS          有事务则加入，没有则非事务执行
NOT_SUPPORTED     非事务执行，挂起当前事务
MANDATORY         必须有事务，没有则抛异常
NEVER             不能有事务，有则抛异常
```

**REQUIRES_NEW vs NESTED**：

```
REQUIRES_NEW：
  内部事务独立提交/回滚
  内部失败 → 外部可以捕获异常继续
  内部成功提交 → 即使外部后来回滚，内部数据也不回滚（已提交！）

NESTED：
  内部事务基于 savepoint
  内部失败 → 回滚到 savepoint，外部继续
  外部回滚 → 内部也一起回滚（因为是同一个物理事务）
  
注意：NESTED 需要数据库支持 savepoint（MySQL InnoDB 支持，但 JPA/Hibernate 可能不支持）
```

### 6）其他失效场景

```
场景                              原因
──────────────────────────────────────────────────────────────
数据库引擎不支持事务（MyISAM）    建表指定了 ENGINE=MyISAM
Bean 没被 Spring 管理            new OrderService()（不经过 Spring）
多数据源配置错误                  事务管理器和数据源不匹配
@Transactional 在接口上           Spring 默认扫描方法，接口上的注解在实现类不生效
@Async + @Transactional          异步线程没有事务上下文（见下）
```

**@Async + @Transactional 同时使用**：

```java
// ❌ 问题：
@Async
@Transactional
void asyncMethod() { ... }
// @Async 让方法在新线程执行，新线程没有原调用者的事务上下文
// 事务是基于 ThreadLocal 的 TransactionSynchronizationManager
// 新线程的 ThreadLocal 是空的 → 事务失效

// 解法：两个注解分到不同 bean/方法，各司其职
```

## 延伸追问

- **Q：Spring 事务用的是 JDK 动态代理还是 CGLib？**
  → 取决于目标类是否实现接口：实现接口 → 默认 JDK 动态代理；没有实现接口 → CGLib 代理。Spring Boot 2.x 之后默认强制使用 CGLib（`spring.aop.proxy-target-class=true`），减少 JDK 代理的接口限制问题。
- **Q：`@Transactional` 放在类上和方法上有什么区别？**
  → 放在类上相当于类中所有 public 方法都有 `@Transactional`（用类上的配置）；放在方法上只对该方法生效，且方法上的配置会覆盖类上的配置。
- **Q：事务在 Spring 中是怎么存储当前事务上下文的？**
  → `TransactionSynchronizationManager` 类里，用 `ThreadLocal<Map<DataSource, Connection>>` 保存每个数据源的当前连接。这就是为什么跨线程（@Async）时事务会失效——不同线程的 ThreadLocal 是独立的。

## 我的记法

- **失效根本原因：绕过代理**
- **5 大场景**：内部调用 / 非 public / 异常被吞 / 异常类型错 / 数据库不支持
- 内部调用解法：注入 self（@Lazy）或抽成另一个 bean
- 默认只回滚 RuntimeException，checked exception 需要 `rollbackFor=Exception.class`
- `REQUIRES_NEW` = 独立事务（外部回滚不影响）；`NESTED` = savepoint（外部回滚一起回滚）
- @Async + @Transactional 同时用 = 事务失效（不同线程，ThreadLocal 不共享）
- 一句话：**「事务失效 = 代理没拦截到——记住同类内部调用是最高频的坑」**

## 状态
- [ ] 已背速记（5 大场景）
- [ ] 能讲通俗版
- [ ] 能答 REQUIRES_NEW vs NESTED 追问
