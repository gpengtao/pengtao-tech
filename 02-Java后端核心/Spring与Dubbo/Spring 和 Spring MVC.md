# Spring 和 Spring MVC

## Spring 是什么

从配置管理到安全性、web 应用程序到大数据处理，无论你的项目需要什么样的基础设施，总有一个 Spring Project 能帮助到你构建你的项目。从小处开始，只使用你需要的部分——Spring 是模块化设计的。

![[some-spring-projects.png]]

平时说的 Spring，其实大部分意思是 Spring Framework，因为这个里面包含了最核心的 IoC container 部分。**Spring MVC 是 Spring Framework 的一个模块。**

![[spring-framework.png]]

## 什么是 Servlet

### Java Servlet 是工业标准（standard）

有两个大的版本：

```xml
<dependency>
    <groupId>javax.servlet</groupId>
    <artifactId>servlet-api</artifactId>
    <version>2.5</version>
    <scope>provided</scope>
</dependency>
```

```xml
<dependency>
    <groupId>javax.servlet</groupId>
    <artifactId>javax.servlet-api</artifactId>
    <version>3.1.0</version>
    <scope>provided</scope>
</dependency>
```

3.0 版本之后用了新的 artifactId。

什么是标准，标准就是**接口**，定义了流程，定义了规范。

### Web 服务器 vs Servlet 容器

Web 服务器使用 HTTP 协议来传输数据，用户/客户端只能向 Web 服务器请求静态网页。

![[web-server.jpg]]

Servlet 容器为处理每个请求分配独立的 Java 线程。每一个 Servlet 都是一个拥有能处理 HTTP 请求并作出响应的 Java 类。Servlet 容器的主要作用是将请求转发给相应的 Servlet 进行处理，并将动态生成的结果返回至客户端。

![[web-server-servlet-container.jpg]]

> 参考：https://www.programcreek.com/2013/04/what-is-servlet-container/

### 目前最流行的 Servlet 容器

- **Tomcat**：具有处理 HTML 页面的功能，也是 Servlet 和 JSP 容器，独立的 Servlet 容器是 Tomcat 的默认模式。
- **Jetty**：开源的 servlet 容器，开发人员可以将 Jetty 容器实例化成一个对象，可以迅速为独立运行的 Java 应用提供网络和 web 连接。
- **Jboss**：基于 J2EE 的开放源代码应用服务器，JBoss 核心服务不包括支持 servlet/JSP 的 WEB 容器，一般与 Tomcat 或 Jetty 绑定使用。

## Servlet 的配置方式

Servlet jar 包下有三个核心接口：`ServletContextListener`、`Filter`、`Servlet`，配置的目的是告诉容器构造哪些对象。

### 方式1：2.5 标准的 web.xml

```xml
<web-app>
    <listener>
        <listener-class>com.gpengtao.web.listener.GptContextListener</listener-class>
    </listener>

    <filter>
        <filter-name>requestLogFilter</filter-name>
        <filter-class>com.gpengtao.web.filter.requestLogFilter</filter-class>
    </filter>
    <filter-mapping>
        <filter-name>requestLogFilter</filter-name>
        <url-pattern>/gpt/*</url-pattern>
    </filter-mapping>

    <servlet>
        <servlet-name>showTime</servlet-name>
        <servlet-class>com.gpengtao.servlet.ShowTimeServlet</servlet-class>
        <load-on-startup>1</load-on-startup>
    </servlet>
    <servlet-mapping>
        <servlet-name>showTime</servlet-name>
        <url-pattern>/time/*</url-pattern>
    </servlet-mapping>
</web-app>
```

### 方式2：3.0 标准的注解

![[javax-servlet-api.png]]

```java
@WebListener
public class MyListener implements ServletContextListener {
    @Override
    public void contextInitialized(ServletContextEvent sce) {
        logger.info("My listener start");
    }
    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        logger.info("My lister end");
    }
}
```

```java
@WebFilter(filterName = "myFilter", urlPatterns = "/*")
public class MyFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        chain.doFilter(request, response);
    }
}
```

```java
@WebServlet(name = "showTime", urlPatterns = "/time")
public class ShowTimeServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.getWriter().write("ShowTime，现在时刻：" + new Date());
    }
}
```

### 方式3：SPI

**SPI（Service Provider Interface）** 约定：当服务提供者提供了接口的某个实现，在 jar 包的 `META-INF/services/` 目录里创建一个以服务接口命名的文件，文件内容是实现类的全限定名。外部程序装配时通过 `java.util.ServiceLoader` 自动发现并装载实例。

Servlet 3.0 定义了 `ServletContainerInitializer` 接口，利用 SPI 机制，容器启动时会自动调用实现类的 `onStartup` 方法。

**Spring MVC 的做法：** spring-web jar 包在 `META-INF/services/` 中注册了 `SpringServletContainerInitializer`，它扫描所有 `WebApplicationInitializer` 实现类并逐个调用 `onStartup`。

![[spring-servlet-init-spi.png]]

## Spring MVC

> 参考：https://docs.spring.io/spring/docs/5.1.5.RELEASE/spring-framework-reference/

Spring Web MVC 是基于 Servlet API 构建的原始 Web 框架，围绕**前端控制器模式（Front Controller Pattern）**设计，其中 `DispatcherServlet` 提供共享的请求处理算法，实际工作由可配置的委托组件执行。

Spring MVC 支持上下文层次结构：`Root WebApplicationContext` 跨多个 `DispatcherServlet` 实例共享（包含数据存储库、业务服务等基础 bean），每个 Servlet 有自己的子 `WebApplicationContext`。

![[mvc-context-hierarchy.png]]

### 配置 DispatcherServlet

**方式一：web.xml**

```xml
<web-app>
    <listener>
        <listener-class>org.springframework.web.context.ContextLoaderListener</listener-class>
    </listener>
    <context-param>
        <param-name>contextConfigLocation</param-name>
        <param-value>/WEB-INF/root-context.xml</param-value>
    </context-param>
    <servlet>
        <servlet-name>app1</servlet-name>
        <servlet-class>org.springframework.web.servlet.DispatcherServlet</servlet-class>
        <init-param>
            <param-name>contextConfigLocation</param-name>
            <param-value>/WEB-INF/app1-context.xml</param-value>
        </init-param>
        <load-on-startup>1</load-on-startup>
    </servlet>
    <servlet-mapping>
        <servlet-name>app1</servlet-name>
        <url-pattern>/app1/*</url-pattern>
    </servlet-mapping>
</web-app>
```

**方式二：Java 代码（Spring 推荐）**，实现 `WebApplicationInitializer` 或继承 `AbstractAnnotationConfigDispatcherServletInitializer`：

```java
public class MyWebAppInitializer extends AbstractAnnotationConfigDispatcherServletInitializer {
    @Override
    protected Class<?>[] getRootConfigClasses() {
        return null;
    }
    @Override
    protected Class<?>[] getServletConfigClasses() {
        return new Class<?>[] { MyWebConfig.class };
    }
    @Override
    protected String[] getServletMappings() {
        return new String[] { "/" };
    }
}
```

---

> 原博客发布日期：2019-03-22
