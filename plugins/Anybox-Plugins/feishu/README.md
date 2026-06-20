# Feishu Anybox Plugin

This package connects Anybox to Feishu Open Platform through a Feishu custom app.

## Required Feishu Setup

Create a Feishu custom app, then copy these values into the plugin connection form:

- `FEISHU_APP_ID`: the app ID, usually starting with `cli_`.
- `FEISHU_APP_SECRET`: the app secret, stored as a connector credential.
- `FEISHU_BASE_URL`: defaults to `https://open.feishu.cn`. Use `https://open.larksuite.com` for Lark workspaces.

The app must be granted the Open Platform permissions required by the tools you use, such as contact lookup, chat read, message read, and bot message send permissions. The bot must also be available to the target user or chat before it can send messages.

## Tools

- `feishu_test_auth`: fetches a tenant access token to validate credentials.
- `feishu_lookup_user_ids`: resolves user IDs from email addresses or mobile numbers.
- `feishu_list_chats`: lists chats visible to the app.
- `feishu_get_chat`: reads one chat's details.
- `feishu_list_messages`: reads recent messages from a chat or thread.
- `feishu_send_text`: sends a plain text bot message.
- `feishu_send_message`: sends a supported Feishu message type with a prepared content object.

## Notes

The connector uses Feishu's internal tenant access token API for self-built apps. It does not store access tokens in the repository; tokens are fetched at runtime and cached in memory until expiry.
