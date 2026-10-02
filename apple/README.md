# Compound Apple Apps

iPhone target 是现有手机网页的原生薄壳，只管理 WKWebView、应用生命周期、导航限制、系统权限和 Watch 配对通信。Watch target 是原生 SwiftUI 小界面。事实、森林、模板与计时规则仍由现有网页和服务拥有。

## 构建

打开 `Compound.xcodeproj`，在 Signing & Capabilities 中选择个人 Team，然后选择模拟器或已配对的 iPhone 运行。首次真机安装需要解锁设备、信任 Mac 并开启开发者模式。

命令行无签名构建：

```bash
xcodebuild -project apple/Compound.xcodeproj -scheme Compound -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

App 可在底部切换 dev/prod。两个环境的网页登录密码只保存在 iPhone Keychain，不进入工程。Windows 后端、public_gateway 和隧道需要保持运行。

## Watch 闭环

`Compound Watch App` 随 iPhone App 嵌入安装，显示运行、待办、闭环组与结果计时，并提供运行/继续、暂停、归档。表盘矩形组件显示当前计时，或运行区内的暂停小事；按钮可直接操作，点其余区域打开 App。

Watch 主题只改变本地表现，不改变快照或动作协议。幻影主题的生成式艺术资产集中在 `watch/Assets.xcassets/Phantom`，`watch/PhantomArt.swift` 只负责把稳定任务 ID 映射到缩略图；运行与待办复用原生白色斜切闭环页签，仅高度不同。不要把资产选择写入后端数据，也不要为主题复制业务视图。

iPhone 登录后会为当前环境签发一个只允许 Watch 快照和四个动作的设备令牌，并通过 WatchConnectivity 交给手表。之后 Watch App 与表盘直接请求 Windows 上的 HTTPS 服务；iPhone 可以锁屏，也不需要保持 Compound 在前台。

- 令牌不包含网页登录密码，dev/prod 隔离，90 天到期。
- `/access/watch-revoke` 可吊销当前环境已签发的全部手表令牌。
- 令牌失效时，在 iPhone 打开一次对应环境即可重新授权。
- 表盘后台刷新由 watchOS 调度，按钮操作会立即直连并刷新；系统不保证组件每秒主动联网。

模拟器需先启动一对已配对的 iPhone 与 Apple Watch，并同时运行 `Compound` 和 `Compound Watch App`。真机调试不需要手表数据线：Apple Watch 先与 iPhone 正常配对，保持解锁及蓝牙/Wi-Fi 可用，再在 Xcode 的运行设备中选择手表。
