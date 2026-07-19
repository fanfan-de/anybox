# 节点 11：Extension Command Executor

[上一节点：Extension Service Worker](./10-extension-service-worker-and-client.md) ·
[返回总览](./README.md) ·
[下一节点：Overlay 与 Popup](./12-content-overlay-and-popup.md)

## 1. 这是最终浏览器执行边界

源码：

[`browser-extension/src/background/commands.ts`](../../browser-extension/src/background/commands.ts)

这个节点接收经过 Agent 验证的 command，但仍不盲目信任上游：

```text
解析 Contract method
  → 再次 parse params
  → 执行固定 handler
  → 再次 parse result
```

然后 Service Worker 才把 result 送回 Agent。

## 2. 命令与 Chrome API 映射

| Contract method | 主要实现 |
| --- | --- |
| `tabs.list` | `chrome.tabs.query({})` |
| `tabs.open` | `chrome.tabs.create(...)` |
| `tabs.activate` | `chrome.tabs.update(...)` + best-effort `chrome.windows.update(...)` |
| `tabs.release` | Extension fallback 返回 `released:false`；新主路径不转发到这里 |
| `page.snapshot` | `chrome.scripting.executeScript` 注入固定读取函数 |
| `page.interactiveSnapshot` | `executeScript` 扫描元素并写 `data-anybox-element-id` |
| `page.domTree` | 固定 `DOM.enable` + `DOM.getDocument` |
| `page.accessibilityTree` | 固定 `Accessibility.*`，辅以固定 `DOM.*` |
| `page.screenshot` | 固定 `Page.captureScreenshot` |
| `page.click` | 固定 `Input.dispatchMouseEvent` |
| `page.clickElement` | `executeScript` 找元素中心 + 固定 CDP mouse events |
| `page.fill` | `executeScript` 调用 value setter / 更新 contenteditable |
| `page.type` | 固定 `Input.insertText` |
| `page.scroll` | `executeScript` 调用 `window.scrollBy` |
| `page.waitFor` | 每 250ms 查询 tab URL或注入固定条件检查函数 |

模型不能提供 CDP method 名或任意注入函数；代码中的 CDP method 是固定的。

## 3. tabId 解析

内部 helper `activeTabId(rawTabId)`：

```text
合法正整数 tabId → 使用它
否则              → 当前窗口 active tab
再否则            → 任意第一个 tab
都没有            → error
```

当前 Contract v1 对几乎所有 page/tab 操作要求正整数 tabId，所以新 Runtime 主路径会在
到达 Extension 前已经拒绝缺失值。fallback 主要服务旧协议兼容和内部防御。

## 4. tab metadata 与 URL 脱敏

`tabs.list` 查询全部 Chrome tabs，并把当前窗口 active tab 排到结果前面。

返回字段：

```text
id / windowId / title / redacted url / active
```

URL 脱敏规则大致为：

| 原 URL 类型 | 返回 |
| --- | --- |
| `https://host/` | 保留 origin 和 `/` |
| `https://host/private/path?q=1#x` | `https://host/[redacted-path]?[redacted]#[redacted]` |
| `chrome://host/path` | 保留 protocol/host，隐藏 path/query/hash |
| `file://...` | `[redacted-url]` |
| `about:blank` | 原样 |
| 其他或无法解析 | `[redacted-url]` |

页面 title 当前不做同类脱敏。

## 5. 普通 snapshot

`page.snapshot`：

1. 读取 tab info；
2. 注入固定函数；
3. 提取 `document.body.innerText`；
4. 最多返回默认 20000、上限 100000 字符；
5. 最多收集 80 个 link、button、input；
6. 执行表单值与 URL 脱敏；
7. 返回 `truncated`。

敏感字段识别综合：

- `type=password/hidden`；
- name/id/autocomplete/placeholder；
- aria-label/title/label text；
- 英文 token/password/card/cvv/otp 等模式；
- 中文“验证码、密码、口令、令牌、银行卡、卡号、安全码、一次性”等模式。

它会收集 input/textarea/select/contenteditable/textbox 的当前私有值，并尝试从
`body.innerText` 中替换成 `[redacted]`。

