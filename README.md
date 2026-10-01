# Compound

小事（event）保存正文、标签和完整版本；标签森林保存查询与展示结构；闭环模板保存小事草稿数组。前端决定业务变化，后端只校验、写入、读取。HTTP 使用 aiohttp 单线程事件循环，数据库操作同步串行；独立线程异步备份 event。

## 概念与目录

- `backend/event_kernel`：正式 event 协议校验与 write/read，无持久状态。
- `backend/tags_forest/workspace.py`：当前森林与当前事项模板选择；`item_template.py`：命名的事项森林。纯森林节点只有 tag、children。
- `backend/loop_template`：同名小事草稿数组的校验与 write/read。
- `backend/timer`：不透明 key 的计时规则与 write/read，不认识 event；`service/repo/timer` 保存自己的当前记录。
- `backend/api`：八个接口的装配、分发与森林同步提交。不理解移动、运行、归档或模板实例化。
- `service/repo/events`：event 版本、标签、版本身份；workspace、item_template、loop_template 各自目录拥有本地完整记录存取，共用 SQLite。
- `service/backup`：只读取已提交 event，追加 JSONL 并提交 Git。
- `frontend`：原生 DOM、标签变化、森林编辑与批量查询；`tests` 保留真实 Chromium 全链路回归。

正式 event 的唯一格式权威是备份检出内 `protocol.yaml`。森林与草稿的结构协议分别在 `backend/tags_forest/protocol.yaml`、`backend/loop_template/protocol.yaml`；它们不进入备份仓库。森林标签格式复用 event 协议，不另发明正则。

## 数据库

`instance/<环境>/events.sqlite`，dev/prod 分开。

| 表 | 保存内容 |
| --- | --- |
| event_versions | version_id 主键、source_id、deleted、content |
| event_tags | version_id、kind、text，联合主键 |
| workspace_versions | version_id 主键、payload JSON：item_template_id、forest |
| item_template_versions | version_id 主键、稳定 id、deleted、payload JSON：name、forest |
| loop_template_versions | version_id 主键、稳定 id、deleted、payload JSON：events |
| backup_progress | 单条 event 备份进度 |
| timers | key 主键、elapsed_ms、running_since_ms；只保存当前值 |

event 与森林/模板修改追加完整版本；timer 是可重置的本地当前记录，直接更新。event 首版 source_id=version_id；模板首版 id=version_id。四类记录各自分配递增版本 ID，ID 只在所属概念内使用。工作空间只有一份，取最大版本；模板按稳定 ID 取最大版本，再排除 deleted。森林和草稿直接存 JSON，不建节点、边或成员关系表。

一次写请求一个 SQLite 事务。writeforest 中工作空间与事项模板同步双写，全部成功或全部回滚。不同 HTTP 请求之间没有共同事务；标签改名先写 event，再写森林，第二步失败会明确显示错误，需要重新提交森林。当前模板必须存在且未删除，删除当前模板必须在同一 writeforest 中切换或清空选择。

## 八个接口

全部 POST，成功返回 JSON/200，输入错误返回 `{"error":"说明"}`/400。只保留以下接口，不保留旧 /write、/read。

| 接口 | 输入 | 输出 |
| --- | --- | --- |
| /writeevent | 完整 event 输入数组，不含 version_id；新增 source_id=null | 对应 `{version_id,source_id}` 数组 |
| /readevent | 标签集合数组；`[[]]` 查询全部 | 对应 event 集合数组 |
| /writeforest | 可选 workspace 完整记录、item_templates 完整记录数组，至少一个字段 | 本次写入版本身份 |
| /readforest | workspace:true；item_templates:null 或 ID 数组，字段可省略 | 请求的当前记录；未保存 workspace 为 null |
| /writelooptemplate | 完整模板记录数组 | 对应 `{id,version_id}` 数组 |
| /readlooptemplate | null 查询全部，或 ID 数组 | 最新有效模板数组，按 id 升序 |
| /writetimer | `{key,state}`，state=running/paused/reset | `{key,state,elapsed_ms}`，reset 返回 paused/0 |
| /readtimer | 非空字符串 key 的数组 | 对应计时结果数组，缺失位置 null |

writeevent 示例：

```json
[{"system":{"source_id":null,"deleted":false},"user":{"event":""},"meta":[{"kind":"业务区域","text":"待办"}]}]
```

查询先取同源最新 event，再排除删除，再匹配标签子集；匹配完整 kind/text，不做字符串前缀匹配。输出按 version_id 降序。

writeforest 同步提交示例：

