---
name: feishu
description: Use Feishu Open Platform tools to look up users, inspect chats and messages, and send bot messages through a connected Feishu custom app.
---

# Feishu

Use this skill when the user asks to work with Feishu or Lark through the installed Feishu plugin.

Available workflows:

- Use `feishu_test_auth` to check whether the configured app ID and app secret can fetch a tenant access token.
- Use `feishu_lookup_user_ids` when the user gives an email address or mobile number and you need an `open_id`, `user_id`, or `union_id`.
- Use `feishu_list_chats`, `feishu_get_chat`, and `feishu_list_messages` to inspect chats and recent chat history that the app is allowed to read.
- Use `feishu_send_text` for normal text bot messages.
- Use `feishu_send_message` only when a non-text Feishu message type is needed and the content object is already known.

Before sending a Feishu message, make sure the user has clearly requested that message to be sent. If the wording is ambiguous, draft the message and ask for confirmation before calling a send tool.

Feishu API access depends on the custom app permissions configured in Feishu Open Platform. If a tool returns a permission error, explain which app capability likely needs to be enabled and avoid retry loops.
