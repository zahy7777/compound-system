# Compound

第一版只提供完整事实追加和标签集合查询。事实操作由一个单线程 HTTPServer 顺序执行；SQLite 提交即保存完成，独立线程异步保全到 JSONL 和 Git。

## 职责

`backend/kernel` 校验输入并调用两个存取能力，无持久状态。`service/repo/facts` 拥有数据库、版本 ID 和标签查询。`service/backup` 读取已提交版本，负责进度、只追加日志和 Git。协议唯一来源是各环境备份检出内的 `protocol.yaml`，不复制业务正则。

每个版本都有版本 ID、源 ID及删除标记，源 ID是第一版版本 ID。同源最大版本表示当前状态；查询先选择最新版本，再排除删除，再匹配标签子集。修改和删除不会改写历史。ID 仅承诺在对应环境的唯一数据库内不重复，不合并独立数据库的历史。

## 运行

在项目根目录使用 PowerShell，显式 UTF-8：

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$env:PYTHONIOENCODING = 'utf-8'
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m backend
```

默认 dev 地址 `http://127.0.0.1:19080`；prod 使用 `--env prod`，端口 19081。数据库分别位于 `instance/<环境>/facts.sqlite`；备份位于 `C:/AI/PROJECT/DATA/compound-log/<环境>`。测试可显式传入 `--db`、`--repo`、`--port`，不接触运行环境。

备份 main/dev/prod 是同一 Git 仓库的检出，均收在 compound-log 下。无 origin 时只本地提交；配置 origin 后自动推送当前环境分支。main 保持协议及空初始日志，不写用户数据。备份失败输出日志并重试，SQLite 已保存内容继续可用。

## 接口

业务接口只有 `POST /write` 和 `POST /read`，单条也是数组。write 输入 `[{"system":{"source_id":null,"deleted":false},"user":{"event":""},"meta":[{"kind":"业务区域","text":"待办"}]}]`，返回身份数组；修改时指定源 ID 并提供完整版本。read 输入一批标签集合，例如 `[[{"kind":"业务区域","text":"待办"}],[]]`，返回对应集合；空集合查询全部当前有效事实。

第一版支持四个 kind：业务区域必填且唯一，复利事项可多个，闭环最多一个，属性可多个但同一意义唯一。属性均可缺失；未评分不当零分，未记录耗时不自动补零。

## 恢复与验证

停服后向**空数据库**恢复，保留原版本身份：

```powershell
.venv/Scripts/python.exe -m backend --env dev --restore --db instance/recovered.sqlite
.venv/Scripts/python.exe -m pytest -q
npm install
npm run test:e2e
```

仅已追加到 JSONL 的版本能够从备份恢复。备份启动核对文件与数据库；不完整行明确报错，不自动改写日志。应用代码、SQLite 和 WAL 不进备份仓库。

## 验证页面

四区使用原生 DOM 和浏览器拖拽。新建、编辑、删除小事；创建复利事项和闭环；组改名为成员批量追加版本，组删除软删除全部跨区域成员。运行只是替换业务区域，不启动计时。

拖到区域只修改区域；拖到闭环替换闭环标签并采用落点区域；拖到复利事项替换全部复利事项标签并进入结果。无闭环落点解除闭环。整组拖动只处理来源区域成员。其他标签和正文保持原样。

空复利事项和空闭环只在当前页面保留，刷新后消失；有成员的组从标签重建。同名复利事项是同一组，同名闭环由 UUID 分开。属性使用原始文本标签行编辑，格式由服务校验；新增评分不会抹掉耗时等其他标签。

修改统一构造完整版本，write 成功后 read 再重绘。保存期间禁用写操作；失败保留表单输入。不使用浏览器存储、业务记忆表、操作队列或预测状态。

E2E 使用临时 dev Git/SQLite，默认端口 19884（原定 19886 在本机被占用）。可设置 `COMPOUND_TEST_PORT` 为其他空闲隔离端口，绝不复用现有服务。首次缺少 Chromium 时运行 `npx playwright install chromium`。测试截图和 trace 位于忽略的 test-results，不进入应用 Git。

2026-10-01 首版验证：20 项 pytest 基线、5 条真实 Chromium 全链路通过；包含并发创建与同源修订、批量回滚、备份重启恢复及本地裸 Git 远端推送。已检查桌面与 390px 页面截图，无横向溢出；业务网络请求仅 write/read。测试没有写入运行 dev/prod，也没有修改旧 flywheel_log。
