---
tags: [MOC, 通用]
priority: P1
---
# 08 · 应用安全 · 内容地图

> **定位**：应用层安全知识——常见漏洞原理与防御、认证授权、安全编码规范。每个知识点一题一文件，和六个技术模块解耦。

---

## 子模块导航

### 常见漏洞（OWASP Top 10）

_待补清单_
- SQL 注入的原理与防御（参数化查询 vs 转义）
- XSS（反射型/存储型/DOM 型）与 CSP 防御
- CSRF 的原理与防御（SameSite / Token）
- SSRF 的原理与防御
- 文件上传漏洞与校验策略
- 反序列化漏洞（Java ObjectInputStream / Python pickle）
- 命令注入与参数化执行

### 认证与授权

_待补清单_
- 密码存储：bcrypt / argon2 / salt / pepper
- JWT 安全使用：签名算法、过期策略、refresh token
- OAuth2 的四种授权模式与选型
- RBAC vs ABAC：权限模型选型
- 会话管理：Session vs Token、注销与过期

### 安全编码与运维

_待补清单_
- 敏感信息脱敏：日志、API 响应、数据库
- 审计日志设计：谁、何时、做了什么、结果如何
- 依赖供应链安全（CVE 扫描、SBOM）
- CORS 配置的安全原则
- TLS/HTTPS 的版本与 cipher suite 选型

---

## 本模块动态视图

```dataview
TABLE file.mtime AS "最近更新", tags AS "标签"
FROM "08-应用安全"
WHERE contains(tags, "生疏") OR contains(tags, "未动")
SORT file.mtime ASC
```
