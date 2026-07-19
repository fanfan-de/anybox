# 节点 08：Native Host 注册与 bootstrap

[上一节点](./07-browser-extension-bridge.md) ·
[下一节点](./09-rust-native-messaging-host.md)

## 何时注册

Browser Client 第一次通过 host service 发请求前，动态加载同目录：

```text
scripts/native-host-bootstrap.js
```

该模块只执行一次 `installManifest.mjs` 的 `install()`。因此注册属于 Chrome 插件的
Browser Client bootstrap，不属于通用 Node REPL 初始化。

设置 `ANYBOX_BROWSER_NATIVE_INSTALL=off` 可在测试或外部托管场景跳过注册。

## 插件自带 Host

```text
extension-host/
  windows/x64/extension-host.exe
  macos/<arch>/extension-host
  linux/<arch>/extension-host
```

Native Messaging manifest 固定：

```json
{
  "allowed_origins": [
    "chrome-extension://hjbejdmgpifdjjlpgmdfmbmbhkedgnjc/"
  ],
  "name": "com.anybox.browser",
  "path": "<absolute-plugin-root>/extension-host/...",
  "type": "stdio"
}
```

## 注册位置

| 平台 | Manifest |
|---|---|
| Windows | `%APPDATA%\Anybox\native-messaging\com.anybox.browser.json`，并写 HKCU Chrome key |
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/...` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/google-chrome/NativeMessagingHosts/...` |

插件另写 `com.anybox.browser.runtime.json`，内容只有 transport、protocol version、
nativeHostEndpoint、bootstrapPath 与更新时间；不保存 proof。

## 与 Agent 路径对齐

安装器按以下顺序确定 Agent state：

1. `ANYBOX_AGENT_DATA_DIR/state`；
2. `XDG_STATE_HOME/anybox`；
3. `~/.local/state/anybox`。

因此桌面托管 Agent 使用自定义数据目录时，Browser Client 注册得到的 bootstrapPath
仍与 Agent `Global.Path.state/browser-ipc` 一致。

显式 `ANYBOX_BROWSER_IPC_NATIVE_ENDPOINT` 和
`ANYBOX_BROWSER_IPC_BOOTSTRAP_PATH` 仍可覆盖默认值。Windows endpoint 必须是 Named
Pipe；Unix endpoint 必须是绝对 socket path。

## 一次性 bootstrap

Agent Gateway 写 `com.anybox.browser.bootstrap.json`：

```text
transport / protocolVersion / role
brokerInstanceID
endpoint
proof
issuedAt / expiresAt
```

文件权限受限，默认五分钟过期。Rust Host 用 proof 完成 challenge/hello/HMAC；Agent
认证成功后消费 proof 并删除文件。连接断开时 Agent 再生成下一份 bootstrap。

持久 runtime config 只提供定位信息；没有当前 bootstrap proof 的进程不能完成 Native
Host role 认证。
