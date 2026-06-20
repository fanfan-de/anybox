# SMTP 邮箱 Anybox 插件

这个插件让 Anybox 通过用户配置的 SMTP 邮箱发送邮件。

## 配置

大多数邮箱服务商支持以下 SMTP 模式之一：

- `starttls` on port `587`
- `tls` on port `465`
- `none` 使用端口 `25`，仅适用于明确允许普通 SMTP 的服务器

插件连接表单需要填写：

- `SMTP_HOST`：SMTP 服务器地址，例如 `smtp.qq.com`。
- `SMTP_PORT`：SMTP 服务器端口，默认 `587`。
- `SMTP_SECURITY`：`starttls`、`tls` 或 `none`，默认 `starttls`。
- `SMTP_USERNAME`：SMTP 登录账号，通常是完整邮箱地址。
- `SMTP_PASSWORD`：SMTP 密码、授权码或应用专用密码，会作为连接器密钥保存。
- `SMTP_FROM_EMAIL`：发件邮箱地址。
- `SMTP_FROM_NAME`：可选的发件人显示名称。

对于 Gmail、Outlook、iCloud、QQ 邮箱、163 邮箱等服务商，这里的密码通常不是账号登录密码，而是授权码或应用专用密码。

## 工具

- `smtp_email_test_connection`：连接 SMTP 服务器并验证账号密码，不会发送邮件。
- `smtp_email_send`：通过配置的账号发送纯文本或 HTML 邮件。

## 说明

这个连接器只负责发送邮件，不读取收件箱、不存储邮件，也不管理草稿。需要读取邮箱、整理线程或管理收件箱时，请使用 Gmail、Outlook Email 等服务商专用插件。
