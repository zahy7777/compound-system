# 桌面快捷入口

构建依赖 Node.js 22.12+。

Electron 只管理窗口、托盘、全局快捷键及本地设置。页面复用 frontend；事实、森林和计时规则不复制到桌面端。

先启动对应环境的 Compound 服务，再执行 `npm run desktop:dev` 或 `npm run desktop:prod`。前者加载 19080，后者加载 19081。关闭窗口只隐藏，托盘菜单“退出”结束程序；不显示任务栏图标。

运行入口依次呈现结果计时条、未分组运行事实、运行闭环组；待办入口保留新增待办、选择模板、新增闭环三个按钮。共用事实及闭环组件。

prod 默认运行 `Shift+Space`、待办 `Shift+Alt+Q`；dev 分别增加 Ctrl。右上角设置支持点击后按组合键，注册失败保留原配置。配置分别位于 `%APPDATA%/Compound-dev` 和 `%APPDATA%/Compound-prod`。

浏览器可访问 `/?presentation=running`、`/?presentation=todo` 验证布局。桌面窗口激活时重新读取；录入弹窗打开时保留草稿。当前不做推送同步，也不制作安装器。

`npm run test:e2e` 使用临时后端、Git、SQLite。桌面测试另设临时配置目录与测试快捷键，不占用 prod/dev 的正式快捷键。`COMPOUND_DESKTOP_URL` 和 `COMPOUND_DESKTOP_DATA` 用于隔离测试入口。
