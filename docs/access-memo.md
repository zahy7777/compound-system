# 访问与登录备忘

核对日期：2026-10-02。iPhone 和其他电脑复用同一套网页与数据；Electron 是本机快捷桌面入口。当前公网只配置 dev，prod 尚未开放。

## 地址与密码

| 环境 | 其他电脑浏览器 | iPhone 网页 / 主屏幕入口 | 登录 |
| --- | --- | --- | --- |
| dev | [dev 公网网页](https://songring.nat100.top/compound/dev/) | [dev 手机布局](https://songring.nat100.top/compound/dev/?presentation=mobile) | 无用户名，输入 dev 密码 |
| prod | 尚未配置公网路由 | 尚未配置公网路由 | 无用户名，使用独立 prod 密码 |

屏幕宽度决定默认布局；手机链接的 `presentation=mobile` 显式选择手机布局。其他电脑打开 dev 公网地址即可，无须安装工具坞或另起后端。iPhone Safari 可通过分享菜单“添加到主屏幕”；原生 iOS/Watch 应用尚未实现，见 [Apple 交接](apple-handoff.md)。

密码直接查看本机文件，不在本文复制明文：

- dev：[查看 dev 初始密码](../instance/dev/initial-password.txt)
- prod：[查看 prod 初始密码](../instance/prod/initial-password.txt)

上述链接指向当前项目检出下的 `instance/<环境>/initial-password.txt`；两份文件均已存在。`instance/` 被 Git 忽略，其他电脑和新检出不会自动得到密码，应由本人私下查看后登录。认证配置在同目录 `access.json`，包含密码哈希与会话签名密钥。公网按环境隔离会话；本机回环入口直接使用，不要求公网密码。

## 本机运行入口

这些地址只能在部署服务的 Windows 电脑上访问；其他设备的 `127.0.0.1` 指向它们自己。

| 环境 | 手动启动的单体服务（页面与 API） | 现有工具坞后端（也提供页面） | 现有工具坞网页代理 |
| --- | --- | --- | --- |
| dev | http://127.0.0.1:19080/ | http://127.0.0.1:18980/ | http://127.0.0.1:18981/ |
| prod | http://127.0.0.1:19081/ | http://127.0.0.1:18880/ | http://127.0.0.1:18881/ |

Electron 目前加载工具坞网页代理；其健康端口 dev18982 / prod18882 只用于状态探测。完整清单和启动方式见 [工具坞接入](../tooldock/README.md) 与 [桌面入口](../desktop/README.md)。同环境手动入口和工具坞后端共享数据库与备份，不能同时启动。

## 公网链路与服务数量

```text
iPhone / 其他电脑浏览器
  → https://songring.nat100.top/compound/dev/
  → NATAPP 隧道
  → public_gateway（127.0.0.1:4318，剥离 /compound/dev 前缀）
  → Compound dev（默认 127.0.0.1:19080，页面、API、认证）
```

Compound 拥有业务、页面与认证；Electron 拥有窗口、托盘和快捷键；共享网关拥有路径转发，隧道拥有公网连通。公网访问是现有服务的另一条入口，无须增加独立 Compound web 部署。部署电脑、Compound、网关和隧道必须保持运行。

当前工具坞每个环境列出后端、网页代理、Electron 三个单体服务，另有一个无独立进程的启动组合。`tooldock/scripts/runtime/web.cjs` 只将 HTTP 转发给后端，后端本身已经提供静态页面；这层代理并非独立前端业务。更简单的候选结构是每个环境保留“Compound 服务 + Electron”，浏览器和 Electron 都直接使用 Compound 服务。

该简化尚未实施。实施时需要同时调整工具坞的服务地址、Electron 装配和相关回归；公网网关上游必须与选定的唯一后端端口一致。当前网关只配置 `/compound/dev`，默认指向19080，可用 `GATEWAY_COMPOUND_DEV_URL` 覆盖。prod 开放需要在共享网关新增 prod 路由并核对独立认证，不需要新增 Compound 网页进程。

## 本次连通性核对

2026-10-02 只读检查：本机19080、19081的 `access/session` 均连接被拒绝，dev 公网 `access/session` 返回502。现有配置说明访问路径，但当时服务链路不可用；本次未启动、停止或重启服务。prod 无路由的结论来自共享网关源码，不能以公网502推断它已发布。
