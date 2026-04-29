#!/usr/bin/env python3
"""
moc_sync.py — 知识库 MOC 同步脚本
====================================
用法：
  python moc_sync.py                      # 扫描所有 MOC
  python moc_sync.py 01-AI大模型          # 只扫描指定模块
  python moc_sync.py --dry-run            # 只打印差异，不写文件

逻辑：
  1. 遍历指定模块目录下所有 .md（排除 _MOC.md 本身）
  2. 检查文件名是否已出现在对应 _MOC.md 的链接里
  3. 把未收录的文件追加到 MOC 末尾的「## 未收录（待整理）」区块
  4. 如果该区块已存在，先清空再重写（保证幂等）
"""

import argparse
import re
import sys
from pathlib import Path

BRAIN_ROOT = Path(__file__).parent
MOC_FILENAME = "_MOC.md"
UNCATEGORIZED_HEADER = "## 未收录（待整理）"
UNCATEGORIZED_HINT = "_以下文件已在目录中但尚未加入上方导航，请手动分类后删除本区块的对应条目。_"


def find_linked_names(moc_text: str) -> set[str]:
    """从 MOC 文本里提取所有 [[...]] 链接中的文件名部分"""
    # 匹配 [[path/to/文件名|显示名]] 或 [[文件名]]
    pattern = re.compile(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]')
    linked = set()
    for match in pattern.findall(moc_text):
        # 取最后一段路径作为文件名（不带 .md）
        linked.add(Path(match).name)
    return linked


def get_all_md_files(module_dir: Path) -> list[Path]:
    """递归找模块目录下所有 .md，排除 _MOC.md 和 _开头的文件"""
    return sorted([
        f for f in module_dir.rglob("*.md")
        if f.name != MOC_FILENAME and not f.name.startswith("_")
    ])


def build_uncategorized_block(missing_files: list[Path], module_dir: Path) -> str:
    """生成未收录区块的 Markdown 文本"""
    if not missing_files:
        return ""

    lines = [UNCATEGORIZED_HEADER, "", UNCATEGORIZED_HINT, ""]
    for f in missing_files:
        # 生成相对于 brain root 的 wikilink 路径
        rel = f.relative_to(BRAIN_ROOT).with_suffix("")
        lines.append(f"- [[{rel}|{f.stem}]]")
    lines.append("")
    return "\n".join(lines)


def sync_moc(module_dir: Path, dry_run: bool = False) -> bool:
    """同步单个模块的 MOC，返回是否有变更"""
    moc_path = module_dir / MOC_FILENAME
    if not moc_path.exists():
        print(f"  [跳过] {module_dir.name}：找不到 _MOC.md")
        return False

    moc_text = moc_path.read_text(encoding="utf-8")
    all_files = get_all_md_files(module_dir)
    linked_names = find_linked_names(moc_text)

    missing = [f for f in all_files if f.stem not in linked_names]

    if not missing:
        print(f"  [✓ 已同步] {module_dir.name}（共 {len(all_files)} 个文件，全部已收录）")
        return False

    print(f"  [!] {module_dir.name}：发现 {len(missing)} 个未收录文件：")
    for f in missing:
        print(f"      + {f.relative_to(module_dir)}")

    if dry_run:
        return True

    # 移除旧的未收录区块（如果有）
    moc_text = re.sub(
        rf"\n?{re.escape(UNCATEGORIZED_HEADER)}.*",
        "",
        moc_text,
        flags=re.DOTALL,
    ).rstrip()

    # 追加新的未收录区块
    new_block = build_uncategorized_block(missing, module_dir)
    new_text = moc_text + "\n\n---\n\n" + new_block

    moc_path.write_text(new_text, encoding="utf-8")
    print(f"      → 已写入 {moc_path.relative_to(BRAIN_ROOT)}")
    return True


def main():
    parser = argparse.ArgumentParser(description="同步知识库 MOC 文件")
    parser.add_argument("module", nargs="?", help="指定模块目录名（如 01-AI大模型），不填则扫描全部")
    parser.add_argument("--dry-run", action="store_true", help="只打印差异，不修改文件")
    args = parser.parse_args()

    if args.module:
        targets = [BRAIN_ROOT / args.module]
    else:
        targets = sorted([
            d for d in BRAIN_ROOT.iterdir()
            if d.is_dir() and not d.name.startswith("_") and (d / MOC_FILENAME).exists()
        ])

    if not targets:
        print("未找到目标目录")
        sys.exit(1)

    mode = "（dry-run，不写文件）" if args.dry_run else ""
    print(f"=== MOC 同步 {mode}===")
    changed = 0
    for t in targets:
        if sync_moc(t, dry_run=args.dry_run):
            changed += 1

    print(f"\n完成：{len(targets)} 个模块扫描，{changed} 个有变更。")


if __name__ == "__main__":
    main()
