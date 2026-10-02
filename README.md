# Compound

iPhone、Apple Watch 与表盘复杂功能的架构、真机流程和踩坑记录见 [Apple 生态开发指南](docs/apple-ecosystem-guide.md)。

日常设备访问地址、dev/prod 登录密码文件入口及公网部署状态见 [访问与登录备忘](docs/access-memo.md)。

桌面快捷入口使用 Electron，共用现有前端组件与读写能力。运行入口展示结果计时条和运行事实，待办入口保留新增、模板、闭环按钮；窗口、托盘及全局快捷键归 desktop，展示布局归 workspace/presentation。启动与验证见 [desktop/README.md](desktop/README.md)。

小事（event）保存正文、标签和完整版本；标签森林保存查询与展示结构；闭环模板保存小事草稿数组。前端决定业务变化，后端只校验、写入、读取。HTTP 使用 aiohttp 单线程事件循环，数据库操作同步串行；独立线程异步备份 event。

## 概念与目录

- `backend/event_kernel`：正式 event 协议校验与 write/read，无持久状态。
- `backend/tags_forest/workspace.py`：当前森林与当前事项模板选择；`item_template.py`：命名的事项森林。森林节点保存 tag、children 和 is_fold 折叠状态。
- `backend/loop_template`：同名小事草稿数组的校验与 write/read。
- `backend/timer`：不透明 key 的计时规则与 write/read，不认识 event；`service/repo/timer` 保存自己的当前记录。
- `backend/api`：十个接口的装配、分发与森林同步提交。不理解移动、运行、归档或模板实例化。
- `service/repo/events`：event 版本、标签、版本身份；workspace、item_template、loop_template 各自目录拥有本地完整记录存取，共用 SQLite。
- `service/backup`：只读取已提交 event，追加 JSONL 并提交 Git。
- `frontend`：原生 DOM、标签变化、森林编辑与批量查询；`tests` 保留真实 Chromium 全链路回归。

正式 event 的唯一格式权威是备份检出内 `protocol.yaml`。森林与草稿的结构协议分别在 `backend/tags_forest/protocol.yaml`、`backend/loop_template/protocol.yaml`；它们不进入备份仓库。森林标签格式复用 event 协议，不另发明正则。

## 数据库

区域切片：`backend/slice` 只拥有有序名称数组，`service/repo/slice` 在 `slices` 表中保存固定单行 JSON，不保存成员、ID 或历史版本。数组属于本地应用数据，不进入事实备份。正式 event 可带零或一个 `区域切片` 标签，业务区域仍为四选一；标签名称不依赖切片数组校验。

切片名称非空、无首尾空白或换行、不可重复，固定默认名称“小事”不写入数组。

`instance/<环境>/events.sqlite`，dev/prod 分开。

| 表 | 保存内容 |
| --- | --- |
| event_versions | version_id 主键、source_id、deleted、content |
| event_tags | version_id、kind、text，联合主键 |
| workspace_versions | version_id 主键、payload JSON：item_template_id、forest |
| item_template_versions | version_id 主键、稳定 id、deleted、payload JSON：name、forest |
| loop_template_versions | version_id 主键、稳定 id、deleted、payload JSON：events |
| backup_progress | 单条 event 备份进度 |
| slices | 固定单行、payload JSON 名称数组，整体替换 |
| timers | key 主键、elapsed_ms、running_since_ms；只保存当前值 |

event 与森林/模板修改追加完整版本；timer 是可重置的本地当前记录，直接更新。event 首版 source_id=version_id；模板首版 id=version_id。四类记录各自分配递增版本 ID，ID 只在所属概念内使用。工作空间只有一份，取最大版本；模板按稳定 ID 取最大版本，再排除 deleted。森林和草稿直接存 JSON，不建节点、边或成员关系表。

一次写请求一个 SQLite 事务。writeforest 中工作空间与事项模板同步双写，全部成功或全部回滚。不同 HTTP 请求之间没有共同事务；标签改名先写 event，再写森林，第二步失败会明确显示错误，需要重新提交森林。当前模板必须存在且未删除，删除当前模板必须在同一 writeforest 中切换或清空选择。

