# Compound 开发约定

- 内核只提供 POST /write、POST /read。HTTP 使用 aiohttp 单线程事件循环；收完输入后同步执行事实操作，不 await、不使用线程池，异步备份不阻塞写入。禁止阻塞式 HTTPServer，浏览器预建空连接会堵住请求。
- backend/kernel 只负责协议校验与输入处理，无持久状态。service/repo/facts 拥有 SQLite、ID 分配和存取；service/backup 拥有备份进度、JSONL 和 Git。跨概念只使用公开能力。
- DATA/compound-log 各环境检出的 protocol.yaml 是唯一协议及标签规则来源，不复制正则或前缀到代码。
- 所有变化追加完整版本，标签绑定版本。源 ID等于第一版版本 ID；先确定最新版本，再排除软删除，再查询标签包含关系。
- 前端只使用 write/read，原生 DOM；统一构造完整版本，保留未编辑的标签。无队列、预测状态、记忆表、计时或模板。
- 输入与删除确认使用页面原生 dialog，禁止 window.prompt/confirm/alert；浏览器测试实际填写点击 DOM，不能代接弹窗掩盖内嵌浏览器问题。
- 空组只在页面内保留。组删除软删除全部成员；组移动只操作来源区域成员。
- 测试使用临时 Git/SQLite，默认 19884 独立端口，可用 COMPOUND_TEST_PORT 指定空闲端口，不复用已有服务。后端 pytest 和真实 Chromium E2E 必须通过，保留回归套件。
- Windows 读写及子进程显式 UTF-8。SQLite/WAL、临时文件不进 Git；不触碰旧 flywheel_log 数据。
- 每个完成闭环提交标题和正文；提交前检查 git diff、git diff --cached、git status，只暂存任务相关文件，不 amend/rebase/force push，不推送应用 Git。
