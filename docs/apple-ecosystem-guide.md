# Compound Apple 生态开发指南

本文记录 Compound 的 iPhone、Apple Watch 与表盘复杂功能架构，以及首次真机闭环中已经验证过的故障与经验。后续开发先读真实实现与本文；不要把临时设备 ID、Apple ID、密码、令牌、签名文件或 DerivedData 写入仓库。

## 1. 当前架构

```text
iPhone App
├─ SwiftUI：DEV/PROD、Keychain 密码与 Watch 授权状态
└─ WKWebView：复用现有手机网页

Apple Watch App / 表盘复杂功能
├─ SwiftUI / WidgetKit：展示和明确的用户动作
├─ App Group：共享快照和受限 Watch 令牌
└─ HTTPS：直接读取和操作 Windows Compound 后端

Windows Compound
├─ access：网页会话、Watch 令牌签发与吊销
└─ watch：快照，以及计时、归档和待办编辑的服务端协调
```

iPhone 不是 Watch 的业务代理。它负责保存网页密码、选择环境，以及为 Watch 完成授权。授权成功后，Watch App 和表盘通过公网 HTTPS 直接访问后端；iPhone 可以息屏，Compound App 不需要后台常驻。

非蜂窝版 Watch 会由 watchOS 自动选择自己的 Wi-Fi，或通过附近的配对 iPhone 使用网络。后一种情况只是借用系统网络出口，不是唤醒 iPhone Compound App 执行业务。

## 2. 不可破坏的边界

- Swift 不理解 event 标签、森林、单计时互斥、耗时累计或归档顺序。
- Watch 只提交窄命令及其必要参数，正常读写固定走 `/watch/snapshot` 与 `/watch/action`。
- iPhone 密码只保存在 Keychain；密码不得发送到 Watch。
- Watch 令牌只允许 Watch 接口，绑定 DEV 或 PROD，当前有效期 90 天，可统一吊销。
- Watch 令牌是可撤销 bearer credential，保存在 Watch App 与复杂功能共享的 App Group 沙箱中；不得记录或输出其内容。
- 不让 Watch 操作依赖前台 WKWebView，也不在手机后台执行 JavaScript。
- 不以“兼容”为由偷偷切换业务通道。直连缺令牌或失败时必须显示真实错误。
- timer 始终使用稳定 `source_id` 的字符串，不使用 `version_id`。

当前 Watch 归档会暂停计时、累计耗时、写入归档区域并 reset timer，但不会打开网页的评分卡片：已有评分保留，无评分仍保持缺失，不会自动写 0。若以后要求归档必填评分，应先在 Watch 增加明确的评分确认界面，再提交归档动作。

## 3. 目录索引

| 位置 | 职责 |
| --- | --- |
| `apple/iphone/` | iPhone 入口、WKWebView、环境切换、Keychain、原生 Watch 授权 |
| `apple/watch/` | Watch 两页界面、直连刷新和动作反馈 |
| `apple/complication/` | WidgetKit 表盘复杂功能与 AppIntent 按钮 |
| `apple/shared/` | 快照、消息、令牌和复杂功能共享状态 |
| `backend/access/` | 网页会话、Watch 令牌签发/校验/吊销 |
| `backend/watch/` | Watch 窄读模型与四个动作的服务端协调 |
| `frontend/access/` | 网页访问会话与原生登录桥 |
| `frontend/shell/watch_snapshot/` | 前台兼容快照，不是 Watch 后台直连通道 |

工程包含 iPhone App、Watch App 和 WidgetKit extension。复杂功能当前只支持 `.accessoryRectangular`，因此只会出现在支持矩形槽位的表盘或智能叠放卡片选择中；在圆形、角落或单行槽位中不会列出 Compound。

## 4. 首次开发环境准备

1. 安装与当前 iPhone/watchOS 兼容的完整 Xcode。`Additional Tools for Xcode.dmg` 不是 Xcode；Apple silicon Mac 优先下载 Apple silicon `.xip`。
2. 首次打开 Xcode 安装平台组件，然后接受许可：

   ```bash
   sudo xcodebuild -license accept
   xcode-select -p
   xcodebuild -version
   ```

