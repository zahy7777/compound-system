# Compound

小事（event）保存正文、标签和完整版本；标签森林保存查询与展示结构；闭环模板保存小事草稿数组。前端决定业务变化，后端只校验、写入、读取。HTTP 使用 aiohttp 单线程事件循环，数据库操作同步串行；独立线程异步备份 event。

## 概念与目录

- `backend/event_kernel`：正式 event 协议校验与 write/read，无持久状态。
- `backend/tags_forest/workspace.py`：当前森林与当前事项模板选择；`item_template.py`：命名的事项森林。纯森林节点只有 tag、children。
- `backend/loop_template`：同名小事草稿数组的校验与 write/read。
- `backend/api`：六个接口的装配、分发与森林同步提交。不理解移动、运行、归档或模板实例化。
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

所有修改追加完整版本。event 首版 source_id=version_id；模板首版 id=version_id。四类记录各自分配递增版本 ID，ID 只在所属概念内使用。工作空间只有一份，取最大版本；模板按稳定 ID 取最大版本，再排除 deleted。森林和草稿直接存 JSON，不建节点、边或成员关系表。

一次写请求一个 SQLite 事务。writeforest 中工作空间与事项模板同步双写，全部成功或全部回滚。不同 HTTP 请求之间没有共同事务；标签改名先写 event，再写森林，第二步失败会明确显示错误，需要重新提交森林。当前模板必须存在且未删除，删除当前模板必须在同一 writeforest 中切换或清空选择。

## 六个接口

全部 POST，成功返回 JSON/200，输入错误返回 `{"error":"说明"}`/400。只保留以下接口，不保留旧 /write、/read。

| 接口 | 输入 | 输出 |
| --- | --- | --- |
| /writeevent | 完整 event 输入数组，不含 version_id；新增 source_id=null | 对应 `{version_id,source_id}` 数组 |
| /readevent | 标签集合数组；`[[]]` 查询全部 | 对应 event 集合数组 |
| /writeforest | 可选 workspace 完整记录、item_templates 完整记录数组，至少一个字段 | 本次写入版本身份 |
| /readforest | workspace:true；item_templates:null 或 ID 数组，字段可省略 | 请求的当前记录；未保存 workspace 为 null |
| /writelooptemplate | 完整模板记录数组 | 对应 `{id,version_id}` 数组 |
| /readlooptemplate | null 查询全部，或 ID 数组 | 最新有效模板数组，按 id 升序 |

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

三份记忆只存本地 SQLite。丢弃数据库会丢失森林和模板；event 从 logs.jsonl 恢复。备份失败不阻断本地写入；启动核对日志已追加位置，避免重复。不完整行明确报错，不改写日志。

停服后恢复到空数据库：

```powershell
.venv/Scripts/python.exe -m backend --env dev --restore --db instance/recovered.sqlite
```

## 简陋 DOM 验证页

四区支持小事 CRUD、运行/归档、单条及整组原生拖拽、属性标签编辑。移动小事只写 event，不写森林。

事项支持新增子事项、上移/下移、提升、拖到另一事项形成嵌套。组内创建带完整事项路径标签；改变事项父节点时先重标成员 event，再保存森林。改名与删除更新完整 event，并保存森林；删除处理跨区域成员。

保存为新视图、切换、改名、删除视图。事项结构变化同步保存当前事项模板；区域和闭环结构变化只保存工作空间。切换视图不改 event。页面先 readforest，然后按每个节点路径构造 batch readevent，按节点结果挂载；父节点直接显示没有匹配子节点的 event，避免隐藏未分组内容。

空事项与空闭环随森林持久化，刷新保留。同名闭环按 UUID 区分。闭环模板支持页面内增删正文、改名、一键保存、删除、选择区域实例化；也能把已有闭环保存为模板。使用同一模板多次生成不同闭环 UUID。

所有弹窗使用页面 dialog，禁止 prompt/confirm/alert。保存期间禁用修改，失败显示错误并保留表单输入。无框架、构建工具、预测更新、操作队列或浏览器存储；无计时、语音、桌面端。

## 验证

```powershell
.venv/Scripts/python.exe -m pytest -q
npm install
npm run test:e2e
```

测试使用临时 Git/SQLite，浏览器独立端口 19884，可用 COMPOUND_TEST_PORT 指定其他空闲端口，不复用服务。首次安装浏览器：npx playwright install chromium。截图与 trace 在忽略的 test-results 中。

基线覆盖 event 全量版本、最新优先筛选、标签集合、批量回滚、并发 ID、浏览器空连接、备份重试/重启/恢复；新增森林同步双写回滚、模板版本删除、格式约束、六接口及本地记忆不进入备份。真实浏览器覆盖原有 CRUD/拖拽、嵌套树、视图切换与刷新、闭环模板编辑和重复实例化，检查桌面与 390px 布局及页面错误。

2026-10-02 验证：25 项 pytest、8 条真实 Chromium E2E 通过。dev 数据库及表已改为 event 命名，保留全部 11 个原有历史版本；迁移前一致备份保存在忽略目录 .run/dev/before-event-rename.sqlite。19080 服务已使用第二版。