## 十个接口

十个业务接口全部 POST，成功返回 JSON/200，输入错误返回 `{"error":"说明"}`/400。业务接口固定如下，不保留旧 /write、/read；独立语音连接入口见“语音录入”。

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
| /readslice | null | 有序切片名称数组，未保存为 [] |
| /writeslice | 完整名称数组 | 校验并事务替换后的名称数组 |

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

forest 是节点数组，节点固定为 `{"tag":{"kind":"复利事项","text":"学习"},"is_fold":false,"children":[]}`。数组顺序是显示顺序。事项模板只能包含复利事项标签。模板新增 id=null；修改和删除携带稳定 ID，始终提交完整内容。写入不接收 version_id。

森林节点的 `is_fold` 保存折叠状态，历史缺失按 false 读取。事项折叠同步当前事项模板；改名、移动和排序保留节点状态。推导闭环首次折叠时按当前同级闭环顺序登记森林节点，各区域独立。折叠沿用 writeforest 完整版本，保存成功后刷新，失败保留原状态并提示；不写 event 或 timer。

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

森林、模板、切片数组和 timer 只存本地 SQLite。丢弃数据库会丢失森林和模板；event 从 logs.jsonl 恢复。备份失败不阻断本地写入；启动核对日志已追加位置，避免重复。不完整行明确报错，不改写日志。

停服后恢复到空数据库：

```powershell
.venv/Scripts/python.exe -m backend --env dev --restore --db instance/recovered.sqlite
```

## 前端第四闭环

原生 DOM，两栏布局：左侧事项视图、结果树、搜索和投入回顾；右侧运行、待办、归档。1050px 以下上下排列。参考旧项目 DOM/CSS 重建，不使用旧 JS 业务逻辑；支持下述限定拖拽和结果/归档日期范围查询；没有历史入口。

```text
frontend/
├─ kernel/    event、tags_forest、loop_template、slice
├─ shell/     input、commands、projection、workspace
├─ timer/     独立计时
└─ main.js    装配与启动
```

- event 管完整版本及标签变更；tags_forest 管森林与事项视图；loop_template 管小事草稿数组。各自公开 read/write，直接对应已有后端接口。
- input 把点击、表单和选择转换为明确命令调用；commands 协调各概念修改，不认识 DOM 或投影。
- projection.read 读取森林与切片数组，生成节点路径的批量标签查询，将 event 挂在对应节点；父节点直接显示未匹配子节点的成员。右侧未显式登记的闭环按 event 标签生成展示组，不写回森林。同名不同 UUID 分开显示；结果区不推导闭环组，空正文事实不显示在列表中。
- 投影返回 `{areas,events,resultEvents,views,currentView,slicePanels,missingSlices}`；节点包含 `{tag,is_fold,path,tags,name,members,direct,children,review,totals,loop}`。path 是森林索引路径，临时生成组为 null；members 是当前区域匹配成员，direct 是未挂在子节点的可见成员，review 是当前区域的投入成员。resultEvents 包含当前日期范围的结果事实及事项路径标题，保留空正文供计时展示；totals 包含成员总耗时 elapsedMs 和总评分 score。不返回 DOM、HTML、timer 或模板草稿。
- workspace.render 只渲染展示结构；弹窗与搜索属于界面状态；展开按森林节点的 is_fold 恢复，交互提交森林修改。timer 单独读快照并内联显示，不进入 projection。
- `workspace/component` 收纳纯 DOM 组件：button/icons 统一图标与按钮，event_row 统一正式事实与模板草稿条，loop_group 统一各区域及模板的闭环容器。组件只接收展示值、DOM 插槽及回调，不读取 kernel、timer 或接口。外显计时条保持独立。
- `component/capture` 拥有正文、耗时、评分三张卡片及本次草稿，按传入 steps 选择性展示，结束后回调普通数据。workspace 将录入结果转换为完整正文/标签；input 决定入口组合，commands 负责写入。录入时可自动收音，识别全文与键盘尾部各自保存，确认时合并；正文始终可键盘输入。
- main 装配刷新能力：projection.read → timer.read → workspace.render。input 在命令成功后调用刷新，commands 与 projection 互不依赖。后端增加组合读取时只替换投影读取内部实现。