返回的 input `value` 主动省略；敏感 input 只返回 `{sensitive:true}`。

这是一套启发式脱敏，不是完整 DLP。页面上与表单无关但本身敏感的普通文本仍可能出现在
snapshot 中。

## 6. interactive snapshot 与 elementId

扫描 selector：

```text
a[href], button, input, textarea, select,
[role=button], [role=link], [role=textbox],
[contenteditable], [tabindex]
```

只保留有尺寸、非 hidden/display:none 的元素，默认最多 200、上限 500。

每个元素返回：

```text
elementId
role / tag
name / text / href / type / placeholder / value
disabled / visible / sensitive
rect {x,y,width,height}
```

为让后续命令稳定找到元素，它会直接在真实页面 DOM 写入：

```html
data-anybox-element-id="anybox-<time>-<index>-<random>"
```

重要性质：

- 已存在 attribute 会复用；
- 没有全局清理步骤；
- DOM 重渲染后 elementId 可能失效；
- elementId 只标识当时那个 DOM element，不包含 document generation；
- 自定义控件不匹配 selector 时不会被发现。

对 input、textarea、select、textbox、contenteditable 等 private-value 元素，会省略
其 text/value，并避免 name/placeholder 间接包含私有值。

## 7. DOM tree

`page.domTree` 使用：

```text
chrome.debugger.attach(tab, "1.3")
DOM.enable
DOM.getDocument({depth, pierce})
```

默认：

```text
maxDepth = 6
maxNodes = 1000
pierce = true
includeText = true
includeAttributes = true
```

硬上限：

```text
depth ≤ 20
nodes ≤ 5000
```

归一化时保留：

- child；
- shadowRoot；
- contentDocument；
- templateContent；
- pseudoElement；
- nodeId/backendNodeId/type/name/localName；
- bounded nodeValue/attributes。

脱敏：

- 敏感节点及其继承区域的值变 `[redacted]`；
- input-like/private-value 节点的 value/text 被隐藏；
- URL-bearing attribute 做 URL 脱敏；
- 单项文本截到 500 字符；
- 达到节点上限置 `truncated=true`。

## 8. Accessibility tree

固定调用：

```text
Accessibility.enable
Accessibility.getFullAXTree({depth})
```

然后尽量再取 DOM tree，把 `backendDOMNodeId` 映射到 DOM 敏感元数据。

隐私策略：

- DOM 标记为 sensitive/private 的 AX 节点脱敏；
- role 为 textbox/searchbox/combobox/spinbutton 或 editable 的节点视作 private；
- private 节点的后代也加入脱敏集合；
- name/value/description/properties/ignoredReasons 替换为 `[redacted]`；
- URL 类型 property 脱敏。

默认不包含 ignored 节点，最大 depth 30、nodes 5000。过滤或截断后重新建立最近保留父子
关系。

DOM 辅助查询失败不会让 AX 命令整体失败；它会使用 role/editable fallback。

## 9. screenshot

固定调用：

```text
Page.captureScreenshot({
  format: "png",
  fromSurface: true,
  captureBeyondViewport: fullPage
})
```

返回：

```json
{
  "tabId": 123,
  "mime": "image/png",
  "data": "<base64>"
}
```

截图没有字段级脱敏，是页面当时的真实视觉内容，可能包含账号、聊天、表单值或其他敏感
信息。上游把 screenshot 分类为 `page-content-read`，但当前 Policy 尚未执行逐动作批准。

## 10. 坐标点击

`page.click` 用固定 CDP：

```text
Input.dispatchMouseEvent mousePressed
Input.dispatchMouseEvent mouseReleased
```

坐标是 viewport CSS 坐标，button 为 left/right/middle。它不在点击后自动验证页面是否
发生预期变化。

成功后 best-effort 通知 content script 显示控制提示。

## 11. element 点击

`page.clickElement`：

1. 注入函数按 `data-anybox-element-id` 查找；
2. 检查 disabled / aria-disabled；
3. `scrollIntoView({block:"center",inline:"center"})`；
4. 读取新的中心坐标；
5. CDP mouseMoved/Pressed/Released；
6. 返回最新 tab title 和脱敏 URL。