3. Xcode → Settings → Accounts 登录 Apple ID。个人真机测试可使用 Personal Team，但证书有期限，不等于 TestFlight/App Store 分发。
4. 数据线连接并解锁 iPhone，信任 Mac，开启开发者模式。Watch 通过已配对的 iPhone 和局域网参与开发，不需要数据线。
5. 保持 iPhone、Watch、Mac 的蓝牙/Wi-Fi 可用。代理或 TUN 可能破坏 Xcode 的远程配对隧道；网络异常时先检查系统代理、TUN、局域网隔离与设备锁定状态。

Watch 上的“信任电脑”与正常配对并不保证 Xcode 已建立开发隧道。以 `devicectl` 或 Xcode Devices and Simulators 的实际状态为准：

```bash
xcrun devicectl list devices
```

## 5. 构建、测试与安装

先做无签名模拟器构建：

```bash
xcodebuild -project apple/Compound.xcodeproj \
  -scheme Compound \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

仅构建成功不等于可安装。扩展 Info.plist、嵌入关系或 Bundle ID 错误通常要到安装时才暴露，因此还要在真实模拟器运行测试：

```bash
xcrun simctl list devices available
xcodebuild -project apple/Compound.xcodeproj \
  -scheme Compound \
  -destination 'platform=iOS Simulator,id=<SIMULATOR_ID>' \
  CODE_SIGNING_ALLOWED=NO test
```

真机签名构建与安装：

```bash
xcodebuild -project apple/Compound.xcodeproj \
  -scheme Compound \
  -destination 'id=<XCODE_IPHONE_ID>' \
  -configuration Debug build

xcrun devicectl device install app \
  --device <COREDEVICE_IPHONE_ID> \
  '<DerivedData>/Build/Products/Debug-iphoneos/Compound.app'

xcrun devicectl device install app \
  --device <COREDEVICE_WATCH_ID> \
  '<DerivedData>/Build/Products/Debug-watchos/Compound Watch App.app'
