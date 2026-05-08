---
tags: [P0, Java方向, 生疏]
相关: "[[02-Java后端核心/index]]"
---
# Spring 三级缓存解决循环依赖

## 一句话速记

**Spring 通过三级缓存解决 setter 注入的循环依赖**：① `singletonObjects`（完整 bean）② `earlySingletonObjects`（早期引用）③ `singletonFactories`（ObjectFactory，用于产生代理）。当 A 依赖 B、B 依赖 A 时：**A 实例化后提前把 ObjectFactory 放入三级缓存**，B 在初始化时通过 ObjectFactory 拿到 A 的早期引用，完成 B 的初始化，A 再拿到完整的 B。**注意**：构造器注入循环依赖无法解决（实例化时就需要对方，而此时自己还没放入缓存）。

## 通俗解释（5 分钟版）

**为什么需要三级缓存**：

```
正常注入：A → B（A 依赖 B）
  1. 创建 A → 发现需要 B → 创建 B → B 完成 → 注入到 A → A 完成

循环依赖：A ↔ B（A 依赖 B，B 也依赖 A）
  1. 创建 A → 发现需要 B → 创建 B → 发现需要 A → 等 A...
                                                           ↑ 死锁！
```

**三级缓存的解法（提前暴露引用）**：

```
1. 创建 A（new A()，实例化但未填充属性）
   → 把 A 的 ObjectFactory 放入三级缓存 singletonFactories

2. 开始填充 A 的属性，发现需要 B

3. 创建 B（new B()），把 B 的 ObjectFactory 放入三级缓存

4. 填充 B 的属性，发现需要 A
   → 在三级缓存找到 A 的 ObjectFactory
   → 调用 getObject() 得到 A 的早期引用（可能是原始对象或代理）
   → 把 A 的早期引用放入二级缓存 earlySingletonObjects
   → 把 A 的 ObjectFactory 从三级缓存移除

5. B 持有 A 的早期引用，B 初始化完成
   → B 放入一级缓存 singletonObjects

6. 回到 A 的属性填充，注入完整的 B

7. A 初始化完成（afterPropertiesSet / init-method 执行）
   → A 放入一级缓存，从二级缓存移除
```

## 关键细节

### 1）三级缓存的具体实现

```java
// DefaultSingletonBeanRegistry
Map<String, Object> singletonObjects = new ConcurrentHashMap<>();       // 一级：完整 bean
Map<String, Object> earlySingletonObjects = new ConcurrentHashMap<>();  // 二级：早期引用
Map<String, ObjectFactory<?>> singletonFactories = new HashMap<>();     // 三级：工厂

// 获取 bean 的顺序
protected Object getSingleton(String beanName, boolean allowEarlyReference) {
    Object bean = singletonObjects.get(beanName);  // 一级
    if (bean == null) {
        bean = earlySingletonObjects.get(beanName);  // 二级
        if (bean == null && allowEarlyReference) {
            ObjectFactory<?> factory = singletonFactories.get(beanName);  // 三级
            if (factory != null) {
                bean = factory.getObject();  // 可能触发 AOP 代理
                earlySingletonObjects.put(beanName, bean);
                singletonFactories.remove(beanName);
            }
        }
    }
    return bean;
}
```

### 2）为什么需要三级缓存而不是两级？

**关键**：AOP 代理！

```
如果 A 需要被 AOP 代理（如 @Transactional）：

两级缓存的问题：
  A 实例化后放入二级缓存（原始对象）
  B 注入了 A 的原始对象
  A 初始化完成后，Spring 把 A 替换成 AOP 代理对象放入一级缓存
  → B 持有的是原始 A，不是代理 A → B 事务方法调用绕开了代理！

三级缓存的解法：
  A 实例化后放入三级缓存（ObjectFactory）
  B 需要 A 时，通过 ObjectFactory.getObject() 
  → ObjectFactory 内部调用 AOP 后处理器
  → 如果 A 需要代理，直接返回代理对象（提前代理）
  → B 注入的是 A 的代理对象 ✓
```

**三级缓存的 ObjectFactory 就是为了支持"提前 AOP 代理"的接入点。**

### 3）哪些循环依赖 Spring 解决不了

**a) 构造器注入**：

```java
@Component
public class A {
    public A(B b) { ... }  // 构造器注入 B
}
@Component
public class B {
    public B(A a) { ... }  // 构造器注入 A
}
// 报错：BeanCurrentlyInCreationException
// 原因：构造器调用时对象还没实例化，放不了缓存
```

**b) prototype scope 的循环依赖**：

```java
@Scope("prototype")
public class A { @Autowired B b; }
@Scope("prototype")
public class B { @Autowired A a; }
// prototype bean 每次都创建新实例，Spring 不缓存 prototype bean
// 无法通过缓存解决
```

**c) @Async + 循环依赖（特殊坑）**：

见下一个笔记。

### 4）Spring Boot 2.6+ 的变化

```
Spring Boot 2.6 开始，默认禁止循环依赖：
  spring.main.allow-circular-references=false  # 默认值

遇到循环依赖直接报错（而不是默默用三级缓存解决）
目的：强迫开发者通过合理设计解决循环依赖，而不是依赖框架"魔法"

解法：
  1. 打开允许（不推荐）: spring.main.allow-circular-references=true
  2. 重构代码：
     - 抽取公共依赖到第三个 bean
     - 用 @Lazy 延迟注入
     - 用 ApplicationContext.getBean() 懒获取
     - 重新设计依赖关系
```

### 5）@Lazy 解决循环依赖

```java
// 不改设计，用 @Lazy 解决
@Component
public class A {
    @Autowired @Lazy   // 注入的是 B 的代理，实际使用时才初始化 B
    private B b;
}
```

**原理**：`@Lazy` 不直接注入 B，而是注入一个 B 的代理对象——代理在第一次方法调用时才真正初始化 B，此时 A 已经完整初始化，循环依赖被打破。

## 延伸追问

- **Q：三级缓存中二级缓存的意义是什么？如果只有一级和三级可以吗？**
  → 二级缓存是"已经从三级缓存 ObjectFactory 获取过的早期引用"的缓存——如果同一个 bean 被多个其他 bean 循环依赖，只通过 ObjectFactory 一次，结果缓存在二级。没有二级缓存，每次获取都调用 ObjectFactory，可能创建多个代理实例。
- **Q：Spring 三级缓存只能解决 singleton scope 的问题吗？**
  → 是的。只有 singleton scope 的 bean 会放入三级缓存（因为 singleton 只有一个实例，可以缓存共享）。prototype scope 每次创建新实例，无法用缓存解决循环依赖。
- **Q：什么情况下循环依赖是合理设计？**
  → 基本上不合理——循环依赖意味着两个类互相知道对方，高度耦合，应该通过引入新抽象、服务拆分或事件机制解耦。`@Lazy` 或允许循环依赖只是短期 workaround。

## 我的记法

- **三级缓存**：一级（完整bean）/ 二级（早期引用）/ 三级（ObjectFactory）
- **解决时序**：实例化A → 放三级 → 填充属性找B → 创建B → B找A从三级拿早期引用 → B完成 → A完成
- **为什么要三级**：三级 ObjectFactory 支持提前 AOP 代理，二级只能存原始对象
- 解决不了：**构造器注入** / **prototype** / **@Async 特殊情况**
- Spring Boot 2.6+ **默认禁止**循环依赖（直接报错）
- 一句话：**「三级缓存用 ObjectFactory 提前暴露自己，打破循环等待——同时支持 AOP 提前代理」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答为什么需要三级（AOP 代理问题）
