# 节点 08：Native Host 注册与 bootstrap

[上一节点：Extension Bridge](./07-browser-extension-bridge.md) ·
[返回总览](./README.md) ·
[下一节点：Rust Native Host](./09-rust-native-messaging-host.md)

Browser Client 先确保插件 Browser Host 已运行，再加载同目录
`native-host-bootstrap.js`。它调用 `installManifest.mjs` 为当前用户注册插件内的 Rust
Native Messaging Host。

持久 runtime config 只保存：

- transport 与协议版本；
- native-host endpoint；
- Native Host bootstrap 文件路径。

Browser Host 生成短时、一次性 bootstrap proof。Rust Host 读取后完成 challenge/HMAC
认证；Browser Host 在认证成功时消费并删除 proof，断线后再生成新 proof。

Native Host 可执行文件、安装脚本、bootstrap 和 Browser Host 都随 Chrome 插件交付，
AnyboxAgent/桌面运行时不再复制 Chrome 专属 Host。
