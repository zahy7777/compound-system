# Compound iPhone

iPhone target 是现有手机网页的原生薄壳，只管理 WKWebView、应用生命周期、导航限制和系统权限。事实、森林、模板与计时规则仍由现有网页和服务拥有。

## 构建

打开 `Compound.xcodeproj`，在 Signing & Capabilities 中选择个人 Team，然后选择模拟器或已配对的 iPhone 运行。首次真机安装需要解锁设备、信任 Mac 并开启开发者模式。

命令行无签名构建：

```bash
xcodebuild -project apple/Compound.xcodeproj -scheme Compound -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

App 固定打开 dev 手机入口。Windows dev 后端、public_gateway 和隧道需要保持运行；登录密码不进入工程。
