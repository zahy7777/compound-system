"""工具坞独立入口；环境和路径明确传给原有后端。"""
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[3]
os.chdir(root)
sys.path.insert(0, str(root))
from backend.__main__ import main

main()
