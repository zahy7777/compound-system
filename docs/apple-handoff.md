# Mac 接手：iPhone 薄壳与 Apple Watch

交接日期：2026-10-02。应用基线 `9db752d`，公网网关基线 `7b673b1`。接手时先查看最新 Git、AGENTS.md 和真实实现；本文记录已确认边界与尚未实现的部分，不冻结后续版本号。

## 目标与当前状态

用户已有 Mac、iPhone、Apple Watch，准备由 Mac 上的 Codex 配合 Xcode 继续开发。目标是简洁的手机与手表入口，复用现有能力，避免再写一套业务。

- 已完成：手机网页、独立公网登录、结果/运行/待办/归档四区，共用事实条、闭环、模板、录入卡片。650px 以下自动手机布局，也可显式选择 mobile。
- 已完成：Electron 桌面壳，运行、待办两种快捷展示；不是本次 Apple 开发的重写对象。
- 尚未完成：原生 iOS 壳、watchOS 项目、配对通信、iPhone/Watch 真机验收。
- 代码已统一为 WebSocket PCM 音频流，删除 WebRTC/ICE；公网复用现有 HTTPS 网关。代码合入主分支后仍需重启服务加载新后端，真实 iPhone Safari 验收仍待完成。

开发入口：[Compound dev 手机网页](https://songring.nat100.top/compound/dev/?presentation=mobile)。dev/prod 均已配置公网入口；prod 地址见 [访问备忘](access-memo.md)。Windows 后端、共享网关与隧道需要保持运行；Mac 不必再启动一套后端。

## 概念边界

核心业务是 event 与 tags forest；计时器只认识不透明 key，前端以稳定 source_id 的字符串映射。版本 ID 不能拿来绑定计时。事实成员由标签决定，不新增手机或手表成员表。

| 参与者 | 职责 | 不应知道 |
| --- | --- | --- |
| 现有前端 | commands 修改，projection 只读组装，workspace 渲染与输入草稿 | Xcode、签名、Watch 配对细节 |
| iPhone 壳 | WKWebView、应用生命周期、必要原生能力及配对通信 | event SQL、森林成员、网页 DOM 内部结构 |
| Watch 应用 | 小屏原生展示、用户快捷输入、明确的操作反馈 | iPhone 网页节点、后端数据库与存储路径 |
| access | 独立凭证、会话、环境及请求认证 | 业务动作、森林、计时生命周期 |
| speech | 临时音频连接与全文转录 | event、森林、评分与保存流程 |
| public_gateway | 路径转发、共享隧道生命周期 | 用户事实与各应用密码 |

iPhone 用 Swift + WKWebView 承载同一套手机网页，不用 Swift 重写事实、森林、模板和录入业务。Watch 用 SwiftUI 做小界面，不把网页缩小塞进手表。

不建立万能桥接命令、事件总线或请求恢复队列。原生桥只开放实际需要的能力，不让网页任意执行原生方法。修改接口先说明现有能力不足之处，不能随手表按钮不断发明后端接口。

## 目录与接手索引

建议新增的目录，尚未创建：

```text
apple/
├─ Compound.xcodeproj/       iOS 与 watchOS targets、构建和签名装配
├─ iphone/                  WKWebView 容器、权限、生命周期与原生桥
└─ watch/                   SwiftUI 界面、配对通信与反馈
```

项目和 scheme 的实际名称由实现确定；不要把目录树当作已经存在的工程。只有出现真实共用职责才抽取共享模块，不预建空壳目录。

现有代码入口：

- `frontend/main.js`：访问能力、业务概念、计时与语音装配。
- `frontend/shell/workspace/mobile/`：手机布局；`component/`：共用 DOM 与录入卡片。
- `frontend/shell/commands/`、`projection/`：已有修改协调与只读展示组合。
- `frontend/access/`、`backend/access/`：登录、Cookie、CSRF 与路径请求。
- `frontend/plugin/speech/`、`service/speech/`：WebSocket PCM、静音检测、腾讯识别。
- `backend/__main__.py`：HTTP 路由与能力装配；业务接口契约见根 README。
- 相邻 `public_gateway/router/app.py`：HTTP/WebSocket 转发，网关独立提交。

Windows 应用路径是 `C:/AI/PROJECT/TOOL/compound-system`，不是旧项目 `flywheel_log`。Mac 使用自己的检出路径，不把 Windows 路径写进 Apple 工程。不迁移旧项目或正式数据。

## 服务、身份与设备

公网前缀 `/compound/dev/`、`/compound/prod/` 分别转发到 Windows 服务19080、19081。ToolDock 与手动入口共用这两个端口，见 `tooldock/README.md`；同环境只运行一个后端。手机/Mac 的 localhost 不指向 Windows。

已有八个业务接口：writeevent/readevent、writeforest/readforest、writelooptemplate/readlooptemplate、writetimer/readtimer。访问接口另为：

- GET `access/session`：authenticated、csrf、environment；本机入口有 local 标记。
- POST `access/login`：`{password}`，返回会话 CSRF，写入 HttpOnly Cookie。
- POST `access/logout`：携带当前会话与 CSRF，清除 Cookie。

所有 URL 相对应用目录，不能将 `/readevent` 等根路径直接拼到公网域名，绕过 `/compound/dev/`。公网 Cookie 是环境独立、路径限定、Secure、SameSite=Strict 的签名会话，有效期七天；写请求携带 X-CSRF-Token。

dev 初始密码在 Windows 忽略文件 `instance/dev/initial-password.txt`。用户私下读取并在设备登录，不写进文档、URL、测试录像或源码。`access.json`、腾讯凭据、隧道凭据均不随代码检出；不要复制其他应用密码。需要 native URLSession 访问时，单独明确会话归属，不默认它与 WKWebView/Safari 共享 Cookie。WebKit Cookie 存储参考 [WKWebsiteDataStore](https://developer.apple.com/documentation/webkit/wkwebsitedatastore)。

Mac 准备：安装兼容当前设备系统的 Xcode，打开一次完成 SDK 安装，确认 `xcode-select -p`、`xcodebuild -version` 可用；加入用户的 Apple 账号，签名 Team 与 Bundle ID 由用户选择。不要提交个人签名凭据或 Xcode 用户状态。

先在模拟器构建，再连接 iPhone、信任 Mac，按系统提示开启开发者模式。Watch 先与 iPhone 配对，再在 Xcode 选择设备进行无线安装/调试，不需要 Watch 开发数据线。免费账号可做个人真机测试但有签名限制；TestFlight/App Store 分发另行决定。参考 [真机运行](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)、[开发者模式](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)、[会员能力](https://developer.apple.com/support/compare-memberships/)。

## iPhone 第一个闭环

1. 创建可构建的 iOS target，用 WKWebView 打开 dev 手机 URL，复用网页登录与组件。
2. 使用持久 WebKit 数据存储，验证退出/重开会话、前后台切换与输入草稿，不新增事实缓存或离线队列。
3. 验证安全区、软键盘、滚动、卡片序列、取消、写入失败和两个事实独立计时。原生导航仅允许约定的应用地址；外部链接有明确处理。
4. 语音需要麦克风用途说明及系统/WebKit 权限处理；在 HTTPS 和真机上验收。不承诺锁屏后台持续录音或网页脚本常驻。
5. 记录实际 Xcode/scheme、构建运行命令和真机结果，提交这个自然闭环。

## Watch 的边界与待定项

用户明确要 Watch，但尚未确定首版显示内容、按钮与是否需要脱离 iPhone 使用。先与用户对齐最小功能、设备/系统版本、安装分发方式；不要直接复制所有手机功能。

优先考虑伴随 iPhone 的 watchOS target，以 Watch Connectivity 交换必要数据或明确操作请求。它不是任意时刻可用的远程调用通道：即时消息要求对端可达；后台传输机会性执行，不能冒充即时保存成功。参考 [WCSession](https://developer.apple.com/documentation/watchconnectivity/wcsession)。

手表操作不能依赖 iPhone 网页正好打开，也不能在手机后台唤醒一个 WKWebView 后执行 JS 作为业务通道。先确定请求由 iPhone 原生网络能力转接，还是 Watch 直接访问后端；后者还需要明确 Watch 登录与凭据管理。不要为此默认共享永久密码、假造新 token 接口或隐藏会话复制。

可以先完成配对后的只读展示闭环，再加已确认的操作。若涉及暂停/继续，只调用 timer；涉及结算或归档，则要遵守现有完整 event 写入、累计耗时与成功后 reset 的顺序。不同请求不是共同事务，失败必须真实反馈，不因原生客户端出现新的一套计时规则。

## 语音交接：统一传输与真机验收

当前代码链路为麦克风 → AudioWorklet PCM → WS/WSS → speech → 腾讯。`speech/config` 返回配置状态，`speech/stream` 承载音频和全文。旧 offer、WebRTC 和 ICE 已删除，协议与职责以 [speech 文档](../service/speech/README.md) 为准。

access 装配相对路径与已校验的连接能力；公网沿用登录 Cookie，校验 Origin 与首条会话令牌，凭据不进入 URL。语音插件不感知登录、event、森林或计时。

真实 iPhone 尚需确认：用户手势激活 AudioContext、麦克风权限、实际采样率转换、停顿与 Enter 等待最终全文、关闭释放麦克风，以及蜂窝网络断线后保留混合草稿。Windows Playwright WebKit 没有 Web Audio，自动化卡片回归不能替代这些验证。

Watch 若要语音，另行确定使用系统听写还是流式识别，不能假设会运行浏览器采集代码。此部分不阻塞 iPhone 薄壳的网页与键盘操作闭环。

## 验证与交付

主分支合并验证：Python业务/认证/语音42项、Chromium/Electron完整回归27项、PCM采样转换三项通过。语音分支此前已通过真实腾讯本地Web/Electron两项与WebKit手机、卡片三项。收费语音与公网冒烟默认关闭。尚无本次改造的公网WSS、真实 iPhone、Watch 或 Mac 构建结果。

保留现有 `tests/browser/mobile.spec.js`、`public-mobile.spec.js` 及 workspace/desktop/speech 回归。公网冒烟只读真实 dev，自动写入使用临时 Git/SQLite；不要向长期 dev 批量灌验收记录。现有 Python/E2E 夹具含 Windows 与外部协议路径，Mac 直接运行前先检查，不伪称跨平台已就绪。

Apple 工程需要可重复构建、模拟器 UI 流程和真机记录；真机重点是登录持久化、麦克风、前后台、Watch 可达/不可达、网络失败和按键实际效果。模拟器通过不能代替手表真机通过。

按“iPhone 薄壳可用”“Watch 最小闭环”“统一语音通道”分别提交标题与正文，更新真实结果和限制。提交前检查 diff/cached diff/status，只提交当前任务文件，不推送、不改已有冻结标签，不提交凭据、设备日志、DerivedData、用户工程状态或备份数据。