```json
{
  "workspace": {"item_template_id":3,"forest":[]},
  "item_templates": [{"id":3,"deleted":false,"name":"学习","forest":[]}]
}
```

forest 是节点数组，节点固定为 `{"tag":{"kind":"复利事项","text":"学习"},"children":[]}`。数组顺序是显示顺序。事项模板只能包含复利事项标签。模板新增 id=null；修改和删除携带稳定 ID，始终提交完整内容。写入不接收 version_id。

闭环模板示例：

```json
[{"id":null,"deleted":false,"events":[{"system":{"version_id":null,"source_id":null,"deleted":false},"user":{"event":"阅读十页"},"meta":[{"kind":"闭环","text":"每日阅读"}]}]}]
```

数组至少一条，正文允许为空；每条仅一个相同的闭环名称标签，没有独立模板名称。使用时前端生成新 UUID，替换为正式 `闭环#UUID|名称`，补上业务区域，再 batch writeevent。

## 运行

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$env:PYTHONIOENCODING = 'utf-8'
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m backend
```

默认 dev `http://127.0.0.1:19080`；prod `--env prod`，端口 19081。测试可传 --db、--repo、--port。DATA/compound-log/main、dev、prod 是同一备份 Git 的三个检出；无 origin 时本地提交，配置后推送对应环境分支。

## 备份边界

**备份仓库只接收正式 event 日志及其协议。禁止写入工作空间、事项模板、闭环模板、视图、计时、请求计划或 SQLite。** 仓库 README/AGENTS 仅记录这一契约。

三份记忆和 timer 只存本地 SQLite。丢弃数据库会丢失森林和模板；event 从 logs.jsonl 恢复。备份失败不阻断本地写入；启动核对日志已追加位置，避免重复。不完整行明确报错，不改写日志。

停服后恢复到空数据库：

```powershell
.venv/Scripts/python.exe -m backend --env dev --restore --db instance/recovered.sqlite
```

## 前端第四闭环

原生 DOM，两栏布局：左侧事项视图、结果树、搜索和投入回顾；右侧运行、待办、归档。1050px 以下上下排列。参考旧项目 DOM/CSS 重建，不使用旧 JS 业务逻辑；本轮没有拖拽、语音、日期选择、设置和历史入口。

```text
frontend/
├─ kernel/    event、tags_forest、loop_template
├─ shell/     input、commands、projection、workspace
├─ timer/     独立计时
└─ main.js    装配与启动
```

- event 管完整版本及标签变更；tags_forest 管森林与事项视图；loop_template 管小事草稿数组。各自公开 read/write，直接对应已有后端接口。
- input 把点击、表单和选择转换为明确命令调用；commands 协调各概念修改，不认识 DOM 或投影。
- projection.read 读取森林，生成节点路径的批量标签查询，将 event 挂在对应节点；父节点直接显示未匹配子节点的成员。右侧未显式登记的闭环按 event 标签生成展示组，不写回森林。同名不同 UUID 分开显示；结果区不推导闭环组，空正文事实不显示在列表中。
- 投影返回 `{areas,events,resultEvents,todayMs,views,currentView}`；节点包含 `{tag,path,tags,name,members,direct,children,review,loop}`。path 是森林索引路径，临时生成组为 null；members 是当前区域匹配成员，direct 是未挂在子节点的可见成员，review 是当前区域的投入成员。resultEvents 包含全部结果事实及事项路径标题，保留空正文供计时展示；todayMs 只汇总结果区当天已记录耗时。不返回 DOM、HTML、timer 或模板草稿。
- workspace.render 只渲染展示结构；弹窗、展开、搜索属于界面状态。timer 单独读快照并内联显示，不进入 projection。
- main 装配刷新能力：projection.read → timer.read → workspace.render。input 在命令成功后调用刷新，commands 与 projection 互不依赖。后端增加组合读取时只替换投影读取内部实现。

事项支持新增根/子事项、折叠、记录、改名、分支删除与投入回顾。新增视图创建空事项森林，切换不修改 event；事项结构改变同步更新当前事项模板。空节点刷新保留。改名批量替换成员标签，删除处理跨区域成员，移动小事只写 event。

待办支持新增小事、闭环及模板入口。闭环按 UUID 改名和删除；结果区没有新增闭环按钮。模板草稿可增删改，明确保存后才写入；实例化生成新闭环 UUID 并创建待办小事。模板弹窗沿用旧版深色标题栏、选择卡片、居中组名、右侧增改删图标和底部保存按钮；草稿小事采用单行显示与内联编辑。不采用浏览器 prompt。

