# Anybox 全球 MoR 申请与落地计划

> 更新日期：2026-07-12  
> 目标平台：Paddle、Creem、Dodo Payments  
> 当前阶段：**主动暂停**（计费策略待定；暂停继续提交申请、KYC 和产品审核）  
> 适用产品：Anybox 开源桌面端 + Anybox Managed AI Provider

## 1. 目标与成功标准

Anybox 桌面软件保持免费、开源。商业收入来自 Anybox 自营的托管 AI 推理服务，而不是出售软件许可证、上游模型账号或 API Key。

本轮申请的成功标准：

1. 以中国大陆个人身份分别完成 Paddle、Creem、Dodo Payments 的账户注册和基础 KYC。
2. 向三家提交完全一致的产品说明，获得关于“托管 AI 推理 + 月度订阅 + 一次性用量包”的书面可接受性确认。
3. 选择一家作为首发 MoR；另外两家只保留为候选，不同时分流交易以规避风控。
4. MoR 负责面向海外客户的支付、销售税/VAT、退款和消费者账单；Anybox 继续负责自身收入所得税、产品交付、内容安全和上游模型合规。
5. 在未获得书面批准前，不把海外 MoR 接入生产环境。

## 2. 当前产品状态与申请风险

在 `C:\Projects\anyboxProvider` 中已确认：

- README 将产品描述为 `prepaid ledger`，并写有微信/支付宝 `recharge flows`。
- 用户界面当前使用“充值余额”表述。
- 当前预设充值档位为 ¥50、¥100、¥300、¥1000，并允许按余额扣减模型调用费用。
- 产品已具备 OAuth、模型路由、用量记录、账本、限流、幂等和上游成本核算等托管服务能力。
- 商业化文档已把用户协议、隐私政策、退款政策、内容安全和中国大陆生成式 AI 合规列为上线前必需项。

以上实现可以作为内部计量账本继续保留，但对外出售“现金等值余额”可能被 MoR 视为储值。申请前需要完成以下重新定义：

- 对外名称由“余额充值”改为“Additional AI Usage Pack / 额外 AI 用量包”。
- 用量单位只能在 Anybox 托管 AI 服务中消费。
- 用量单位不可转让、不可提现、不可兑换现金、不可购买第三方商品或服务。
- 不向用户交付上游 API Key、账号、原始充值码或第三方余额。
- 明确合理有效期、退款规则和订阅取消规则。
- 后端内部即使继续以微美分记账，也不能让用户把它理解为电子钱包。
- 若 MoR 明确禁止一次性预付用量包，首发只上线固定月度订阅和月内配额。

## 3. 统一产品定位

### 3.1 中文定位

Anybox 是一款免费、开源的 AI Agent 桌面工作空间。Anybox Managed AI Provider 是 Anybox 自行运营的托管推理服务，为用户提供统一的身份认证、模型访问、请求路由、用量计量、限流、可靠性和客户支持。用户购买的是 Anybox 服务权益，不是任何第三方模型厂商的账号、API Key、礼品卡或可提现余额。

### 3.2 英文短描述

> Anybox is a free and open-source desktop workspace for AI agents. We operate Anybox Managed AI Provider, our own hosted inference and orchestration service. Customers purchase access to Anybox service plans, not third-party accounts, API keys, gift cards, or cash-equivalent stored value.

### 3.3 英文完整产品说明

> Anybox is a free and open-source desktop workspace for local AI agents. Our paid product is Anybox Managed AI Provider, a hosted inference and orchestration service operated and supported by us. The service provides authentication, model routing, metering, rate limits, reliability controls, abuse prevention, and customer support through the Anybox application.
>
> Customers may purchase a monthly service plan containing non-transferable monthly usage units, or—only if approved by the Merchant of Record—an additional one-time AI usage pack. Usage units can only be consumed within the Anybox managed service. They cannot be transferred, withdrawn, exchanged for cash, used as payment, or used to purchase third-party goods or services.
>
> We do not sell or deliver upstream provider accounts, API keys, gift cards, coupons, or raw third-party credits. We contract with upstream model providers for inference capacity and remain responsible for product delivery, customer support, content and abuse controls, privacy, and compliance with upstream provider terms.