事项支持新增根/子事项、折叠、记录、改名、分支删除与投入回顾。新增视图创建空事项森林，切换不修改 event；事项结构改变同步更新当前事项模板。空节点刷新保留。改名批量替换成员标签，删除处理跨区域成员，移动小事只写 event。

待办支持新增小事、闭环及模板入口。闭环按 UUID 改名和删除；结果区没有新增闭环按钮。模板草稿可增删改，组内加号复用正文录入卡片，确认后添加草稿，取消不留空条目；明确保存后才写入；实例化生成新闭环 UUID 并创建待办小事。模板弹窗保留深色标题栏和选择卡片，闭环与草稿复用页面组件。不采用浏览器 prompt。

事实条上下内边距为0.2个正文字号，右侧依次为实时计时、垂直居中的耗时与评分小字、操作按钮。事项节点标题行高24px、节点间距为1/2px；非根事项标题字号14px，根事项保留各屏字号；手机标题操作保留28px点按高度。零耗时、缺失评分隐藏，不留占位或分隔符。六个操作位置固定为播放/暂停、归档、返回待办、恢复运行、修改、删除，只显示当前可用操作；模板只显示修改和删除。图标不带边框和填充，删除使用减号，返回与恢复使用镜像箭头。耗时和评分通过编辑修改，不再作为条目按钮。

闭环轮廓为尖角矩形主体与左上斜边页签，页签宽度随名称、数量和操作自然变化，保留下方细分隔线。UUID 映射固定色相，同源闭环跨区域、改名或刷新保持同色，不新增字段。区域容器、彩色闭环、较深事实轮廓区分层次。待办与模板显示新增、改名、删除三个图标，运行与归档隐藏它们。整个标题区域点击或按 Enter/Space 折叠，操作按钮独立响应；折叠以页签加深表达，不显示箭头。

小事支持正文、属性、评分、耗时编辑及软删除。属性在录入框折叠区每行一条，服务端按协议校验；编辑保留其他标签。正文允许为空。待办区域新增只录入正文，不显示评分步骤或写入评分；新建默认登记当天日期，不提供日期选择控件；有显式日期属性时保留。保存期间禁用修改，失败显示错误并保留输入；不采用乐观更新、浏览器业务存储或请求队列。

单条事实与计时使用 `writeEvent(sourceId, changes, timerState?)`、`writeTimer(sourceId, state)`，批量标签修改使用 `writeEventTags(sourceIds, replacements, slice?)`，不识别按钮名或左右界面。changes 使用正文、完整标签、删除标记、可选 slice 及待结算 elapsedMs；sourceId 为 null 时创建。可在事实保存后启动计时或 reset；reset 结算时若未提供快照，命令先暂停计时器再累加耗时。森林和模板保留自己的修改命令，版本与森林调整规则留在所属概念。不使用通用 execute、事件总线或框架。构建输出沿用 app.js/style.css，后端静态路径不变；请修改概念源码，不直接改生成文件。

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

基线覆盖 event 全量版本、最新优先筛选、标签集合、批量回滚、并发 ID、浏览器空连接、备份重试/重启/恢复；新增森林同步双写回滚、模板版本删除、格式约束、十接口及本地记忆不进入备份。真实浏览器覆盖小事 CRUD/评分耗时、计时切换与暂停、嵌套事项与视图隔离、闭环同名隔离与跨区域删除、模板编辑及重复实例化、写失败保留输入和耗时，检查桌面与390px布局、控制台及十个接口约束。E2E 启动前自动构建。

常规回归包含 Python、Chromium/Electron 完整流程和显式启用的真实语音流程，保留桌面、390px、闭环、模板及三张录入卡片截图。浏览器验证结果空正文计时、结束录入与评分覆盖、耗时卡片及自定义、左右隔离、返回待办、计时失败重试及事实操作不写森林；组件回归检查按钮顺序、无框样式、标题折叠、稳定配色、模板复用及窄屏。录入回归覆盖三卡顺序、取消、快速运行与归档评分覆盖。不保留过期交互基线。

## 网页区域切片