它不是直接执行 DOM `element.click()`，而是在解析 element 后模拟真实坐标鼠标事件。

如果 elementId stale，会明确要求重新运行 interactive snapshot。

## 12. fill

`page.fill` 按 elementId 查找并 focus：

### input / textarea

调用原型上的原生 `value` setter，然后派发 bubbling：

```text
input
change
```

### select

设置 `value`，派发 `input/change`。

### contenteditable

设置 `textContent`，派发 `InputEvent(inputType="insertText")`。

其他元素返回 not fillable。

返回只包含 `textLength`，不回显填入内容。它仍可能无法正确驱动依赖特殊
beforeinput/composition/内部 state 的富文本编辑器。

## 13. type

`page.type` 使用固定：

```text
Input.insertText({text})
```

目标是当前已经 focus 的元素。它不会自己寻找 element，也不会按键逐个产生 keyboard
down/up 序列。调用前必须确保 focus 正确。

## 14. scroll

注入：

```js
window.scrollBy(scrollX, scrollY)
```

返回请求 delta 与执行后的 `window.scrollX/window.scrollY`。它只滚动主 window，不会
自动寻找内部 scroll container。

## 15. waitFor

至少提供一个：

```text
text
urlIncludes
selector
elementId
```

每 250ms：

1. 用 `chrome.tabs.get` 检查 raw tab URL 是否包含 substring；
2. 注入固定函数检查 body text、CSS selector 或 elementId attribute。

最长 60 秒。匹配时返回：

```text
matched = true
reason  = 具体匹配原因
```

超时时正常返回：

```text
matched = false
reason  = Timed out.
```

因此调用成功不代表条件成功，必须读取 `matched`。

`urlIncludes` 的比较发生在 Extension 内部 raw URL 上，但返回给模型的 URL仍经过脱敏。

## 16. debugger attachment 生命周期

需要 CDP 的命令先：

```js
chrome.debugger.attach({tabId}, "1.3")
```

Extension 内存 `attachedTabs Set` 避免重复 attach。Chrome 发 `debugger.onDetach` 时从 Set
删除。

当前：

- 遇到其他 debugger 已 attached 会失败；
- `tabs.release` 不 detach；
- 没有独立 public detach command；
- attach 可跨多条命令复用，直到 Chrome/Extension 断开。

## 17. raw JavaScript 与 raw CDP 的最后一道拒绝

Dispatcher 对 Contract method 执行固定 switch。若收到兼容枚举中的：

```text
page.executeScript
cdp.send
```

明确抛：

```text
COMMAND_NOT_SUPPORTED
arbitrary page JavaScript and raw CDP are not extension capabilities
```

所以 `chrome.scripting.executeScript` 的存在不意味着模型能提供任意 function；模型只
能触发源码中固定的函数。

## 18. Chrome 自身限制仍然有效

即使 manifest 有 `<all_urls>`：

- Chrome 内部受保护页面可能不允许 scripting/debugger；
- Chrome Web Store 等页面可能受额外限制；
- 另一个 debugger/DevTools attachment 可能冲突；
- 页面导航、frame 生命周期或 CSP/浏览器规则可能让动作失败。

Extension 不会绕过 Chrome 的平台限制。错误沿 result → Bridge → Agent Gateway 返回。

## 19. 当前隐私边界总结

已做：

- URL path/query/hash 脱敏；
- form/private value 启发式脱敏；
- DOM/AX bounded extraction；
- input value 不回显；
- fill/type 只返回长度；
- raw JavaScript/CDP 禁用。

仍需正确理解：

- screenshot 完全未脱敏；
- title 未做通用脱敏；
- body 普通文本可能包含敏感信息；
- 规则是启发式，不保证识别所有站点/语言/自定义组件；
- `<all_urls>` 和 tabs 列表意味着 backend 能看到用户所有普通 Chrome tabs；
- ownership 和逐动作 approval 当前未强制。

本节点执行完成后，result 沿 Service Worker → Rust Host → Agent Bridge → Command
Gateway → Runtime → Node REPL 原路返回。