### 3.4 建议行业分类

- Primary：Software as a Service (SaaS)
- Secondary：Developer Tools / Productivity Software / Artificial Intelligence Software
- 不选择：Financial services、stored value、marketplace、gift cards、telecommunications resale

## 4. 建议首发商品结构

### 方案 A：最稳妥的首发结构

- Free：开源客户端，不收费。
- Individual Monthly：固定月费，包含每月不可转让的服务用量；周期结束后不累积。
- Pro Monthly：更高月费、更高月度配额、更高并发或更多模型访问。
- 暂不销售一次性用量包，等 MoR 书面批准后再开启。

### 方案 B：经书面批准后增加

- Additional AI Usage Pack：一次性购买的额外服务单位。
- 只能由购买账户消费。
- 不提现、不转让、不兑换、不作为付款工具。
- 在条款中明确有效期和未消费部分的退款政策。

### 定价占位

申请表如必须填写，可暂用以下区间描述，最终价格上线前另行确认：

- Typical monthly subscription：USD 10–50
- Typical one-time usage pack：USD 5–100
- Expected initial monthly volume：低于 USD 5,000
- Customer type：个人用户、小型开发团队
- Delivery：付款成功后自动开通数字服务权限

## 5. 三平台申请顺序

| 优先级 | 平台 | 本轮目的 | 关键优势 | 主要风险 | 申请入口 |
| --- | --- | --- | --- | --- | --- |
| 1 | Creem | 低成本首发候选 | 中国个人和支付宝结算路径明确；费率较低 | 平台较新；国际结算费和限额 | <https://creem.io/> |
| 2 | Paddle | 成熟首发候选 | SaaS 订阅、税务、退款和失败重试成熟 | AI、储值和第三方服务转售审核严格 | <https://www.paddle.com/> |
| 3 | Dodo Payments | AI 计量候选 | 明确面向 SaaS/AI，支持订阅、用量和 Credits | AI 生成、stored value、resale 仍需人工预审 | <https://dodopayments.com/> |

## 6. 申请资料清单

以下敏感信息不要写进本 Markdown，也不要提交进 Git：

### 个人 KYC

- [ ] 与证件一致的英文姓名和中文姓名
- [ ] 出生日期
- [ ] 中国大陆身份证或护照
- [ ] 居住地址及英文写法
- [ ] 手机号
- [ ] 用于平台管理员的邮箱
- [ ] 自拍或活体认证准备

### 收款与税务

- [ ] 本人银行卡账户信息
- [ ] 支付宝实名认证账户（Creem 中国个人结算可能使用）
- [ ] 平台要求的税务居民声明
- [ ] 如被要求，美国税表通常是个人 W-8BEN；必须按平台引导如实填写
- [ ] 预计交易额、平均客单价、退款率和销售国家

### 产品证明

- [x] 开源仓库：<https://github.com/fanfan-de/anybox>
- [x] 中国主站候选：<https://anybox.com.cn>
- [x] Provider 域名候选：<https://provider.anybox.com.cn>
- [ ] 确认最终用于海外审核的英文产品页 URL
- [ ] 英文定价页
- [ ] Terms of Service
- [ ] Privacy Policy
- [ ] Refund / Cancellation Policy
- [ ] Acceptable Use Policy / AI Content Policy
- [ ] Support 联系方式
- [ ] 可供审核人员登录的演示账号或产品演示视频
- [ ] 上游模型服务的合法采购或协议证明（仅在审核要求时提供）

## 7. 三个平台统一预审邮件

### Subject

`Pre-approval request: managed AI inference subscriptions and non-transferable usage units`

### Body