`kernel/slice` 读写名称数组；`commands/slices` 协调改名、删除时的小事标签全量更新；`projection/slices` 在原投影末尾按标签生成 `slicePanels`，不修改原 `areas` 或持久森林。手机、桌面快捷入口和手表沿用基础区域全集。

完整网页版默认“小事”在首位，只有新增按钮；自定义面板支持改名、删除、在右侧新增，结果区宽度按视口分配、上限 840px；小事面板按数组顺序在宽屏固定两列铺满右侧，较窄桌面使用单列，各列纵向独立紧凑排列，内容与窗口变化由 workspace 重新测量高度。每个面板复用运行、待办、归档与闭环组件。空切片保留；缺失名称的小事在默认面板展示并提示，新增同名切片即可归位。所有归档面板共用日期范围。

`slice` 未传保留标签、字符串设置唯一 `区域切片` 标签、null 清除。新增待办、快速运行、模板实例化带目标切片；自定义切片新增闭环需同时确认首条小事，取消不落库。跨切片拖小事或闭环组只改当前展示成员的标签，不改状态、计时或森林；标题接收全部右侧状态，状态区或闭环标题仅接收同状态。默认面板清除标签。

切片改名、删除先更新全部有效关联事实（含结果、历史日期），再保存数组；两次请求非原子，后一步失败明确提示并保留输入供重试。闭环删除限定当前切片与业务状态，其他切片还有成员时保留森林节点；UUID 改名仍全局生效。折叠与排序沿用原森林，相同闭环跨切片共享，排序保留基础区域完整闭环顺序。

2026-10-03 切片验证：68 项 pytest、7 项 JavaScript 测试通过；完整 Chromium/Electron 回归38项通过、6项收费语音或真实公网测试按开关跳过；最后调整另通过8条针对性回归与缺失切片专项。WebKit手机流程与切片布局2项通过。宽屏、较窄桌面与390px截图已检查。

独立 worktree 验证设置 `COMPOUND_TEST_PROTOCOL` 指向事实协议 worktree，设置 `COMPOUND_TEST_PORT`、`COMPOUND_TEST_MOBILE_PORT` 为独立空闲端口；测试数据库和日志由夹具临时创建。区域切片 E2E 见 `tests/browser/slices.spec.js`。

## 日期范围与事项汇总

结果、归档标题旁复用 `workspace/component/date_range` 选择器：今天、本周、本月、本季度、全部，默认今天。两处选择独立，仅在当前页面记忆，不写 event 或森林。范围按本地日历计算，本周从周一开始，月和季度包含完整自然周期。

projection 将范围内每一天追加为原查询集合的单个日期标签，一次 batch readevent 后按 source_id 合并；全部不追加日期。无日期事实仅出现在全部中。日期查询使用正式日期标签，不增加后端接口。事项统计按钮左侧显示当前查询成员的总耗时与评分之和，包含子事项成员且单个事实只计一次；未评分计0。结果投入回顾、标题汇总及结果计时条使用同一日期范围，计时器自身状态不受筛选影响。

## 拖拽边界

- 结果事项标题中央是子节点落点，选中变紫；上下边缘是兄弟落点，显示紫线。移动整棵子树，先批量追加结果区域成员完整版本，再保存森林并同步当前事项视图。仅调整兄弟顺序也追加成员版本；空分支只写森林。禁止落到自己及后代。
- 结果事实只可拖到其他事项标题，不记事实顺序。只替换事项归属，不写森林；当前事项不是有效落点。
- 右侧事实可在同一区域内拖到另一闭环标题，替换闭环标签。闭环标题上下拖动只保存该区域的闭环顺序；投影推导的组排序后登记为森林标签，不建立成员表。右侧区域之间不可拖动。
- 唯一跨栏落点是归档事实或归档闭环标题投送到结果事项。单条或当前归档组批量替换区域及事项标签，保留闭环、属性和稳定身份；待办及运行中相同 UUID 的成员不受影响。结果事实正文旁显示闭环名称徽标，不显示 UUID，不生成闭环组。删除闭环只删除当前业务区域中带该闭环标签的事实，并移除该区域的显式森林节点；其他区域的同标签事实保留。
- `input/drag.js` 拥有临时拖拽手势和有效落点；commands 协调写入，tags_forest 拥有树移动与顺序规则；projection 提供成员及闭环顺序，workspace 只渲染拖拽提示。普通事实移动不修改森林，计时器不参与拖拽。保存失败明确报错，跨请求不保证共同事务。

