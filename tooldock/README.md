# 工具坞接入

按 ToolDock v1 协议提供6个单体服务和2个复合服务，启动顺序为后端 → 网页 → 桌面，停止由工具坞按逆序执行；已运行的成员跳过。导入 Compound 项目根目录即可识别清单，不执行启动。

| 环境 | 后端 | 网页 | 桌面健康端口 |
|---|---|---|---|
| dev | 18980 | 18981 | 18982 |
| prod | 18880 | 18881 | 18882 |

backend.py 只装配原有后端入口；web.cjs 只转发页面、API、语音协商，不承接业务；desktop.cjs 装配原有 Electron 和只读健康端口。桌面运行/待办布局仍来自 workspace。不改变原有19080/19081手动运行方式，但同环境手动后端必须退出后才可启动工具坞后端，避免共享数据库和备份的重复进程。

PowerShell 脚本使用 UTF-8 BOM，兼容 Windows PowerShell 5.1 中文解析；输出UTF-8，参数逐项引用，不使用cmd拼接。后台隐藏启动，Electron显示交互窗口。状态根据实际进程身份、监听端口和HTTP探测，不使用PID文件判定；端口被陌生进程占用时拒绝启停。

短命 Python 启动器以参数数组创建服务，关闭继承句柄并将输出写入日志，避免 PowerShell 输出管道被后台进程占用。PowerShell 只等待启动器，不用 `Start-Process -Wait` 等待整个后代进程树。后台服务使用 CREATE_NO_WINDOW，Electron保留交互窗口。

日志在忽略的 `.run/tooldock/<环境>/`；数据库和备份仍使用项目默认的环境路径。需要先安装 `.venv`、Node依赖并完成 `npm run build`；接入脚本不安装依赖、不读取或打印密钥。

验证：`.venv/Scripts/python.exe -m pytest tooldock/tests -q`。临时Git、SQLite、动态独立端口和测试组合键不操作prod，也不写既有dev。协议可由工具坞 `src/shared/protocol.cjs` 的 validateProject 校验。`COMPOUND_TOOLDOCK_CONFIG` 仅用于显式隔离验收的路径和端口覆盖。

已完成真实 Windows PowerShell 三服务启动、重复启动、网页单独停止恢复、逆序停止、重复停止与陌生端口占用拒绝；测试桌面使用临时快捷键配置。prod仅查询状态，未执行启停。工具坞内选择“添加项目”，导入 Compound 项目根目录；旧项目登记不修改。