> Hello Compliance Team,
>
> I am applying as an individual/sole proprietor resident in Mainland China. I operate Anybox, a free and open-source desktop workspace for AI agents, and Anybox Managed AI Provider, our own hosted inference and orchestration service.
>
> Customers purchase access to our managed service. We provide authentication, routing, metering, rate limits, abuse controls, reliability, and customer support. We do not sell or deliver third-party API keys, accounts, gift cards, coupons, or raw third-party credits.
>
> Our planned products are:
>
> 1. Monthly subscriptions that include non-transferable monthly service usage units.
> 2. Optional one-time additional AI usage packs, only if your policy permits them.
>
> Usage units can only be consumed inside our managed Anybox service. They cannot be transferred, withdrawn, exchanged for cash, used as payment, or used to purchase third-party goods or services.
>
> Could you please confirm in writing:
>
> - Whether this product is eligible for your Merchant of Record service.
> - Whether an individual resident in Mainland China can complete onboarding and receive payouts.
> - Whether the monthly subscription model is permitted.
> - Whether one-time, non-transferable AI usage packs are permitted.
> - Whether you require any additional review for AI text/image/model access.
> - Whether you require evidence of agreements with upstream model providers.
>
> Product website: https://anybox.com.cn
>
> Open-source repository: https://github.com/fanfan-de/anybox
>
> I can provide a demo account, product video, policies, and additional technical details upon request.
>
> Best regards,
> [LEGAL NAME]

## 8. 常见审核问题的建议回答

### What are you selling?

> Access to Anybox Managed AI Provider, our hosted SaaS inference and orchestration service. The open-source desktop client is free.

### Are you reselling third-party API keys or accounts?

> No. We do not provide upstream accounts, credentials, API keys, gift cards, or raw provider credits. Users access our managed service through Anybox authentication and endpoints operated by us.

### How is the product delivered?

> Access is provisioned automatically after a successful payment webhook. Customers sign in to Anybox and consume the managed service under the purchased plan.

### Who provides customer support?

> Anybox provides product delivery, billing support coordination, technical support, abuse handling, and account support directly to customers.

### What is your refund policy?

> Customers may request a refund within the stated policy period where required by applicable law. Refund eligibility for consumed usage is assessed according to the published refund policy and mandatory consumer protection rules. The final wording will be published before live sales.

### Do usage units represent money?

> No. Usage units are non-transferable service entitlements used only to meter consumption of Anybox Managed AI Provider. They cannot be withdrawn, transferred, exchanged for cash, or used as a general payment instrument.

### What AI content is prohibited?

> We prohibit illegal content, sexual exploitation, non-consensual intimate content, impersonation and deceptive deepfakes, malware, credential theft, fraud, IP infringement, and attempts to bypass upstream provider safeguards. We apply account controls, rate limits, logging appropriate to privacy requirements, abuse reporting, and suspension procedures.

## 9. 提交前 Go / No-Go 门槛

满足以下条件后才能点击最终产品审核或启用 Live Mode：

- [ ] 产品页不再把海外商品描述为“钱包余额”或现金储值。
- [ ] 英文产品页能够清楚演示服务交付。
- [ ] Terms、Privacy、Refund/Cancellation、Acceptable Use 四类政策公开可访问。
- [ ] 支持邮箱和投诉渠道可用。
- [ ] 已准备真实 KYC 和本人收款账户。
- [ ] 已说明用户不会获得上游 API Key 或账号。
- [ ] 已向平台披露 AI 文本/视觉模型服务，不隐瞒产品类型。
- [ ] 已获得平台对订阅模式的书面批准。
- [ ] 如要销售一次性用量包，已获得对此模式的明确书面批准。
- [ ] 至少完成一次 Sandbox：支付成功、Webhook 幂等、开通权益、取消订阅、退款回收权益。

## 10. 执行计划

### 第 0–2 天：开户与材料准备

