---
tags: [P1, Python方向, 生疏]
相关: "[[03-Python技术栈/index]]"
---

# Poetry / uv / pip 的选型

## 一句话速记

**pip** = 最基础的包安装器，无依赖锁定，无虚拟环境管理，适合脚本和学习；**Poetry** = 成熟的依赖管理 + 打包一体化工具，`pyproject.toml` 管理依赖，`poetry.lock` 保证可重现，适合正式项目；**uv** = Rust 实现的极速现代化工具（pip + venv 替代），比 pip 快 10-100x，2024 年出现，已成为 AI/LLM 项目新标准。**AI 新项目首选 uv，现有 Poetry 项目保持不动**。

## 关键细节

### 1）三者对比

```
维度              pip              Poetry           uv
──────────────────────────────────────────────────────────────
速度              慢（纯 Python）  中等             极快（Rust，10-100x pip）
虚拟环境          手动 venv        自动管理          自动管理
依赖锁定          无（需 pip-tools）poetry.lock      uv.lock
依赖解析          基础             强               强（更快）
打包发布          否（需 build）   是（内置）        否（不管发布）
pyproject.toml   只用部分          完整支持          完整支持
学习曲线          低              中等              低
稳定性            极高            高（7年+）        高（2024，快速成熟）
AI/LLM 项目使用  通用脚本          中大型项目        新项目主流
```

### 2）uv 的典型用法

```bash
# 安装 uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 创建新项目
uv init my-project
cd my-project

# 创建并激活虚拟环境（或让 uv 自动管理）
uv venv               # 创建 .venv
source .venv/bin/activate

# 添加依赖（修改 pyproject.toml + uv.lock）
uv add fastapi pydantic
uv add --dev pytest ruff mypy  # dev 依赖

# 安装所有依赖（从 uv.lock 精确还原）
uv sync

# 运行命令（自动使用虚拟环境，无需 activate）
uv run python app.py
uv run pytest

# 速度对比（实际测试）：
# pip install torch → ~3 分钟
# uv add torch → ~30 秒（快 6x+）
```

**uv 的 `pyproject.toml`**：

```toml
[project]
name = "my-llm-service"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.111.0",
    "pydantic>=2.0",
    "openai>=1.0",
    "uvicorn[standard]>=0.30",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "ruff>=0.5",
    "mypy>=1.10",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### 3）Poetry 的典型用法

```bash
# 安装 Poetry
curl -sSL https://install.python-poetry.org | python3 -

# 创建项目
poetry new my-project
cd my-project

# 添加依赖
poetry add fastapi pydantic
poetry add --group dev pytest

# 安装依赖（poetry.lock 精确还原）
poetry install

# 运行（自动虚拟环境）
poetry run python app.py
poetry run pytest

# 切换 Python 版本
poetry env use python3.12
```

**Poetry 的 `pyproject.toml`**：

```toml
[tool.poetry]
name = "my-project"
version = "0.1.0"
description = ""
authors = ["Your Name <you@example.com>"]

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.111.0"
pydantic = "^2.0"

[tool.poetry.group.dev.dependencies]
pytest = "^8.0"
ruff = "^0.5"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

### 4）pip + venv（传统方式）

```bash
# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate     # Linux/Mac
.venv\Scripts\activate        # Windows

# 安装
pip install fastapi pydantic

# 锁定依赖（需要 pip-tools）
pip install pip-tools
pip-compile requirements.in    # 生成 requirements.txt（含精确版本）
pip-sync requirements.txt      # 严格同步依赖

# 导出当前环境
pip freeze > requirements.txt  # 不精确（包含所有传递依赖）
```

**requirements.txt 的问题**：

```
pip freeze 输出所有包（包括传递依赖），难以区分直接依赖和传递依赖
版本可能因环境而异（没有 hash 锁定）
→ 现代项目推荐 pip-tools 的 requirements.in + requirements.txt 组合
  或者直接换 uv/Poetry
```

### 5）Python vs Java 包管理对比

```
维度              Python (pip/Poetry/uv)        Java (Maven/Gradle)
──────────────────────────────────────────────────────────────────
中央仓库          PyPI                           Maven Central
配置文件          pyproject.toml / requirements  pom.xml / build.gradle
依赖锁定          uv.lock / poetry.lock          pom.xml（版本固定）
虚拟环境          必须（每项目隔离）               不需要（classpath隔离）
版本冲突          常见且复杂（"dependency hell")  Gradle 有强大冲突解决
构建输出          wheel / sdist                  .jar / .war
代码发布          PyPI                           Maven Central / Nexus
```

### 6）选型决策树

```
是新项目？
  ├── 是 → 用 uv（速度快，现代，AI 生态支持好）
  └── 否（已有项目）
        ├── 已用 Poetry → 继续 Poetry（迁移成本不值得）
        ├── 已用 pip → 可逐步迁移到 uv（兼容 requirements.txt）
        └── 已用 pip + conda（数据科学）→ 继续 conda 或考虑 uv

需要发布到 PyPI？
  ├── 是 → Poetry（内置发布工具）或 uv + hatchling
  └── 否 → uv 更简单

团队有 Java 背景？
  → 推荐 Poetry（类似 Maven，有明确项目结构）
  → 或 uv（够简单，文档好）
```

## 延伸追问

- **Q：`pip install -r requirements.txt` 和 `uv sync` 的区别？**
  → `requirements.txt` 只有包名和版本（软约束），pip 重新解析可能安装不同版本；`uv.lock` 包含精确的 hash 锁定（每个包的 sha256），`uv sync` 保证每次安装完全一致，可重现构建。
- **Q：为什么 AI 项目越来越多用 uv 而不是 conda？**
  → conda 环境庞大、慢、与 pip 生态部分不兼容；随着 PyTorch 等框架提供 pip 安装方式，conda 的优势（二进制包管理）减弱。uv 速度极快，CUDA 版 PyTorch 通过 pip extras 安装 `--extra-index-url`，比 conda 更方便。
- **Q：uv 的 `uv.lock` 会提交到 git 吗？**
  → 应用项目：提交（保证团队和 CI 环境一致）；可复用库：不提交（锁文件约束用户的依赖解析）。和 Poetry 的 `poetry.lock` 规则相同。

## 我的记法

- **uv** = Rust 超快包管理，AI 新项目首选，`uv add / uv sync / uv run`
- **Poetry** = 成熟稳定，适合正式开源/大型项目，内置发布功能
- **pip** = 基础工具，学习/脚本用，生产要配 pip-tools 锁定
- `pyproject.toml` 是现代 Python 项目的统一配置文件（PEP 518/621）
- **已有 Poetry/conda 不用换，新项目用 uv**
- 一句话：**「uv 是速度 10x 的现代 pip，2024+ AI 项目默认选它」**

## 状态
- [ ] 已背速记（三者区别）
- [ ] 能写 uv 项目初始化命令
- [ ] 能解释 lock 文件的意义
