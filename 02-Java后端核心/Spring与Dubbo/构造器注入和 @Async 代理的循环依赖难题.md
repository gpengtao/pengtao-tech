---
tags: [P1, Java方向, 生疏]
相关: "[[02-Java后端核心/_MOC]]"
---

# 构造器注入 / @Async 代理对象的循环依赖难题

## 一句话速记

**构造器注入的循环依赖 Spring 无法解决**，因为 bean 实例化时就需要对方（还没机会放入缓存）。**@Async 代理循环依赖**更隐蔽：@Async 会在 bean 创建完成后再创建代理，如果此时已有其他 bean 持有了 bean 的原始引用（通过三级缓存拿的），代理创建完会报错（`expected single matching bean but found 2`）或静默地让部分 bean 持有非代理对象——导致 @Async 失效。**解法**：重构依赖关系，或用 @Lazy 打破循环。

## 通俗解释（5 分钟版）

### 构造器注入循环依赖

```java
@Component
class A {
    A(B b) { this.b = b; }  // 构造器注入 B
}
@Component
class B {
    B(A a) { this.a = a; }  // 构造器注入 A
}

// 创建 A → new A(b) → 需要 b → 创建 B → new B(a) → 需要 a → 创建 A...
// A 没有实例化，不能放入缓存，B 也等不到 a
// → BeanCurrentlyInCreationException
```

**为什么三级缓存解决不了**：
- 三级缓存放的是"已实例化（new 完成）但属性未填充"的 bean
- 构造器注入 = 实例化时就依赖对方 = 还没进 new，没有实例化
- **无解**，必须重构

### @Async 代理的循环依赖

这个更复杂，分三个阶段理解：

```
正常 @Transactional：
  AOP 代理在三级缓存的 ObjectFactory.getObject() 里创建
  → 其他 bean 通过三级缓存拿到的就是代理对象 ✓

@Async 的问题：
  @Async 的代理不是通过 SmartInstantiationAwareBeanPostProcessor 处理的
  而是通过 BeanPostProcessor.postProcessAfterInitialization 处理的
  → 时机更晚：bean 初始化完成之后才创建代理
  
  如果循环依赖时：
  1. A 实例化，进入三级缓存
  2. 创建 B，B 需要 A → 从三级缓存拿到 A（原始对象，不是代理）
  3. B 完成初始化
  4. A 完成初始化 → @Async 后处理器创建 A 的代理
  5. 一级缓存里的 A = 代理对象
  6. 但 B 持有的是 A 的原始对象（步骤 2 拿到的）！
  → B 调用 A 的异步方法时，是调用原始对象上的，@Async 失效！
  → 或者 Spring 检测到不一致，抛出异常
```

## 关键细节

### 1）构造器注入循环依赖的解法

**解法 1：@Lazy 延迟注入（推荐）**

```java
@Component
class A {
    A(@Lazy B b) { this.b = b; }  // 注入 B 的代理，首次使用时才初始化 B
}
// 原理：@Lazy 不在构造时立刻要 B，而是注入一个 B 的代理
// 首次调用 b 的方法时，代理才去 Spring 容器里真正获取 B 实例
```

**解法 2：setter 注入替代构造器注入**

```java
@Component
class A {
    @Autowired
    public void setB(B b) { this.b = b; }  // setter 注入，三级缓存能处理
}
```

**解法 3：重构，抽公共依赖**

```java
// A 和 B 都依赖 C（原来 A 依赖 B、B 依赖 A 中的公共逻辑抽到 C）
@Component class A { A(C c) {...} }
@Component class B { B(C c) {...} }
@Component class C { ... }  // 不依赖 A 或 B
```

### 2）@Async 循环依赖的报错复现

```java
@Service
class OrderService {
    @Autowired
    UserService userService;  // setter 注入
    
    @Async
    public void asyncOrder() { ... }
}

@Service
class UserService {
    @Autowired
    OrderService orderService;  // setter 注入 → 产生循环依赖
}
```

**Spring 启动时报错**（Spring Boot 2.6+）：