- 注册 Paddle、Creem、Dodo Payments 管理员账户。
- 完成邮箱和手机号验证。
- 填写非敏感业务信息。
- 整理 KYC、地址、收款和税务资料。
- 向三家发送统一预审问题。

### 第 2–7 天：产品合规页面

- 发布英文产品说明和定价页。
- 发布服务条款、隐私政策、退款/取消政策和 AI 可接受使用政策。
- 把海外结算商品从“余额充值”调整为“订阅配额/额外用量包”。
- 准备审核演示账号和 2–3 分钟演示视频。

### 第 7–14 天：审核响应

- 在本文档的申请记录中保存平台回复日期和结论，不保存身份证或银行资料。
- 对平台问题如实补充说明。
- 如果平台只批准订阅，不争辩，首发关闭一次性用量包。
- 如果平台认为业务属于 API resale，进一步解释 Anybox 自营网关、计量、支持和内容安全责任；仍不批准则放弃该平台。

### 第 14–28 天：技术集成与首发

- 选择一家主 MoR。
- 抽象统一的 checkout、subscription、entitlement、refund 和 webhook 事件。
- 平台事件只改变购买权益；模型实际消耗仍由 Anybox 内部 usage ledger 记录。
- 完成 Sandbox、退款、取消、重复 Webhook 和支付失败重试测试。
- 小规模邀请制上线，观察退款、拒付、滥用和模型毛利。

## 11. 申请进度表

| 平台 | 账户注册 | 邮箱验证 | KYC | 产品预审 | 收款账户 | Sandbox | Live | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Creem | 已完成（个人商店） | 已完成 | 待开始 | 未提交（合规门槛未满足） | 待开始 | 待开始 | 待开始 | 商店为 `Anybox Managed AI`（`creem.io/anybox-managed-ai`）；审核表停在税务居民国与合规声明，未点击 Next |
| Paddle | 已完成（Live 个人账户） | 已完成 | 进行中（Step 3/5，受阻） | 未提交（合规页面未满足） | 待开始 | 待注册独立 Sandbox 账户 | 待开始 | 已提交主体类型与产品说明；Step 3 强制要求域名、Pricing、Terms、Privacy、Refund 的公开 URL |
| Dodo Payments | 未注册（仅验证过入口） | 待开始 | 待开始 | 待开始 | 待开始 | 待开始 | 待开始 | 可用 Google、GitHub 或邮箱；优先确认 managed inference 不属于禁止的 resale |

### 2026-07-12 浏览器申请记录