浏览器套件通过真实鼠标覆盖子树迁移、兄弟排序、空分支、后代拒绝、事实移动、闭环排序、跨栏禁止、归档单条与整组投送、标签保留及写入失败。区域外框4px，使用与淡紫背景协调的半透明镜片渐变：运行紫青折光与柔光、待办中性烟灰、归档暖玫瑰；闭环轮廓2.5px，保留事实条自己的细边框。

## 内联计时

`writetimer` 例：`{"key":"3","state":"running"}`；`readtimer` 例：`["3","7"]`。key 是非空字符串，不解析业务身份；写入即创建，读取缺失返回 null。running 开始/继续，paused 暂停累计，reset 清零并暂停，重复开始或暂停不重复计时。各 key 的计时状态独立保存。

运行时的实际耗时 = elapsed_ms + 当前时间 - running_since_ms。没有后台计时任务、时间片段或每秒数据库写入。运行状态在页面关闭和服务重启后继续；暂停状态冻结。计时数据绝不进入备份仓库。

前端用稳定 source_id 的字符串作为 key；开始或继续一个计时器时，先读取所有当前事实的计时状态，逐个暂停其他正在运行的计时器，再启动目标计时器。点击暂停只暂停当前计时器。展示只按业务区域决定：结果事实的计时条显示在上方，运行事实的计时显示在行内，待办和归档不显示计时。事项标签不把右侧计时带入结果区。暂停、继续只写 timer，不改 event 或森林。

结果事项按钮按开始计时、记录一条排列，隐藏记录按钮不挤开播放图标。开始计时直接创建空正文、未评分、耗时0秒的结果事实并启动 timer，不弹录入框，不移入右侧。已有结果事实开始计时只写 timer。结束先暂停，正文卡片复制原内容供编辑，再显示评分卡片；保存同源完整新版本，覆盖评分并累加原耗时与计时耗时，成功后 reset。空正文和非空正文使用同一流程。

结果事项的“记录一条”依次显示正文、耗时、评分卡片；正文卡片保留炫彩麦克风装饰、可输入文字框、保存及右上关闭。耗时卡片提供1/3/5/10/15/20/30分钟与自定义输入，选定即切换评分卡片。待办区域新增和待办闭环组新增都只显示正文卡片，确认后直接创建待办事实。快速运行只显示正文卡片，保存后创建运行事实并开始计时。编辑只显示正文卡片，保留属性折叠编辑。

右侧待办以第一位置的播放图标开始计时，归档以恢复运行图标开始计时；已有事实先启动 timer，再写 event 区域。运行行保留计时、归档、返回待办、编辑和删除；返回待办位于归档和编辑之间，只改 event 区域。归档先暂停并只显示评分卡片，确认后覆盖评分、累加耗时并改区域，保留正文和其他标签，成功后 reset。不评分会清除旧评分。关闭结束/归档卡片保留暂停计时，不写事实；新建卡片关闭则丢弃本次草稿。区域移动只写 event，不改森林。

本地 performance.now 根据最近的服务端快照推算跳秒，每 250 毫秒只更新文字。前端每秒重新读取事实与计时状态，内容或计时状态变化时才重画；录入弹窗和输入期间延后重画，保留草稿。命令完成后立即刷新，event 版本变化不换绑。投影不包含计时。

结算统一为 writetimer paused → 向最新完整 event 累加耗时并 writeevent → writetimer reset。写 event 失败保留输入与暂停耗时；reset 失败明确提示事实已保存，不能重复结算。三个请求不是共同事务，没有自动恢复队列。

## 语音录入

`service/speech` 只拥有临时音频连接和转录：websocket.py 接收16kHz单声道PCM，拥有全文、停止与连接释放，tencent.py 处理腾讯鉴权和识别协议。不读写 event、森林、timer、数据库或备份。API 在入口装配配置，关闭应用时释放连接。