```
Bean with name 'orderService' has been injected into other beans
[userService] in its raw version as part of a circular reference,
but has eventually been wrapped (for example as part of auto-proxy
creation). This means that said other beans do not use the final
version of the bean.
```

或在更旧版本，不报错但 @Async 静默失效（UserService 持有 OrderService 的原始对象）。

### 3）@Async 循环依赖的解法

**解法 1：@Lazy**

```java
@Service
class UserService {
    @Autowired @Lazy
    OrderService orderService;  // 延迟获取，到用时才从 Spring 拿最终代理对象
}
```

**解法 2：@Async 改为 ApplicationContext 异步提交**

```java
// 不用 @Async，改用 ThreadPoolTaskExecutor 手动提交
@Service
class OrderService {
    @Autowired
    TaskExecutor executor;
    
    public void asyncOrder() {
        executor.execute(() -> doAsyncOrder());  // 手动异步
    }
    
    private void doAsyncOrder() { ... }
}
```

**解法 3：重构消除循环依赖（根本解法）**

### 4）@Async 不用三级缓存的原因

```
@Transactional（走三级缓存）：
  SmartInstantiationAwareBeanPostProcessor.getEarlyBeanReference()
  → 在 bean 被早期引用时提前创建代理
  → 一致性保证：所有 bean 持有的都是代理

@Async（不走三级缓存）：
  AsyncAnnotationBeanPostProcessor extends AbstractAdvisingBeanPostProcessor
  → 只在 postProcessAfterInitialization() 里创建代理
  → 不重写 getEarlyBeanReference()
  → 无法提前代理，只能在初始化完成后替换
  → 循环依赖时，其他 bean 可能已经持有了原始对象
```

**这是 Spring 有意的设计**：@Async 的代理创建时机晚于 @Transactional，是 Spring 权衡后的设计（@Async 代理的创建不需要在循环依赖中提前暴露）。

### 5）如何检测是否有 @Async 失效问题

```java
// 测试：@Async 方法返回的 Future 是否真的在新线程执行
@Test
void testAsyncReallyAsync() throws Exception {
    String mainThread = Thread.currentThread().getName();
    Future<String> future = orderService.asyncOrder();
    String asyncThread = future.get();
    assertNotEquals(mainThread, asyncThread);  // 应该在不同线程
}

// 如果 @Async 失效，asyncOrder 会在调用者线程同步执行
```

## 延伸追问

- **Q：`@Lazy` 加在哪里更合适——字段上还是方法上？**
  → 优先加在依赖方（注入点）而不是被依赖方。`@Lazy` 告诉 Spring "这个依赖不要立即初始化"，加在字段上 `@Autowired @Lazy`，或加在构造器参数上。
- **Q：Spring Boot 2.6 禁止循环依赖对已有代码影响大吗？**
  → 启动时直接报错，之前能跑的服务可能跑不起来。可以临时用 `spring.main.allow-circular-references=true` 打开，但更推荐彻底重构消除循环依赖。
- **Q：@Async 可以和 @Transactional 一起用吗？**
  → 可以，但要注意：@Async 在新线程运行，新线程没有原调用者的事务上下文。所以 @Async 方法里的 @Transactional 会开启一个**新事务**，与调用者的事务完全独立。这通常是期望的行为（异步操作独立事务），但如果期望同一事务里完成，就不能用 @Async。

## 我的记法

- **构造器循环依赖无解**：new 的时候就要对方，放不了缓存
- 解法：@Lazy（延迟代理）/ setter 注入 / 重构
- **@Async 循环依赖**：代理时机晚（postProcessAfterInitialization），其他 bean 已持有原始对象
- @Async 失效后果：异步方法在调用者线程同步执行（看起来方法"调用"了，但不在新线程）
- @Async 解法：@Lazy + 重构（消除循环依赖）
- 一句话：**「构造器循环依赖是死局，@Async 循环依赖是静默失效——两者都要靠重构根治」**

## 状态
- [ ] 已背速记
- [ ] 能解释 @Async 为什么不走三级缓存
- [ ] 能答 @Async + @Transactional 追问
