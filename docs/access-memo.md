# 访问与登录备忘

核对日期：2026-10-02。iPhone 和其他电脑复用同一套网页与数据；Electron 是本机快捷桌面入口。dev/prod 共用现有公网入口，按环境路径隔离。

## 地址与密码

| 环境 | 其他电脑浏览器 | iPhone 网页 / 主屏幕入口 | 登录 |
| --- | --- | --- | --- |
| dev | [dev 公网网页](https://songring.nat100.top/compound/dev/) | [dev 手机布局](https://songring.nat100.top/compound/dev/?presentation=mobile) | 无用户名，输入 dev 密码 |
| prod | [prod 公网网页](https://songring.nat100.top/compound/prod/) | [prod 手机布局](https://songring.nat100.top/compound/prod/?presentation=mobile) | 无用户名，使用独立 prod 密码 |

屏幕宽度决定默认布局；手机链接的 `presentation=mobile` 显式选择手机布局。其他电脑打开对应环境的公网地址即可，无须安装工具坞或另起后端。iPhone Safari 可通过分享菜单“添加到主屏幕”；原生 iOS/Watch 应用尚未实现，见 [Apple 交接](apple-handoff.md)。

密码直接查看本机文件，不在本文复制明文：

- dev：[查看 dev 初始密码](../instance/dev/initial-password.txt)
- prod：[查看 prod 初始密码](../instance/prod/initial-password.txt)

上述链接指向当前项目检出下的 `instance/<环境>/initial-password.txt`；两份文件均已存在。`instance/` 被 Git 忽略，其他电脑和新检出不会自动得到密码，应由本人私下查看后登录。认证配置在同目录 `access.json`，包含密码哈希与会话签名密钥。公网按环境隔离会话；本机回环入口直接使用，不要求公网密码。

## 本机运行入口

这些地址只能在部署服务的 Windows 电脑上访问；其他设备的 `127.0.0.1` 指向它们自己。

| 环境 | Compound 服务（工具坞与手动入口统一） | Electron 健康端口 |
| --- | --- | --- |
| dev | http://127.0.0.1:19080/ | 18982 |
| prod | http://127.0.0.1:19081/ | 18882 |

Electron 直接加载对应 Compound 服务；健康端口只用于状态探测。完整清单和启动方式见 [工具坞接入](../tooldock/README.md) 与 [桌面入口](../desktop/README.md)。手动入口与工具坞控制同一服务，不同时启动两份后端。

## 公网链路与服务数量

```text
iPhone / 其他电脑浏览器
  → https://songring.nat100.top/compound/<dev 或 prod>/
  → NATAPP 隧道
  → public_gateway（127.0.0.1:4318，剥离环境路径前缀）
  → Compound（dev19080 / prod19081，页面、API、认证）
```

Compound 拥有业务、页面与认证；Electron 拥有窗口、托盘和快捷键；共享网关拥有路径转发，隧道拥有公网连通。公网访问是现有服务的另一条入口，无须增加独立 Compound web 部署。部署电脑、Compound、网关和隧道必须保持运行。

工具坞每个环境只有 Compound 与 Electron 两个单体，另有一个无独立进程的启动组合。网页代理代码、启停脚本和清单项已删除。浏览器和 Electron 直接使用同一 Compound 服务。

网关默认上游 dev19080 / prod19081，分别可通过 `GATEWAY_COMPOUND_DEV_URL`、`GATEWAY_COMPOUND_PROD_URL` 覆盖；自定义端口时必须同步网关配置。公网登录按环境使用独立密码和 Cookie，dev 登录不能访问 prod。

## 验证记录

2026-10-02：旧网页代理已停用，dev/prod 的 Compound 与 Electron 均运行。真实 HTTPS 的 Chromium 与 WebKit 各4项只读验收通过，覆盖两个环境的手机/电脑布局、登录、刷新持久会话和退出；dev 会话访问 prod 及反向访问均未认证，读取业务接口返回401。正式环境未写入验收事实。

电脑完整布局目前没有退出按钮，可打开同环境的 `?presentation=mobile` 地址点击“退出登录”。WebKit 自动化不替代真实 iPhone 验收；公网语音仍按 Apple 交接中的独立限制处理。
