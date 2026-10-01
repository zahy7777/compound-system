# Compound 开发约定

- 后端概念：event_kernel 管正式小事；tags_forest 管 workspace 与 item_template；loop_template 管小事草稿数组；timer 只按不透明 key 管理计时。前端决定业务变化，后端只校验、保存、查询，不增加 move/run/archive 等业务命令。
- 八个 POST 接口固定为 /writeevent、/readevent、/writeforest、/readforest、/writelooptemplate、/readlooptemplate、/writetimer、/readtimer。概念内部只公开 write/read。禁止万能接口、旧格式兼容和额外 view 快捷封装。
- HTTP 使用 aiohttp 单线程事件循环，收完输入后同步执行数据库操作，不 await、不使用线程池。独立备份线程只做 event 文件与 Git IO。禁止阻塞式 HTTPServer。
- backend 无持久状态。service/repo/events、workspace、item_template、loop_template 各自拥有存取，共用 SQLite。repo 公共连接/事务能力负责一次请求的原子提交，不跨概念访问内部对象。API 装配能力，不承接业务规则。
- event 追加完整版本，标签绑定版本；先选同源最新版本，再排除删除，再匹配标签子集。源 ID 等于第一版版本 ID。森林/模板也追加完整记录，节点只有 tag/children，没有成员关系表。
- writeforest 中当前工作空间与当前事项模板同步事务双写；只有事项结构变化更新当前模板。移动小事只 writeevent。不同请求没有共同事务，不假装改名 event+森林是原子操作。
- 正式 event 格式唯一来源是 DATA/compound-log 对应检出的 protocol.yaml。森林/模板结构 YAML 在各自 backend 概念目录；森林标签格式复用 event 协议，不复制正则。
- **备份仓库只接收正式 event 日志及其协议。工作空间、事项模板、闭环模板只存本地 SQLite，绝不进入备份仓库。恢复 event 不恢复三份记忆。禁止添加状态日志或其他备份 JSONL。**
- 前端原生 DOM，不用框架、预测状态、待提交队列或浏览器存储。页面读森林、按路径 batch readevent 后挂载。空节点持久保存；切换视图不修改 event。
- 输入和确认使用页面原生 dialog，禁止 window.prompt/confirm/alert；E2E 实际填写点击 DOM，不能自动接弹窗掩盖内嵌浏览器问题。
- 测试使用临时 Git/SQLite，默认独立端口 19884，可用 COMPOUND_TEST_PORT 指定，不复用已有服务。保留 pytest 和真实 Chromium 全链路；桌面/390px 检查。不得操作运行数据或旧 flywheel_log 数据进行测试。
- Windows 读写及子进程显式 UTF-8。SQLite/WAL、日志与临时文件不进应用 Git。
- 每个闭环提交标题和正文；提交前检查 git diff、git diff --cached、git status，只暂存本任务文件，不 amend/rebase/force push，不推送应用 Git。

索引：README 记录数据表、八接口、运行、交互与恢复边界。

## 计时边界

- backend/timer 只认识 key、时钟和自己的 repo；禁止导入 event、森林、模板或备份。service/repo/timer 保存当前计时，表 timers(key,elapsed_ms,running_since_ms)，状态由起点是否 null 推导，不保存片段或全局活动槽。
- writetimer 接收 {key,state}，state=running/paused/reset；不存在的 key 写入即创建。readtimer 接收 key 数组，缺失返回 null，读取不创建记录。重复 running 不重置起点，重复 paused 不重复累计；reset 清零并暂停。
- 前端统一 String(event.system.source_id) 作为 key，禁止使用 version_id。实时显示本地 performance.now 推算，不轮询、不推送；操作和刷新时以后端返回校准。
- 小事内联运行、暂停、继续只写 timer，不移动区域、不改 event。结束由前端暂停，向最新完整 event 累加耗时属性，成功后 reset。写 event 失败保留暂停耗时。移动区域使用单独的“移入运行”。
- timer 不因页面关闭、切换、移动或删除自动暂停，不自动超时。timer 只存本地 SQLite，禁止进入备份仓库；恢复 event 不恢复计时。