小事支持正文、属性、评分、耗时编辑及软删除。属性在录入框折叠区每行一条，服务端按协议校验；编辑保留其他标签。正文允许为空。新建默认登记当天日期，不提供日期选择控件；有显式日期属性时保留。新建可选择评分或不评分。保存期间禁用修改，失败显示错误并保留输入；不采用乐观更新、浏览器业务存储或请求队列。

事实与计时命令只有 `writeEvent(sourceId, changes, timerState?)`、`writeTimer(sourceId, state)`，不识别按钮名或左右界面。changes 使用正文、完整标签、删除标记及待结算 elapsedMs；sourceId 为 null 时创建。可在事实保存后启动计时或 reset；reset 结算时若未提供快照，命令先暂停计时器再累加耗时。森林和模板保留自己的修改命令，版本与森林调整规则留在所属概念。不使用通用 execute、事件总线或框架。构建输出沿用 app.js/style.css，后端静态路径不变；请修改概念源码，不直接改生成文件。

```powershell
npm ci
npm run build
```

构建只使用 esbuild，无前端框架；构建产物随代码提交。后端冻结标签 backend-v0.3.0-frozen；第四闭环开发前完整基线 frontend-v0.3.0-frozen。

## 验证

```powershell
.venv/Scripts/python.exe -m pytest -q
npm ci
npm run test:e2e
```

测试使用临时 Git/SQLite，浏览器独立端口 19884，可用 COMPOUND_TEST_PORT 指定其他空闲端口，不复用服务。首次安装浏览器：npx playwright install chromium。截图与 trace 在忽略的 test-results 中。

基线覆盖 event 全量版本、最新优先筛选、标签集合、批量回滚、并发 ID、浏览器空连接、备份重试/重启/恢复；新增森林同步双写回滚、模板版本删除、格式约束、八接口及本地记忆不进入备份。真实浏览器覆盖小事 CRUD/评分耗时、两个独立计时器、嵌套事项与视图隔离、闭环同名隔离与跨区域删除、模板编辑及重复实例化、写失败保留输入和耗时，检查桌面与390px布局、控制台及八个接口约束。E2E 启动前自动构建。

当前维护33项 pytest 和10条 Chromium 完整流程，保留桌面、390px、闭环与模板截图。浏览器额外验证结果空正文计时、结束录入与评分覆盖、耗时卡片及自定义、左右隔离、返回待办、计时失败重试及事实操作不写森林。不保留过期交互基线。

## 内联计时

`writetimer` 例：`{"key":"3","state":"running"}`；`readtimer` 例：`["3","7"]`。key 是非空字符串，不解析业务身份；写入即创建，读取缺失返回 null。running 开始/继续，paused 暂停累计，reset 清零并暂停，重复开始或暂停不重复计时。各 key 独立，不限制唯一运行计时器。

运行时的实际耗时 = elapsed_ms + 当前时间 - running_since_ms。没有后台计时任务、时间片段或每秒数据库写入。运行状态在页面关闭和服务重启后继续；暂停状态冻结。计时数据绝不进入备份仓库。

前端用稳定 source_id 的字符串作为 key；各事实独立计时，不暂停其他事实。展示只按业务区域决定：结果事实的计时条显示在上方，运行事实的计时显示在行内，待办和归档不显示计时。事项标签不把右侧计时带入结果区。暂停、继续只写 timer，不改 event 或森林。

结果事项的开始计时直接创建空正文、未评分、耗时0秒的结果事实并启动 timer，不弹录入框，不移入右侧。已有结果事实开始计时只写 timer。结束先暂停，统一弹窗复制原正文供编辑，再选评分；保存同源完整新版本，覆盖评分并累加原耗时与计时耗时，成功后 reset。空正文和非空正文使用同一流程。直接记录一条提供1/3/5/10/15/20/30分钟耗时卡片及自定义输入，再选评分。

右侧待办和归档的移入运行先改 event 区域再启动 timer。运行行保留计时、归档、返回待办、编辑和删除；返回待办位于归档和编辑之间，只改 event 区域。归档结算计时并改区域，评分及其他标签保留。区域移动只写 event，不改森林。

本地 performance.now 根据快照推算跳秒，只更新文字，不轮询。刷新和命令完成时读取 timer 校准；event 版本变化不换绑。投影不包含计时。

结算统一为 writetimer paused → 向最新完整 event 累加耗时并 writeevent → writetimer reset。写 event 失败保留输入与暂停耗时；reset 失败明确提示事实已保存，不能重复结算。三个请求不是共同事务，没有自动恢复队列。
