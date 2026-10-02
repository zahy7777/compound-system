# Compound Apple Apps

iPhone target 是现有手机网页的原生薄壳，只管理 WKWebView、应用生命周期、导航限制、系统权限和 Watch 配对通信。Watch target 是原生 SwiftUI 小界面。事实、森林、模板与计时规则仍由现有网页和服务拥有。

## 构建

打开 `Compound.xcodeproj`，在 Signing & Capabilities 中选择个人 Team，然后选择模拟器或已配对的 iPhone 运行。首次真机安装需要解锁设备、信任 Mac 并开启开发者模式。

命令行无签名构建：

```bash
xcodebuild -project apple/Compound.xcodeproj -scheme Compound -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

App 固定打开 dev 手机入口。Windows dev 后端、public_gateway 和隧道需要保持运行；登录密码不进入工程。

## Watch 首个闭环

`Compound Watch App` 随 iPhone App 嵌入安装。它通过 WatchConnectivity 向 iPhone 请求连接状态，iPhone 返回确认与时间；打开时自动检查，也可点“刷新”。这个闭环只验证 App 安装和手表 ↔ 手机通信，不读取或修改业务数据。

模拟器需先启动一对已配对的 iPhone 与 Apple Watch，并同时运行 `Compound` 和 `Compound Watch App`。真机调试不需要手表数据线：Apple Watch 先与 iPhone 正常配对，保持解锁及蓝牙/Wi-Fi 可用，再在 Xcode 的运行设备中选择手表。
