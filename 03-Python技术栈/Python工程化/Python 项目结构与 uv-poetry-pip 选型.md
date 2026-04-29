---
tags: [P1, AI方向, 具身方向, 生疏]
来源: 专题 · 具身 Agent
相关: [[_专题-具身Agent/_MOC]]
---

# Python 项目结构与 uv-poetry-pip 选型

## 一句话速记

包管理器选型：**新项目首选 uv**（Rust 写、10–100x 快、能管 Python 版本）；老项目 poetry 兼容；最简朴脚本 pip + venv + requirements.txt。项目布局用 **src layout**（`src/my_pkg/` + `tests/` + `pyproject.toml`），逼自己 `pip install -e .` 后再跑测试，避免"测的是源码而不是装好的包"的坑。

## 通俗解释（5 分钟版）

**和 Java 对照**：Java 有 Maven (`pom.xml`) 和 Gradle (`build.gradle`)；Python 历史上一直**没有官方包管理器**，社区前赴后继出了一堆——pip / setuptools / pipenv / poetry / pdm / rye / uv……新人看着头大。

**包管理实际就解决三件事**：
1. **装** 依赖（含递归依赖）
2. **锁** 版本（lockfile，保证别人也装出一模一样的环境）
3. **发** 项目（打成 wheel 发到 PyPI 或公司仓库）

**三种方案对比**：

| 方案 | 装 | 锁 | 发 | 速度 | 适用 |
|---|---|---|---|---|---|
| pip + venv + requirements.txt | ✓ | 弱（无传递依赖锁） | ✗ | 中 | 教学、临时脚本 |
| Poetry | ✓ | ✓ poetry.lock | ✓ | **慢**（解析依赖久） | 老项目主流 |
| **uv** ⭐ | ✓ | ✓ uv.lock | ✓ | **极快**（Rust） | 新项目首选 |

**uv 为啥起飞**：
- Astral 团队（ruff 那帮人）2024 年出品
- Rust 写的，依赖解析比 poetry 快 10–100 倍
- **取代了 pyenv** —— `uv python install 3.12` 一行装 Python
- **取代了 venv 工具链** —— `uv venv` / `uv sync` 自动管虚拟环境
- 命令记忆比 poetry 简单：`uv add 包` / `uv sync` / `uv run xxx`

**LLM 圈的趋势**：langchain、langgraph、llamaindex 这些 2024+ 新项目大量用 uv；OpenAI 官方 SDK 文档示例也开始用 uv。

## 关键细节 / 数学直觉

**推荐项目结构（src layout）**：
```
my-project/
├── pyproject.toml         # 配置中心：依赖、构建、ruff/mypy/pytest 全在这
├── README.md
├── uv.lock                # 锁文件，进 git
├── .python-version        # 固定 Python 版本（uv 自动识别）
├── .gitignore
├── src/
│   └── my_pkg/
│       ├── __init__.py
│       ├── core.py
│       └── api.py
├── tests/
│   ├── __init__.py
│   └── test_core.py
└── scripts/               # 开发脚本
    └── eval.py
```

**`pyproject.toml` 一文件管所有**（PEP 621 标准）：
```toml
[project]
name = "my-pkg"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "pydantic>=2.0",
    "fastapi>=0.110",
    "httpx>=0.27",
]

[dependency-groups]
dev = ["pytest", "ruff", "mypy"]

[tool.ruff]
line-length = 100

[tool.mypy]
strict = true

[tool.pytest.ini_options]
testpaths = ["tests"]
```

**uv 常用命令对照**：
```bash
uv init my-project          # 初始化新项目
uv python install 3.12      # 装 Python 版本
uv add httpx                # 加运行时依赖
uv add --dev pytest         # 加开发依赖
uv sync                     # 按 lockfile 装齐所有依赖
uv run python -m my_pkg     # 在虚拟环境里跑命令
uv run pytest               # 跑测试
uv lock --upgrade           # 升级依赖并刷新 lockfile
```

**src layout vs flat layout**：
- **flat layout**（包代码直接在仓库根）：`my_pkg/` 和 `tests/` 平级，能 `import my_pkg` 是因为 cwd 就是仓库根
- **src layout**（包代码在 `src/` 下）：必须 `pip install -e .` 后才能 import
- src 的好处是**强制隔离**——你测试时跑的是"装好的包"，和用户真实使用一致；flat 容易出现"本地跑好好的，发出去的 wheel 用户用就 import 错"

**lockfile 解决什么**：
- `requirements.txt` 通常只写 `pandas>=2.0`，pip 装的时候不一定每次都解析成同一个具体版本
- `uv.lock` / `poetry.lock` 是**精确到 commit hash**的快照，所有传递依赖都钉死
- → 同一个 lockfile 在不同机器装出来字节级一致

**选型决策树**：
- 新项目 / LLM 应用 → **uv**
- 公司有历史 poetry 项目 → 跟着公司用 poetry，迁移成本不一定值
- 5 行的临时脚本 → `pip install xxx` 全局装也行，别上 nuclear option
- 需要发 PyPI / 内部 PyPI → 任何一个都能搞，看团队习惯

## 延伸追问
- **Q：** 为什么不直接全局 pip install？  
  → 不同项目要不同版本，全局会冲突；操作系统自带的 Python 也会被污染。每个项目独立 venv 是基本卫生。
- **Q：** lockfile 解决什么问题？为什么 requirements.txt 还不够？  
  → 传递依赖的小版本漂移会导致"我电脑能跑你电脑跑不了"。lockfile 钉死所有依赖（含传递）的精确版本和 hash。
- **Q：** src layout 和 flat layout 区别？  
  → src 强制 `pip install -e .`，测试时跑的是装好的包，能暴露打包问题；flat 简单但容易"本地能跑、发出去用户跑不通"。
- **Q：** uv 比 poetry 快这么多，原因是什么？  
  → Rust 写依赖解析器（poetry 是 Python 写的），并行下载 + 全局缓存 + 更聪明的版本求解算法。

## 我的记法

> 包管理三件事：**装、锁、发**。pip 只管装；poetry/uv 全套。新项目选 **uv**——Rust 写的，速度起飞，还顺手取代 pyenv。布局选 **src layout**——逼自己 `pip install -e .`，避免打包前后行为不一致。

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
- [ ] 用 uv 起过一个 demo 项目

## 参考资料
- [uv 官方文档](https://docs.astral.sh/uv/)
- [Python Packaging User Guide — src layout vs flat layout](https://packaging.python.org/en/latest/discussions/src-layout-vs-flat-layout/)
- [PEP 621 — Storing project metadata in pyproject.toml](https://peps.python.org/pep-0621/)
