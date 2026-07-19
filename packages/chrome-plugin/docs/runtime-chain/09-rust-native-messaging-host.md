# 节点 09：Rust Native Messaging Host

[上一节点：Native Host 注册](./08-native-host-registration-and-bootstrap.md) ·
[返回总览](./README.md) ·
[下一节点：Extension Service Worker](./10-extension-service-worker-and-client.md)

## 1. Host 是两种传输之间的透明桥

源码：

[`browser-native-host/src/main.rs`](../../browser-native-host/src/main.rs)

Chrome 在 Extension 调用 `connectNative("com.anybox.browser")` 时启动这个二进制，并将：

```text
Host stdin  ← Extension 发来的 Native Messaging frame
Host stdout → 发给 Extension 的 Native Messaging frame
```

Host 同时主动连接插件 Browser Host 的 `native-host` IPC endpoint。

它的核心职责：

```text
读取持久 runtime config 和短期 bootstrap
  → 认证到 Browser Host native-host endpoint
  → Chrome Native Messaging framing ↔ Browser IPC framing
  → 透明转发 JSON
```

它不解析 `tabs.list`、`page.fill` 等业务语义。

## 2. 启动顺序

`run()` 严格按顺序：

1. 查找并读取 runtime config；
2. 校验 transport/protocol/locator；
3. 读取 bootstrap config；
4. 校验 role、endpoint、broker、proof 非空和 expiresAt；
5. 连接本机 endpoint；
6. 完成 challenge/HMAC/ready；
7. 认证成功后才开始读取 Chrome stdin 和 Browser Host IPC 的业务消息。

所以 Extension 很早调用 `port.postMessage(hello)` 时，Chrome/管道可以暂存数据，但 Host
不会在 Browser Host 认证前把它转发。

## 3. runtime config 查找顺序

Host 优先检查环境变量：

```text
ANYBOX_BROWSER_NATIVE_CONFIG
```

然后按平台查找约定路径。Windows 包括：

```text
%APPDATA%\Anybox\native-messaging\com.anybox.browser.runtime.json
%APPDATA%\anybox-desktop-agent\native-messaging\com.anybox.browser.runtime.json
```

macOS/Linux 也保留 `Anybox` 与旧 `anybox-desktop-agent` 目录兼容候选。

第一个可读取候选如果 JSON 无效，会直接报错；没有候选时提示重新安装/修复 Chrome
插件。

## 4. runtime 与 bootstrap 校验

runtime config：

- Windows 必须为 `windows-named-pipe`；
- Unix 必须为 `unix-domain-socket`；
- protocol 必须为 1；
- nativeHostEndpoint/bootstrapPath 不能为空。

bootstrap：

- transport/protocol 与 runtime config 相等；
- role 必须为 `native-host`；
- endpoint 必须等于 runtime config 的 nativeHostEndpoint；
- broker ID 和 proof 非空；
- `expiresAt` 未过期。

Host 自己不会删除 bootstrap 文件；Browser Host 在认证成功后消费并删除。

## 5. Native Host IPC 认证

Host 连接 endpoint 后读取 Browser Host challenge：

```json
{
  "type": "challenge",
  "protocolVersion": 1,
  "role": "native-host",
  "brokerInstanceID": "...",
  "nonce": "...",
  "expiresAt": 0
}
```

它校验协议、role、broker、nonce 和期限，然后生成：

```text
clientInstanceID = native-host-<pid>-<unix-ms>
clientVersion    = Rust crate version，当前 0.3.0
```

HMAC transcript：

```text
anybox-browser-ipc-v1
native-host
brokerInstanceID
nonce
clientInstanceID
0.3.0
```

hello 还包含编译时固定：

```text
nativeHostName = com.anybox.browser
extensionID    = hjbejdmgpifdjjlpgmdfmbmbhkedgnjc
```

只有 Browser Host 返回匹配的：

```json
{
  "type": "ready",
  "protocolVersion": 1,
  "role": "native-host",
  "brokerInstanceID": "..."
}
```

