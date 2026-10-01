# 工具坞接入

按 ToolDock v1 协议提供4个单体服务和2个复合服务，每个环境只有 Compound 服务与 Electron 快捷桌面。组合按服务 → 桌面启动，停止按逆序；已运行成员跳过。Compound 服务提供网页、API、认证与语音，浏览器和 Electron 都直接使用它，没有单独的网页代理进程。

| 环境 | Compound 网页与 API | 桌面健康端口 |
| --- | --- | --- |
| dev | http://127.0.0.1:19080/ | 18982 |
| prod | http://127.0.0.1:19081/ | 18882 |

端口与原有手动入口统一。工具坞通过实际进程、端口与页面探测状态，识别本项目 Python 环境运行的 `-m backend` 入口；重复启动不另起服务。端口被陌生进程占用时拒绝启停。后端脚本装配原有入口，桌面脚本装配原有 Electron 和只读健康端口；业务、展示和窗口职责保持在原有目录。

公网由相邻 public_gateway 的共享路由与 NATAPP 隧道提供：`/compound/dev/` →19080、`/compound/prod/` →19081。两套独立密码和会话由 Compound access 管理。停止 Electron 不停止浏览器服务；停止 Compound 会同时影响本机与公网访问。入口与密码文件链接见 [访问备忘](../docs/access-memo.md)。

PowerShell 使用 UTF-8 BOM，兼容 Windows PowerShell 5.1；参数逐项引用，不使用 cmd 拼接。短命 Python 启动器关闭继承句柄并保存输出，后台服务隐藏启动，Electron 显示交互窗口。日志位于忽略的 `.run/tooldock/<环境>/`。接入不安装依赖，不读取或打印密钥。

先安装 `.venv`、Node 依赖并完成 `npm run build`，再在工具坞导入项目根目录；已有登记刷新后读取新清单。验证：`.venv/Scripts/python.exe -m pytest tooldock/tests -q`，使用临时 Git/SQLite、独立动态端口与桌面配置，覆盖两服务启停、重复启动、桌面独立退出恢复及陌生端口保护。`COMPOUND_TOOLDOCK_CONFIG` 仅用于隔离验收。协议由工具坞 `src/shared/protocol.cjs` 的 validateProject 校验。