```

不要把上述 ID 或个人 DerivedData 路径提交。Watch 无线安装超时时，保持两台设备解锁、靠近且同网后重试；嵌入 iPhone 包不代表 Watch 已立即完成更新，直接安装 Watch product 更容易确认版本。

## 6. DEV/PROD 与导航

iPhone 底部切换 DEV/PROD。切换过程为：

1. 清除 Watch 的旧快照和旧环境令牌。
2. WKWebView 加载目标环境。
3. iPhone 原生端使用目标环境的 Keychain 密码，向同一环境签发 Watch 令牌。
4. WatchConnectivity 激活后下发；Watch 保存并直接刷新目标环境。

WKWebView 导航白名单必须同时允许：

```text
/compound/dev
/compound/dev/**
/compound/prod
/compound/prod/**
```

相似路径如 `/compound/production/` 不能误放行，其他 HTTPS 链接交给 Safari，非 HTTPS 拒绝。曾经只登记 DEV，导致点 PROD 时打开 Safari，而原生按钮状态显示 PROD、WebView 仍是 DEV；导航测试必须同时覆盖两个环境和相似路径。

## 7. Watch 授权与手机息屏

可靠授权流程：

```text
iPhone Keychain 密码
  → POST access/login
  → POST access/watch-token
  → WatchCredential(environment, baseURL, token, expiresAt)
  → WatchConnectivity applicationContext/message
  → Watch App Group
```

`WCSession.activate()` 是异步的。不能在调用 activate 后立刻发送并吞掉错误；iPhone 必须缓存最近的 credential，在 `activationDidComplete` 后再次下发。Watch 若缺令牌，可以请求 iPhone 重新下发授权，但不得把业务动作改走 iPhone。

iPhone 底部必须明确显示：

- `Watch 授权中…`
- `Watch 已授权`
- `Watch 未授权：<真实原因>`

Watch 缺令牌时应立即显示“Watch 未获得服务器授权，请在 iPhone 打开 Compound”。禁止先禁用按钮等待几十秒，再用“iPhone 暂时不可达”掩盖令牌缺失。

授权完成后的请求是：

```text
GET  <environment-base>/watch/snapshot
POST <environment-base>/watch/action
Authorization: Bearer <scoped-token>
```

公网未带令牌访问 `/watch/snapshot` 应返回 Watch 授权错误；这可以证明新后端已部署，但不能证明某块 Watch 已拿到令牌。检查设备容器时只能确认文件或键是否存在，禁止打印 credential 内容。

## 8. 表盘复杂功能经验

- watchOS 10 以后使用 WidgetKit；矩形 accessory 可用于表盘复杂功能和智能叠放。
- extension 必须有非空 `CFBundleName`。缺失时编译可以成功，但安装会报 `MissingBundleNameString`。
- Watch App 必须嵌入 extension；iPhone App 必须嵌入 Watch App。三个 Bundle ID 应形成稳定层级并分别签名。
- Watch App 与 extension 都需要同一个 App Group entitlement，否则复杂功能读不到 Watch App 保存的快照和令牌。
- 更换 extension 能力但系统列表仍缓存旧结果时，先确认安装成功、支持的 `WidgetFamily` 与当前槽位匹配，再考虑递增构建号并重新安装；不要一开始就盲目增加所有槽位。
- `Button(intent:)` 的计时切换和归档可直接触发 HTTPS 动作；卡片其他区域由系统默认打开所属 Watch App。
- AppIntent 必须在返回前把真实成功或失败写入共享反馈状态；系统保证 Intent 返回后重载时间线，复杂功能据此播放最长两秒的 WidgetKit 数据更新动画。动作已经返回新快照时直接渲染共享状态，不为动画再发一次重复请求。
- 复杂功能运行在独立扩展进程，视图由系统归档渲染，无法像前台 Watch App 一样主动播放可控音效或触感；不得为了反馈强制打开 App。表盘按钮只使用系统交互反馈，应用自定义触感音归前台 Watch App。
- 表盘时间显示可根据服务端快照的 `generatedAt + elapsedMs` 本地推算，不能每秒请求服务器。
- WidgetKit timeline 和后台刷新由 watchOS 调度。代码可请求刷新，但不能承诺固定周期或后台常驻。

Watch App 本身在前台可见时每秒直连读取一次快照，用于从息屏恢复后自动重试临时 TLS/网络错误并同步其他设备的变化。轮询会跳过尚未完成的读取和写动作，成功后清除旧错误；离开 App 或息屏后 SwiftUI task 由系统取消或暂停。这个规则不适用于表盘复杂功能，不能据此声称 Watch 后台每秒联网。

当前矩形卡片的选择规则：优先显示任何正在计时的结果/运行任务；没有正在计时则显示运行区内的暂停任务；都没有时显示安静的 Compound 标记。

## 9. 业务动作与后端

Watch 发送：

```json
{"action":"pause|resume|run|archive","itemID":"<source_id>"}
```

待办编辑仍复用同一入口：页面级支持新建无闭环待办、新建空闭环及从模板实例化；闭环级支持新增待办和级联删除；小事级支持运行和确认删除。Watch 只提交正文、闭环 ID 或模板 ID，后端负责生成闭环身份、日期标签、模板成员和删除版本。`/watch/snapshot` 同时返回模板摘要及森林中尚无成员的空闭环。

服务端负责：

- `pause/resume`：修改目标 timer；启动前暂停其他正在运行的 timer。
- `run`：执行单计时互斥，启动 timer，把待办 event 移到运行。
- `archive`：暂停 timer，累计 elapsed，写入归档 event，再 reset timer。
- `delete-item`：为目标 event 追加删除版本。
- `create-todo/create-loop/create-loop-item/use-template/delete-loop`：分别协调 event、tags forest 与 loop template；删除闭环级联删除同一闭环身份的全部区域成员。

Watch 不直接调用低层 `/writetimer`、`/writeevent` 拼业务流程。当前 `backend/watch` 与网页 JavaScript commands 仍有少量协调规则重复；以后若继续扩展动作，应优先把网页和 Watch 收敛到同一后端 command，而不是在 Swift 增加规则。

## 10. 部署顺序

涉及 Watch 直连协议时，按顺序闭环：

1. 运行 Python、JS 与 Xcode 测试。
2. `npm run build`，确认生成的 `frontend/app.js` 已更新并提交。
3. 推送代码；Windows 拉取后重启对应 DEV/PROD 后端和网关。
4. 确认公网静态 `app.js` 与 `/watch/*` 已是新版本。
5. 安装 iPhone 和 Watch App。
6. 打开 iPhone，看到 `Watch 已授权`。
7. 打开 Watch，确认环境标识和数据正确。
8. 让 iPhone 息屏，再测试刷新、暂停/继续和归档。
9. 分别切换 DEV/PROD，重复授权和隔离验证。

后端代码推送但 Windows 未重启，会出现“原生新版 + 公网旧版”；只重新安装 App 无法修复。反过来，后端已部署但 Watch 未拿到令牌，也不能用公网接口存在来宣称直连已完成。

## 11. 故障速查

| 现象 | 优先检查 | 正确处理 |
| --- | --- | --- |
| 点 PROD 打开 Safari | `NavigationPolicy` 是否只允许 DEV | 同时允许精确的 dev/prod 根与子路径并补测试 |
| Watch 按钮变灰很久后报 iPhone 不可达 | 直连令牌缺失却发生业务回退 | 删除业务回退，立即显示未授权；修复令牌下发 |
| iPhone 显示已切环境，Watch 仍是旧数据 | 旧 credential/applicationContext 未清理 | 切换时清旧状态，目标环境授权成功后再恢复 |
| Watch 已安装但 Xcode 找不到 | 设备锁定、开发模式、配对隧道、TUN/局域网 | 解锁三端、确认开发模式和网络，再看 `devicectl` |
| 复杂功能列表没有 Compound | 当前槽位不是矩形，或 extension 未安装 | 选矩形槽位/智能叠放；检查嵌入和安装结果 |
| App 编译成功但安装失败 | extension Info.plist/Bundle ID/签名 | 做真实安装测试；检查 `CFBundleName` 和嵌入层级 |
| 表盘内容不秒级更新 | 把 WidgetKit 当成常驻进程 | 本地推算计时，接受系统 timeline 调度 |
| Watch 无蜂窝且离开手机后不可用 | Watch 也没连接 Wi-Fi | 正常无网络状态，明确报错，不离线伪成功 |
| Watch 操作成功但网页评分卡没出现 | Watch 归档是服务端窄动作 | 明确认可无评分语义，或先设计 Watch 评分确认 |

## 12. 验收清单

- iPhone：DEV/PROD 均留在 App 内；密码跨重启保留；错误明确可见。
- 授权：环境切换后显示 `Watch 已授权`，Watch 顶部环境一致。
- Watch：运行/待办只通过左右滑动切换，纵向滚动不误触换页；滚动面延伸到系统时钟悬浮层下方。待办闭环组使用左标题、右动作，点击标题按后端提供的稳定闭环 ID 在 Watch 本地折叠并跨重启记忆，不修改网页森林的 `is_fold`；运行闭环组使用居中标题紧凑展示；无闭环任务不包组且排列在闭环之前。待办与未置顶的运行任务保持单行任务条；顶部计时条记忆上一次计时任务的稳定 ID，暂停后继续以双行布局保留，开始其他任务时替换，归档导致当前运行视图找不到该 ID 时消失。创建入口位于待办列表末尾。watchOS 不允许第三方应用隐藏系统时钟。
- 主题：iPhone 只保存并同步 `themeID`，Watch App 与表盘从共享容器读取并本地渲染；颜色、布局和任务插绘不进入网络协议。默认主题保留既有界面。幻影主题的计时横幅、任务缩略图、闭环页签、录音壁纸和动作反馈均为 Watch 本地 AI 位图资产；`PhantomArt` 只负责把稳定任务/闭环 ID 映射到资产名，同一对象跨刷新不会换图，业务视图仍拥有文字、状态和点击区域。
- 录入：进入新建页面即主动打开 Apple 系统输入；在系统界面完成即直接创建并返回列表，取消则放弃本次录入。炫彩全屏仅作为自动打开失败后的整页重试入口，不保留二次确认按钮。
- 反馈：服务端动作成功或失败后统一发布一次短生命周期反馈事件；运行、暂停、归档、创建、删除和失败分别映射到启动、停止、成功、向下及失败触感音，并配套全屏粒子、光环和符号动效。点击只播放按钮压感，成功奖励不得在服务端结果前出现。
- 直连：iPhone 息屏后，Watch 刷新和动作仍成功。
- 单计时：启动一个任务会暂停其他正在运行的任务。
- 归档：耗时累计一次、区域正确、timer reset；评分缺失语义符合当前约定。
- 表盘：矩形卡片可添加；左右动作各占独立的全高长方形点击区，中间首行动态显示居中计时、次行显示居中任务描述；暂停/继续和归档成功后显示高速奖励动画，失败显示真实错误，随后回到最新任务卡；打开 App 正常。
- 失败：无令牌、无网络、令牌过期、服务端错误都立即显示真实原因，不自动换业务路径。
- 安全：提交中没有密码、令牌、设备 ID、签名材料、用户工程状态或 DerivedData。