才进入转发循环。

## 6. 两种 framing

### Browser IPC 侧

```text
4 字节 uint32 大端长度 + UTF-8 JSON
最大 16 MiB
```

### Chrome Native Messaging 侧

```text
4 字节 uint32 小端长度 + JSON bytes
Host 最大 64 MiB
```

Chrome 官方 Native Messaging 使用本机字节序；当前支持平台上实现按小端处理。

Host 的通用 `read_length_prefixed/write_length_prefixed` 会检查：

- 完整 4-byte header；
- 长度不为 0；
- 不超过对应 maximum；
- payload 完整；
- 写后 flush。

Chrome 侧消息即使小于 64 MiB，包进 Browser IPC 后仍受 16 MiB 上限约束。

## 7. Chrome → Browser Host

Host 的 Chrome reader thread：

1. 从 stdin 读取 Native Messaging frame；
2. 主循环将 payload 解析成 JSON；
3. 包装成：

```json
{
  "type": "native.message",
  "message": {
    "...": "Extension application message"
  }
}
```

4. 用 Browser IPC framing 写到 Browser Host。

Extension 的 `hello`、`result`、`event`、`pong` 都走这条方向。

## 8. Browser Host → Chrome

Browser Host reader thread 从 IPC 读取 JSON。主循环处理：

### `native.message`

取内部 `message`，序列化为 JSON bytes，用 Chrome Native Messaging framing 写 stdout。

Browser Host 的 `command`、`ping` 都被 Gateway/Bridge 包在 `native.message` 中。

### `ping`

这是 Browser IPC transport ping，不发到 Chrome；Host直接在 IPC 侧回 `pong`。

### `error`

把 Browser Host code/message 转为 Native Host 错误并退出。

其他类型会被视为 unsupported，避免 Host 被当作通用 IPC client。

## 9. 为什么使用两个 reader thread

Host 要同时等待：

- Chrome stdin；
- Browser Host local socket。

它分别启动两个线程，把输入汇合到 Rust `mpsc` channel；主线程串行处理并负责写：

- Browser IPC stream；
- Chrome stdout。

这样避免两个线程同时竞争 stdout/IPC writer，又能双向响应。

任意一端正常 EOF 时 Host 正常结束；读写错误时 stderr 输出：

```text
[anybox-chrome-native-host] <error>
```

并以非 0 退出。Chrome Port 随后触发 Extension `onDisconnect`。

## 10. Host 理解和不理解什么

Host理解：

- runtime/bootstrap config；
- Browser IPC challenge/hello/ready；
- `native.message` transport envelope；
- ping/pong/error；
- 两种 framing。

Host不理解：

- Browser Contract；
- command method 或参数；
- Extension capabilities；
- tab ownership；
- URL、页面内容和截图；
- per-action permission。

即便 Host 收到一个结构上是 JSON、业务上恶意的 `command`，它也会透明转发；Browser Host
Bridge 与 Extension schema 才负责业务验证。

## 11. 安全边界

Host 增加的保护：

- 不接受 TCP/HTTP/WebSocket；
- 固定 role/Host name/Extension ID；
- 当前 broker challenge；
- 一次性短期 proof；
- frame 大小与 JSON 校验；
- 不把 secret 放入持久 runtime config。

当前缺口：

- Browser Host Gateway 没有验证 Native Host 对端 PID/签名；
- Native Host 也没有对 Browser Host executable 做签名级验证；
- bootstrap 在被 Host 读取到认证完成之间仍存在本机同用户进程可读取风险，主要依赖
  current-user ACL、短 TTL 和一次性消费降低风险。

## 12. 本节点的输出

认证完成后，Native Host 对 Extension 看起来就是一个 Native Messaging Port；对 Browser Host 看起来
就是一个已认证 `native-host` IPC client。下一节点是 Extension MV3 Service Worker，
它在这个 Port 上发送应用层 hello 并接收 command。