已有十个业务接口保持不变。`GET /speech/config` 只返回 configured，`GET /speech/stream` 升级 WebSocket。access 在升级前校验公网会话与 Origin，首条 `{type:"authorize",csrf}` 消息再次校验会话，成功返回 authorized；之后才启动 speech。凭据不进入 URL。音频是16kHz、16bit、小端单声道PCM二进制块；文本 stop 表示尾包已发送、等待识别结束。服务返回 ready、transcript 全文、completed 最终全文、error。取消关闭连接。旧 offer、ICE、WebRTC 实现及依赖已删除。完整消息规则见 [speech 协议](service/speech/README.md)。

`frontend/plugin/speech` 提供 start/stop/cancel，回调 onText/onState/onComplete/onError；只感知音频、转录与连接。audio.js 与 processor.js 使用一个 AudioContext/AudioWorklet，按真实采样率转换并输出80ms PCM块，停止等待尾包；超过2秒发送积压则报错并保留草稿。silence.js 复用该上下文检测发声与停顿：发声后静音1.5秒进入1秒倒计时，再停止收音。main 装配给 workspace；capture 拥有独立的识别全文和键盘文本，不让识别刷新覆盖键盘草稿。新建及结束录入自动收音，编辑现有事实保持键盘输入。Enter立即确认，Shift+Enter换行，输入法选字Enter不确认。保存与自动停顿走同一确认路径，等待最终全文再进入原有卡片序列；关闭释放麦克风，错误保留草稿。

复制 `.env.example` 为忽略的 `.env`，填写腾讯凭据；仅后端入口加载，不发送给浏览器，不写日志或Git。环境变量优先。没有配置时仍可键盘输入。

语音工作树预览使用独立端口与独立仓库/数据库；不连接19080数据库。自动测试仍使用临时Git/SQLite。常规 `npm run test:e2e` 不调用腾讯，包含混合输入、取消、输入法确认与故障测试；真实验收显式启用：

```powershell
$env:COMPOUND_TEST_PORT = '19888'
$env:COMPOUND_TEST_SPEECH = '1'
npm run build
npx playwright test tests/browser/speech-live.spec.js
Remove-Item Env:COMPOUND_TEST_SPEECH
```

真实测试使用仓库内的合成语音WAV（来自旧版测试夹具），经过实际浏览器AudioWorklet、WebSocket与腾讯识别，验证停顿确认、全文与键盘合并及待办事实保存，保留桌面和390px截图。可通过 COMPOUND_SPEECH_AUDIO 指定另一份测试WAV；不开启上述开关不调用收费服务。

## iPhone 网页入口

Mac 上接手原生 iPhone 薄壳与 Apple Watch 开发，先读 [Apple 开发交接](docs/apple-handoff.md)：已完成状态、概念边界、Xcode 准备、设备会话及 WebSocket 语音验收边界。

手机专属布局归 `frontend/shell/workspace/mobile`，650px 及以下自动启用，也可用 `?presentation=mobile` 固定启用。结果、运行、待办、归档单区切换，共用事实条、闭环组、模板和录入卡片；按钮不依赖悬停，输入字号与安全区适配 iPhone。回到前台重新读取，打开草稿或保存期间不刷新覆盖输入。没有手机数据库、离线队列或新业务接口。

当前 dev 公网地址：`https://songring.nat100.top/compound/dev/?presentation=mobile`。由 public_gateway 的现有 NATAPP 隧道转发到本机19080；prod 公网地址为 `https://songring.nat100.top/compound/prod/`，转发到本机19081。工具坞与手动入口统一端口，每个环境只有 Compound 服务与 Electron 两个单体。首次启动生成忽略的 `instance/dev/access.json`（密码哈希与会话签名密钥）及 `initial-password.txt`；私下从后者读取密码。配置独立于事实 Git，不复制其他应用密码或隧道凭据。服务器监听回环地址，本机可直接使用；带网关转发身份的请求需要登录。