- Creem：已使用邮箱 magic link 完成登录，并以个人身份创建 `Anybox Managed AI` 商店，公开地址为 `https://creem.io/anybox-managed-ai`。
- Creem：实时支付入驻已进入 Business Details；主体类型已选择 `Individual`。页面曾选择税务居民国 `China` 并勾选三项合规声明，但未点击 Next、未提交产品审核或 KYC；恢复时必须重新核对页面状态，不默认这些选择仍然有效。
- Creem：当前审核清单要求产品已上线、定价可见、公开 Terms/Privacy/AUP、品牌支持邮箱可用；`https://anybox.com.cn` 当前未显示这些审核页面。`https://provider.anybox.com.cn` 当前仍使用“充值余额”、模型价格和 API 文档表述，需要先按本计划改为订阅配额/额外用量包并补齐英文审核页。
- Creem：官方规则将 API resellers 列为受限业务；同时，Anybox 代码与产品设计包含文本生成图片/视频能力。若 Managed AI Provider 向付费用户提供提示词生图或生视频，申请前还必须按 Creem AI Wrapper Compliance 要求在生产环境接入 Creem Moderation API，并公开对应 AUP/内容政策。
- Paddle：注册时已选择 `Digital products or SaaS`，并在本人确认后接受 AUP、Terms 和 Privacy。
- Paddle：当前 AUP 未全面禁止托管 AI SaaS，但禁止虚拟货币/储值（包括 store credit、gift cards、vouchers），并限制真人脸生成、换脸、深伪、声音冒充和未经同意使用他人形象。申请和产品页面仍需避免“可提现/可转让余额”表述，并披露内容安全控制。
- Paddle：已完成 Live 账户注册和邮箱验证，商家名称为 `Anybox`，主体按个人路径注册，年收入状态选择 `Not yet live`，已进入供应商主界面。
- Paddle：Live 验证共 5 步；Step 1 已选择并提交 `China + 个体工商户 / Single ownership business`。Paddle 官方说明 business registration documents 对 individuals / sole traders 不要求；若主体类型不完全匹配，可在后续补充说明或联系 `sellers@paddle.com`。
- Paddle：账户验证提交前要求网站公开 Terms of Service、Privacy Policy、Refund Policy、与 Paddle Catalog 一致的定价，以及首页可访问的联系邮箱/表单；Live checkout 还必须通过域名审批。当前 Anybox 公共站点未满足这些门槛，暂不提交产品/域名审核。
- Paddle：Sandbox 使用独立账户，Live 登录不能直接复用；Sandbox 注册页已确认，但尚未创建第二个账户。
- Paddle：验证 Step 1 已提交 `China + Single ownership business`；Step 2 已提交托管 SaaS 产品说明、`Not yet live` 和 AUP 声明。产品说明限定 Paddle 仅销售月度订阅，不销售第三方账号、API Key、礼品卡、可转让 credits 或储值余额。
- Paddle：当前停在 Step 3/5 `Tell us about your website`。页面强制要求 Web domain、Pricing page、Terms of Service、Privacy Policy、Refund Policy 的公开 URL；在这些页面上线前不填写占位链接、不继续提交。
- Dodo Payments：官方注册页 `https://app.dodopayments.com/signup` 已验证，支持 Google、GitHub 或邮箱注册；建议优先使用长期持有的独立业务邮箱，避免绑定临时或不可持续账号。
- 已向 Creem 提交登录邮箱；已在 Paddle 注册流程提交账户联系方式、姓名、主体类型和地址，但本文件不记录具体敏感值。尚未向任何平台提交身份证件、护照、自拍/活体、税务、银行或收款资料；尚未提交 Live 产品审核。

## 12. 最终选择规则

按以下权重选择，不只比较费率：

| 维度 | 权重 |
| --- | ---: |
| 对业务模型的书面批准清晰度 | 30% |
| 中国大陆个人 KYC 与结算可行性 | 20% |
| 订阅、取消、退款和失败重试能力 | 15% |
| 综合交易与结算成本 | 15% |
| API、Webhook、Sandbox 和文档质量 | 10% |
| 风控稳定性、客服和平台成熟度 | 10% |

若多家均批准：成熟度优先选 Paddle；成本和大陆个人结算优先选 Creem；复杂 AI 用量计费能力明显更强且条款批准清晰时选 Dodo Payments。

## 13. 法务与安全说明

- MoR 处理的是客户交易中的支付、销售税/VAT、退款和部分消费者合规，不替代经营者在中国的个人所得税、经营登记、数据和生成式 AI 服务合规义务。
- 不在仓库、Issue、截图或本文件中保存身份证、银行卡、护照、税号、自拍、验证码或登录密码。
- 不使用虚假新加坡地址、代持身份、借用公司或不真实的业务描述通过 KYC。
- 不同时使用多个账户或代理商户绕过平台审核。
- 本文档是产品和申请执行计划，不构成法律或税务意见。

## 14. 2026-07-12 暂停记录与恢复入口

### 14.1 暂停决定

本轮 MoR 申请由申请人主动暂停，原因是 Anybox Managed AI Provider 的计费策略尚未想清楚。暂停期间：

- 不继续任何平台的 KYC、产品审核、域名审核或收款账户绑定。
- 不创建 Paddle Sandbox、Paddle Catalog 或 Live Checkout。
- 不向 Creem 点击 Business Details 的 Next，也不提交合规声明或实时支付审核。
- 不注册 Dodo Payments。
- 不为了赶审核而发布占位定价、虚假政策页面或与实际产品不一致的商品说明。

### 14.2 暂停时的准确断点

#### Creem

- 个人账户和邮箱验证已完成。
- 商店 `Anybox Managed AI` 已创建，地址为 `https://creem.io/anybox-managed-ai`。
- Business Details 已选择 `Individual`；停在税务居民国与三项合规声明页面，未点击 Next。
- 未提交 KYC、产品审核、收款账户、Sandbox 或 Live。
- 恢复前必须先满足公开定价、Terms、Privacy、AUP、品牌支持邮箱，以及根据实际生图/生视频能力判断是否接入 Creem Moderation API。

#### Paddle

- Live 个人账户、邮箱验证和主界面登录已完成。
- 注册信息中已选择 `Digital products or SaaS`、`Individual`、`Not yet live`，商家名称为 `Anybox`。
- Live 验证 Step 1 已提交 `China + Single ownership business`。
- Step 2 已提交托管 SaaS 产品说明、`Not yet live` 和 AUP 声明；已声明 Paddle 仅销售月度订阅，不销售第三方账号、API Key、礼品卡、可转让 credits 或储值余额。
- 当前停在 Step 3/5 `Tell us about your website`；Web domain、Pricing、Terms、Privacy、Refund URL 尚未填写和提交。
- 未提交身份证件、自拍/活体、税务或收款账户；未做域名审批、产品目录、Checkout 或 Live 测试。
- Paddle Sandbox 需要独立账户，目前只验证了注册入口，尚未创建。

#### Dodo Payments

- 仅验证过官方注册入口和可用登录方式。
- 未注册账户，未提交邮箱、个人信息、KYC、产品审核或收款资料。

### 14.3 恢复申请前必须先确定的计费策略

1. 海外首发是否只提供固定月度订阅，还是还需要一次性额外用量包。
2. 月度配额是否到期清零、是否滚存，以及超额后是停止服务、自动升级还是按量后付费。
3. 用户界面展示的是订阅配额、服务用量单位还是货币余额；不得让海外商品看起来像可提现、可转让或现金等价储值。
4. 套餐层级、价格、币种、模型范围、并发限制和合理使用上限。
5. 取消、退款、已消费用量和未消费用量的处理规则。
6. 国内现有微信/支付宝“充值余额”路径是否与海外商品完全隔离，以及海外页面如何避免产生 API resale / stored value 误解。
7. 付费服务是否包含文生图或文生视频；如果包含，需要确定内容审核、禁止内容和 Creem Moderation API 的落地范围。
8. 首选 MoR 与候选 MoR 的优先顺序，避免在多平台同时提交互相矛盾的商品结构。

### 14.4 建议恢复顺序

1. 先确认计费策略并更新本计划第 3、4、7、8 节的统一产品说明。
2. 在现有 `anybox.com.cn` 上发布可供海外审核访问的英文产品页、Pricing、Terms、Privacy、Refund、AUP 和 Contact 页面；可继续部署在腾讯云，无需为了 MoR 单独购买域名。
3. 调整 `provider.anybox.com.cn` 的“充值余额”、模型价格和 API 文档表述，使海外商品与最终计费策略一致。
4. 重新核对三家平台当时有效的 AUP、AI、credits/stored value 和中国大陆个人结算政策，不沿用本次浏览结果作为永久结论。
5. 优先从 Paddle Step 3/5 继续填写已上线的真实 URL；随后创建并完成 Paddle Sandbox。
6. 再回到 Creem 重新核对税务居民国、三项声明和 Moderation API 条件，满足后才点击 Next。
7. 最后决定是否注册 Dodo Payments，避免在计费策略未定时重复提交第三套申请。

下次可直接从本节继续，不需要重新创建 Creem 或 Paddle Live 账户。