`backend/access` 拥有公网会话与认证，`frontend/access` 拥有登录及相对路径请求。新增的访问接口只有 GET `/access/session`、POST `/access/login`（`{password}`）、POST `/access/logout`。登录 Cookie 为 HttpOnly、Secure（HTTPS）、SameSite=Strict，按环境路径隔离，有效期七天；公网 HTTP 写入携带会话的 X-CSRF-Token；语音 WebSocket 在首条消息校验同一会话令牌。业务内核不感知访问身份。网关剥离路径前缀并重写转发头，页面资源与请求相对当前应用目录解析。

Safari 打开上述地址登录即可使用；需要主屏幕入口时在分享菜单选择“添加到主屏幕”。`apple/` 提供 SwiftUI + WKWebView 的原生 iPhone 薄壳和原生 Watch 应用；iPhone 可切换 dev/prod，两个环境密码只保存在本机 Keychain。Watch 经 iPhone 获得环境受限令牌后直连后端，展示运行/待办并执行窄动作；待办页支持系统听写新建、模板实例化及确认删除，不保存密码或自行解释标签规则。语音的 iPhone 权限及公网 WSS 实机效果单独验收，浏览器自动化不替代真实手机。

手机完整 E2E 使用临时 Git/SQLite，端口19934/19935，通过真实 public_gateway 代码验证路径、登录、录入、暂停继续、归档、结果与退出；现有套件继续使用19884。需要同级 public_gateway 检出。验证命令：

```powershell
npm run test:e2e
npx playwright test tests/browser/mobile.spec.js --browser=webkit
$env:COMPOUND_PUBLIC_MOBILE = '1'
npx playwright test tests/browser/public-mobile.spec.js
Remove-Item Env:COMPOUND_PUBLIC_MOBILE
```

最后一项只读访问真实公网 dev/prod，分别验证手机和电脑布局、登录持久化与跨环境会话隔离；不写入测试事实，不记录含凭证的 trace。实际 iPhone Safari 仍需用户验收。

工具坞每环境保留 Compound + Electron，统一19080/19081，dev/prod 公网均已开放。两服务 PowerShell 验收（含手动入口接管）和公网 Chromium/WebKit 登录、环境隔离已通过；公网语音仍待验收。

2026-10-02 主分支合并验证：Python业务、认证、语音42项通过；Chromium/Electron完整E2E共27项通过（含森林折叠恢复、AudioWorklet录入及断线），6项按开关跳过（真实腾讯两项、真实公网四项）；16/44.1/48kHz PCM转换三项通过。语音分支此前已通过真实腾讯本地Web/Electron两项及WebKit手机、卡片三项。dev/prod 已重新启动，且本机与公网页面均返回 HTTP 200；公网 WSS 和真实 iPhone 音频尚待验收。

语音回归补充：`node --test tests/pcm.test.js` 覆盖16/44.1/48kHz跨帧转换与尾包，`tests/browser/speech-pcm.spec.js` 使用真实AudioWorklet和合成麦克风完成录入保存，识别服务消息由测试替身提供。Windows 的 Playwright WebKit 没有 Web Audio，音频处理测试明确跳过，不能代表 iPhone Safari。WebKit 的登录、卡片交互和失败保留草稿仍可回归。

独立 worktree 可设置 `COMPOUND_TEST_PROTOCOL` 为现有权威 protocol.yaml 的绝对路径，设置 `COMPOUND_TEST_ENV_FILE` 为既有本地 .env 路径供显式收费语音测试读取，无需复制凭据。并行验证可用 `COMPOUND_TEST_PORT` 与 `COMPOUND_TEST_MOBILE_PORT` 指定独立端口，手机上游使用手机端口加一。手机测试仍需同级 public_gateway 检出或目录链接。worktree 代码不自动更新正在运行的公网 dev；上线后仍需真实 iPhone 验收权限、采样、停顿及移动网络断线。

2026-10-02 Apple 验证：原生 iPhone 薄壳在 iOS 26.5 模拟器构建及3项导航测试通过，并在 iOS 26.6.1 的 iPhone 17 完成真机业务流程。WatchConnectivity 已在 Series 11 真机打通；运行/待办快照界面已构建并安装，Windows dev 服务已加载新前端，Watch 业务数据验收仍待完成。
