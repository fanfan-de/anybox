import QRCode from "qrcode"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  DesktopRechargeOrderResponse,
  DesktopRechargePaymentOrder,
  DesktopSubscriptionLimit,
  DesktopSubscriptionOrderResponse,
  DesktopSubscriptionOverview,
  DesktopSubscriptionPaymentOrder,
  DesktopSubscriptionPaymentProvider,
  DesktopSubscriptionPlan,
  DesktopSubscriptionUpgradeDetail,
  DesktopSubscriptionUpgradeQuote,
} from "../../../../shared/desktop-ipc-contract"
import { useI18n } from "../i18n/I18nProvider"
import { useToast } from "../toast"
import { openExternalUrl } from "./client"

interface SubscriptionSettingsPanelProps {
  accountBusy: boolean
  connected: boolean
  onSignIn: () => void
}

const terminalOrderStatuses = new Set(["paid", "failed", "expired", "canceled"])
const rechargePresetAmountCents = [5_000, 10_000, 30_000, 100_000] as const
const serializedProviderErrorPrefix = "ANYBOX_PROVIDER_ERROR:"

function rechargeAmountInputFromCents(amountCents: number) {
  return String(amountCents / 100)
}

function typedProviderErrorCode(error: unknown, seen = new Set<object>()): string | null {
  if (!error || typeof error !== "object" || seen.has(error)) return null
  seen.add(error)
  const candidate = error as Record<string, unknown>
  if (typeof candidate.code === "string" && candidate.code.trim()) return candidate.code.trim()
  return typedProviderErrorCode(candidate.error, seen) ?? typedProviderErrorCode(candidate.cause, seen)
}

function rechargeCancelErrorCode(error: unknown) {
  const typedCode = typedProviderErrorCode(error)
  if (typedCode) return typedCode
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  const serializedCode = message.match(new RegExp(`${serializedProviderErrorPrefix}([a-z][a-z0-9_]*)`, "i"))?.[1]
  return serializedCode?.toLowerCase() ?? null
}

function rechargeCancelErrorKey(error: unknown) {
  switch (rechargeCancelErrorCode(error)) {
    case "recharge_order_close_failed":
      return "settings.subscription.endRechargeOrderCloseFailed" as const
    case "recharge_order_initializing":
      return "settings.subscription.endRechargeOrderInitializing" as const
    case "recharge_order_not_cancelable":
      return "settings.subscription.endRechargeOrderNotCancelable" as const
    case "recharge_order_not_found":
      return "settings.subscription.endRechargeOrderNotFound" as const
    case "recharge_order_already_paid":
      return "settings.subscription.endRechargeOrderPaymentMayBeComplete" as const
    case "invalid_token":
      return "settings.subscription.endRechargeOrderSignInRequired" as const
    case "email_not_verified":
      return "settings.subscription.endRechargeOrderEmailVerificationRequired" as const
    case "rate_limit_exceeded":
      return "settings.subscription.endRechargeOrderRateLimited" as const
    default:
      return "settings.subscription.endRechargeOrderFailed" as const
  }
}

function readableDesktopError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : fallback
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .replace(/^ANYBOX_PROVIDER_ERROR:[a-z][a-z0-9_]*:\s*/i, "")
    .trim()
  return message || fallback
}

type SubscriptionOrderKind = "purchase" | "upgrade"

type SubscriptionPaymentIntent =
  | {
      kind: "purchase"
      plan: DesktopSubscriptionPlan
      replacingOrder?: DesktopSubscriptionPaymentOrder
    }
  | {
      kind: "upgrade"
    }

function formatMoneyFromCents(value: number, currency = "CNY") {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100)
}

function formatMoneyFromMicrocents(value: number, currency = "CNY") {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100_000_000)
}

function weeklyQuotaLimit(overview: DesktopSubscriptionOverview) {
  return overview.limits.find((limit) => limit.type === "weekly")
}

function quotaTotal(limit: DesktopSubscriptionLimit) {
  return Math.max(limit.limitMicrocents + limit.adjustmentMicrocents, 0)
}

function quotaRemainingPercent(limit: DesktopSubscriptionLimit) {
  const total = quotaTotal(limit)
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (limit.remainingMicrocents / total) * 100))
}

function formatPercent(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value / 100)
}

function quotaUsed(limit: DesktopSubscriptionLimit) {
  return Math.max(quotaTotal(limit) - limit.remainingMicrocents, 0)
}

function formatResetTime(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function SubscriptionSettingsPanel({
  accountBusy,
  connected,
  onSignIn,
}: SubscriptionSettingsPanelProps) {
  const { t } = useI18n()
  const toast = useToast()
  const paidOrderRef = useRef<string | null>(null)
  const [overview, setOverview] = useState<DesktopSubscriptionOverview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<DesktopSubscriptionPaymentProvider | null>(null)
  const [paymentIntent, setPaymentIntent] = useState<SubscriptionPaymentIntent | null>(null)
  const [creatingOrder, setCreatingOrder] = useState<{ kind: SubscriptionOrderKind; planVersionId: string } | null>(null)
  const [quotingPlanVersionId, setQuotingPlanVersionId] = useState<string | null>(null)
  const [upgradeQuote, setUpgradeQuote] = useState<DesktopSubscriptionUpgradeQuote | null>(null)
  const [orderResponse, setOrderResponse] = useState<DesktopSubscriptionOrderResponse | null>(null)
  const [orderPlanVersionId, setOrderPlanVersionId] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const loadOverview = useCallback(async () => {
    const load = window.desktop?.getAnyboxSubscriptionOverview
    if (!load) {
      setError(t("settings.subscription.unavailable"))
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const nextOverview = await load()
      setOverview(nextOverview)
      if (nextOverview.pendingOrder) {
        const pendingOrder = nextOverview.pendingOrder
        setProvider(null)
        setPaymentIntent(null)
        setOrderPlanVersionId(nextOverview.pendingOrderPlanVersionId ?? null)
        setOrderResponse((current) => current?.order.id === pendingOrder.id
          ? current
          : { order: pendingOrder, upgrade: nextOverview.pendingUpgrade })
      } else {
        setOrderPlanVersionId(null)
        setOrderResponse((current) => current && terminalOrderStatuses.has(current.order.status) ? current : null)
      }
    } catch (loadError) {
      setError(readableDesktopError(loadError, t("settings.subscription.loadFailed")))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!upgradeQuote && !paymentIntent) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || creatingOrder) return
      if (paymentIntent) {
        setPaymentIntent(null)
        setProvider(null)
      } else {
        setUpgradeQuote(null)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [creatingOrder, paymentIntent, upgradeQuote])

  useEffect(() => {
    if (!connected) {
      setOverview(null)
      setOrderResponse(null)
      setOrderPlanVersionId(null)
      setPaymentIntent(null)
      setProvider(null)
      return
    }
    void loadOverview()
  }, [connected, loadOverview])

  const order = orderResponse?.order ?? null

  useEffect(() => {
    if (order?.provider !== "wechat_pay" || !order.codeUrl) {
      setQrDataUrl(null)
      return
    }
    let disposed = false
    void QRCode.toDataURL(order.codeUrl, {
      scale: 8,
      margin: 1,
      errorCorrectionLevel: "M",
    }).then((dataUrl) => {
      if (!disposed) setQrDataUrl(dataUrl)
    }).catch(() => {
      if (!disposed) setQrDataUrl(null)
    })
    return () => {
      disposed = true
    }
  }, [order?.codeUrl, order?.provider])

  useEffect(() => {
    if (!order || terminalOrderStatuses.has(order.status)) return
    const getOrder = window.desktop?.getAnyboxSubscriptionOrder
    if (!getOrder) return
    const timer = window.setInterval(() => {
      void getOrder({ orderId: order.id }).then((result) => {
        if (result.order.status === "canceled") {
          setOrderResponse(null)
          setOrderPlanVersionId(null)
          setPaymentIntent(null)
          setProvider(null)
          setCancelError(null)
          void loadOverview()
          return
        }
        setOrderResponse(result)
        if (result.order.status === "paid" && paidOrderRef.current !== result.order.id) {
          paidOrderRef.current = result.order.id
          void loadOverview()
        }
      }).catch((pollError) => {
        setError(readableDesktopError(pollError, t("settings.subscription.paymentStatusFailed")))
      })
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [loadOverview, order, t])

  const currency = overview?.currency ?? overview?.subscription?.currency ?? overview?.plans[0]?.currency ?? "CNY"
  const hasActiveSubscription = overview?.subscription?.status === "active"
  const currentPlanVersion = overview?.subscription?.planVersion
  const currentPlanCode = overview?.subscription?.planCode
  const sortedPlans = useMemo(
    () => [...(overview?.plans ?? [])].sort((left, right) => left.priceCents - right.priceCents),
    [overview?.plans],
  )
  const weeklyLimit = useMemo(
    () => overview && hasActiveSubscription ? weeklyQuotaLimit(overview) : undefined,
    [hasActiveSubscription, overview],
  )
  const weeklyRemainingPercent = weeklyLimit ? quotaRemainingPercent(weeklyLimit) : 0
  function closePaymentMethodDialog() {
    if (creatingOrder) return
    setPaymentIntent(null)
    setProvider(null)
  }

  function beginPayment(plan: DesktopSubscriptionPlan) {
    setPaymentIntent({ kind: "purchase", plan })
    setProvider(null)
    setError(null)
    setCancelError(null)
  }

  function beginPaymentMethodChange() {
    if (!order || terminalOrderStatuses.has(order.status) || order.purpose === "subscription_renewal") return
    const plan = sortedPlans.find((candidate) => candidate.planVersionId === orderPlanVersionId)
    if (!plan) {
      setError(t("settings.subscription.changePaymentMethodUnavailable"))
      return
    }
    setPaymentIntent({
      kind: "purchase",
      plan,
      replacingOrder: order,
    })
    setProvider(null)
    setError(null)
    setCancelError(null)
  }

  async function cancelOrder() {
    if (!order || terminalOrderStatuses.has(order.status)) return
    const cancel = window.desktop?.cancelAnyboxSubscriptionOrder
    if (!cancel) {
      setCancelError(t("settings.subscription.cancelOrderUnavailable"))
      return
    }
    setCancelingOrderId(order.id)
    setCancelError(null)
    setError(null)
    try {
      const result = await cancel({ orderId: order.id })
      setQrDataUrl(null)
      setOrderResponse(null)
      setOrderPlanVersionId(null)
      setPaymentIntent(null)
      setProvider(null)
      await loadOverview()
      toast.success(t(result.order.status === "canceled"
        ? "settings.subscription.orderCanceled"
        : "settings.subscription.orderEnded"))
    } catch (cancelOrderError) {
      const fallback = cancelOrderError instanceof Error
        ? cancelOrderError.message
        : t("settings.subscription.cancelOrderFailed")
      const getOrder = window.desktop?.getAnyboxSubscriptionOrder
      if (!getOrder) {
        setCancelError(fallback)
        return
      }
      try {
        const latest = await getOrder({ orderId: order.id })
        if (latest.order.status === "paid") {
          setOrderResponse(latest)
          await loadOverview()
          toast.info(t("settings.subscription.cancelOrderAlreadyPaid"))
        } else if (terminalOrderStatuses.has(latest.order.status)) {
          setOrderResponse(null)
          setOrderPlanVersionId(null)
          setPaymentIntent(null)
          setProvider(null)
          await loadOverview()
          toast.info(t("settings.subscription.orderEnded"))
        } else {
          setOrderResponse(latest)
          setCancelError(fallback)
        }
      } catch {
        setCancelError(fallback)
      }
    } finally {
      setCancelingOrderId(null)
    }
  }

  async function createOrder(intent: Extract<SubscriptionPaymentIntent, { kind: "purchase" }>) {
    if (!provider) return
    const { plan, replacingOrder } = intent
    const createPurchase = window.desktop?.createAnyboxSubscriptionOrder
    if (!createPurchase) {
      setError(t("settings.subscription.unavailable"))
      setPaymentIntent(null)
      setProvider(null)
      return
    }
    setCreatingOrder({ kind: "purchase", planVersionId: plan.planVersionId })
    setError(null)
    setCancelError(null)
    try {
      const replacement = replacingOrder ? { replaceOrderId: replacingOrder.id } : {}
      const result = await createPurchase({ planVersionId: plan.planVersionId, provider, ...replacement })
      paidOrderRef.current = null
      setOrderResponse(result)
      setOrderPlanVersionId(plan.planVersionId)
      setPaymentIntent(null)
      setProvider(null)
      if (result.order.provider === "alipay" && result.order.codeUrl) {
        await openExternalUrl(result.order.codeUrl)
      }
    } catch (createError) {
      setError(createError instanceof Error
        ? createError.message
        : t("settings.subscription.createOrderFailed"))
      setPaymentIntent(null)
      setProvider(null)
    } finally {
      setCreatingOrder(null)
    }
  }

  async function requestUpgradeQuote(plan: DesktopSubscriptionPlan) {
    const createQuote = window.desktop?.createAnyboxSubscriptionUpgradeQuote
    if (!createQuote) {
      setError(t("settings.subscription.unavailable"))
      return
    }
    setQuotingPlanVersionId(plan.planVersionId)
    setError(null)
    try {
      const result = await createQuote({ planVersionId: plan.planVersionId })
      setUpgradeQuote(result.quote)
    } catch (quoteError) {
      setError(readableDesktopError(quoteError, t("settings.subscription.createUpgradeQuoteFailed")))
    } finally {
      setQuotingPlanVersionId(null)
    }
  }

  async function createUpgradeOrder() {
    if (!upgradeQuote || !provider) return
    const createUpgrade = window.desktop?.createAnyboxSubscriptionUpgradeOrder
    if (!createUpgrade) {
      setError(t("settings.subscription.unavailable"))
      setUpgradeQuote(null)
      setPaymentIntent(null)
      setProvider(null)
      return
    }
    setCreatingOrder({ kind: "upgrade", planVersionId: upgradeQuote.targetPlanVersionId })
    setError(null)
    try {
      const result = await createUpgrade({ quoteId: upgradeQuote.id, provider })
      paidOrderRef.current = null
      setOrderResponse(result)
      setUpgradeQuote(null)
      setPaymentIntent(null)
      setProvider(null)
      if (result.order.provider === "alipay" && result.order.codeUrl) {
        await openExternalUrl(result.order.codeUrl)
      }
    } catch (createError) {
      setUpgradeQuote(null)
      setPaymentIntent(null)
      setProvider(null)
      setError(readableDesktopError(createError, t("settings.subscription.createUpgradeOrderFailed")))
      void loadOverview()
    } finally {
      setCreatingOrder(null)
    }
  }

  if (!connected) {
    return (
      <div className="settings-subscription-layout">
        <section className="settings-panel settings-subscription-empty" aria-label={t("settings.subscription.title")}>
          <h3>{t("settings.subscription.signInTitle")}</h3>
          <p>{t("settings.subscription.signInCopy")}</p>
          <button className="primary-button" type="button" disabled={accountBusy} onClick={onSignIn}>
            {t("settings.account.signIn")}
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="settings-subscription-layout">
      {error ? <div className="settings-banner is-error">{error}</div> : null}

      <section className="settings-subscription-summary" aria-label={t("settings.subscription.summary")}>
        <header className="settings-subscription-summary-header">
          <div>
            <h3>{t("settings.subscription.remainingCredits")}</h3>
            <span>
              {overview?.subscription?.planName ?? t("settings.subscription.noPlan")}
              {overview?.subscription?.currentPeriodEndsAt
                ? ` · ${t("settings.subscription.periodEnds", {
                    time: formatResetTime(overview.subscription.currentPeriodEndsAt) ?? "—",
                  })}`
                : ""}
              {overview?.subscription?.upcomingPeriodEndsAt
                ? ` · ${t("settings.subscription.renewedUntil", {
                    time: formatResetTime(overview.subscription.upcomingPeriodEndsAt) ?? "—",
                  })}`
                : ""}
            </span>
          </div>
          <div className="settings-subscription-summary-actions">
            <button className="secondary-button" type="button" disabled={isLoading} onClick={() => void loadOverview()}>
              {t("app.refresh")}
            </button>
          </div>
        </header>

        {weeklyLimit ? (
          <div className="settings-subscription-quota-list">
            <div className="settings-subscription-quota-row">
              <div className="settings-subscription-quota-copy">
                <span>{t("settings.subscription.weekRemaining")}</span>
                <div className="settings-subscription-quota-value">
                  <strong>{formatMoneyFromMicrocents(weeklyLimit.remainingMicrocents, currency)}</strong>
                  <span>
                    {t("settings.subscription.quotaRemainingPercent", {
                      percent: formatPercent(weeklyRemainingPercent),
                    })}
                  </span>
                </div>
              </div>
              <div
                className="settings-subscription-quota-meter"
                role="progressbar"
                aria-label={t("settings.subscription.weekRemaining")}
                aria-valuemin={0}
                aria-valuemax={quotaTotal(weeklyLimit)}
                aria-valuenow={weeklyLimit.remainingMicrocents}
                aria-valuetext={t("settings.subscription.quotaRemainingPercent", {
                  percent: formatPercent(weeklyRemainingPercent),
                })}
              >
                <span style={{ width: `${weeklyRemainingPercent}%` }} />
              </div>
              <div className="settings-subscription-quota-meta">
                <span>
                  {t("settings.subscription.quotaUsedAndTotal", {
                    used: formatMoneyFromMicrocents(quotaUsed(weeklyLimit), currency),
                    total: formatMoneyFromMicrocents(quotaTotal(weeklyLimit), currency),
                  })}
                </span>
                <span>
                  {formatResetTime(weeklyLimit.resetsAt)
                    ? t("settings.subscription.resetsAt", { time: formatResetTime(weeklyLimit.resetsAt) ?? "—" })
                    : t("settings.subscription.startsOnUse")}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="settings-subscription-summary-empty">
            {isLoading && !overview
              ? t("app.loadingData")
              : overview?.subscription && !hasActiveSubscription
                ? t("settings.subscription.subscriptionExpired")
                : t("settings.subscription.noActiveCredits")}
          </div>
        )}
      </section>

      <section className="settings-subscription-purchase" aria-label={t("settings.subscription.plans")}>
        <div className="settings-subscription-toolbar">
          <h3>{t("settings.subscription.plans")}</h3>
        </div>

        {sortedPlans.length > 0 ? (
          <div className="settings-subscription-plan-grid">
            {sortedPlans.map((plan) => {
              const belongsToSubscription = plan.code === currentPlanCode
              const isCurrent = hasActiveSubscription && belongsToSubscription && plan.version === currentPlanVersion
              const canSubscribe = !overview?.subscription
              const isImmediateUpgrade = Boolean(
                hasActiveSubscription
                && plan.billingInterval === "month"
                && plan.currency === overview?.subscription?.currency
                && plan.priceCents > (overview?.subscription?.priceCents ?? Number.MAX_SAFE_INTEGER),
              )
              const hasPendingOrder = Boolean(order && !terminalOrderStatuses.has(order.status))
              const isCreatingThisPlan = creatingOrder?.planVersionId === plan.planVersionId
              const isQuotingThisPlan = quotingPlanVersionId === plan.planVersionId
              return (
                <article key={plan.planVersionId} className={isCurrent ? "settings-subscription-plan is-current" : "settings-subscription-plan"}>
                  <header>
                    <div>
                      <h4>{plan.name}</h4>
                      <span>{t("settings.subscription.monthlyBilling")}</span>
                    </div>
                    {isCurrent ? <span className="settings-subscription-current-dot" title={t("settings.subscription.currentPlan")} aria-label={t("settings.subscription.currentPlan")} /> : null}
                  </header>
                  <div className="settings-subscription-price">
                    <strong>{formatMoneyFromCents(plan.priceCents, plan.currency)}</strong>
                    <span>/ {t("settings.subscription.month")}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>{t("settings.subscription.weekQuota")}</dt>
                      <dd>{formatMoneyFromMicrocents(plan.weeklyLimitMicrocents, plan.currency)}</dd>
                    </div>
                  </dl>
                  {isImmediateUpgrade || canSubscribe ? (
                    <div className="settings-subscription-plan-actions">
                      {isImmediateUpgrade ? (
                        <button
                          className="primary-button"
                          type="button"
                          disabled={creatingOrder !== null || quotingPlanVersionId !== null || hasPendingOrder}
                          onClick={() => void requestUpgradeQuote(plan)}
                        >
                          {isQuotingThisPlan
                            ? t("settings.subscription.preparingUpgrade")
                            : isCreatingThisPlan && creatingOrder?.kind === "upgrade"
                              ? t("settings.subscription.creatingOrder")
                              : hasPendingOrder
                                ? t("settings.subscription.paymentPending")
                                : t("settings.subscription.upgradeNow")}
                        </button>
                      ) : null}
                      {canSubscribe ? (
                        <button
                          className="primary-button"
                          type="button"
                          disabled={creatingOrder !== null || quotingPlanVersionId !== null || hasPendingOrder}
                          onClick={() => beginPayment(plan)}
                        >
                          {isCreatingThisPlan
                            ? t("settings.subscription.creatingOrder")
                            : hasPendingOrder
                              ? t("settings.subscription.paymentPending")
                              : t("settings.subscription.subscribeNow")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="settings-subscription-no-plans">{isLoading ? t("app.loadingData") : t("settings.subscription.noPlans")}</div>
        )}
      </section>

      {order ? (
        <SubscriptionPaymentPanel
          order={order}
          upgrade={orderResponse?.upgrade}
          qrDataUrl={qrDataUrl}
          cancelError={cancelError}
          canceling={cancelingOrderId === order.id}
          onCancel={cancelOrder}
          onChangePaymentMethod={beginPaymentMethodChange}
        />
      ) : null}

      <RechargeSettingsSection
        balanceMicrocents={overview?.balanceMicrocents ?? 0}
        currency={currency}
        initialOrder={overview?.pendingRechargeOrder ?? null}
        onPaid={loadOverview}
      />

      {upgradeQuote && !paymentIntent ? (
        <div
          className="settings-subscription-upgrade-overlay"
          role="presentation"
          onMouseDown={() => {
            if (creatingOrder?.kind !== "upgrade") setUpgradeQuote(null)
          }}
        >
          <section
            className="settings-subscription-upgrade-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-subscription-upgrade-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h3 id="settings-subscription-upgrade-title">{t("settings.subscription.upgradeConfirmTitle")}</h3>
                <p>{t("settings.subscription.upgradePlanChange", {
                  from: upgradeQuote.sourcePlanName,
                  to: upgradeQuote.targetPlanName,
                })}</p>
              </div>
            </header>
            <div className="settings-subscription-upgrade-body">
              <dl className="settings-subscription-upgrade-pricing">
                <div>
                  <dt>{t("settings.subscription.targetPlanPrice")}</dt>
                  <dd>{formatMoneyFromCents(upgradeQuote.targetGrossPriceCents, upgradeQuote.currency)}</dd>
                </div>
                <div>
                  <dt>{t("settings.subscription.unusedCredit")}</dt>
                  <dd className="is-credit">−{formatMoneyFromCents(upgradeQuote.unusedCreditCents, upgradeQuote.currency)}</dd>
                </div>
                <div className="is-total">
                  <dt>{t("settings.subscription.amountDue")}</dt>
                  <dd>{formatMoneyFromCents(upgradeQuote.amountCents, upgradeQuote.currency)}</dd>
                </div>
                <div>
                  <dt>{t("settings.subscription.newWeeklyQuota")}</dt>
                  <dd>{formatMoneyFromMicrocents(upgradeQuote.targetWeeklyLimitMicrocents, upgradeQuote.currency)}</dd>
                </div>
                <div>
                  <dt>{t("settings.subscription.quoteExpires")}</dt>
                  <dd>{formatResetTime(upgradeQuote.quoteExpiresAt) ?? "—"}</dd>
                </div>
              </dl>
              <div className="settings-subscription-upgrade-note">
                <p>{t("settings.subscription.upgradeCycleNote")}</p>
                <p>{t("settings.subscription.upgradeQuotaNote")}</p>
              </div>
              {upgradeQuote.scheduledSubscriptionPeriodId ? (
                <p className="settings-subscription-upgrade-scheduled-note">
                  {t("settings.subscription.upgradeScheduledNote")}
                </p>
              ) : null}
            </div>
            <footer>
              <button
                className="secondary-button"
                type="button"
                disabled={creatingOrder?.kind === "upgrade"}
                onClick={() => setUpgradeQuote(null)}
              >
                {t("app.cancel")}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={creatingOrder?.kind === "upgrade"}
                onClick={() => {
                  setProvider(null)
                  setPaymentIntent({ kind: "upgrade" })
                }}
              >
                {t("settings.subscription.confirmUpgradePayment", {
                  amount: formatMoneyFromCents(upgradeQuote.amountCents, upgradeQuote.currency),
                })}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {paymentIntent ? (
        <SubscriptionPaymentMethodDialog
          intent={paymentIntent}
          upgradeQuote={upgradeQuote}
          provider={provider}
          creating={creatingOrder !== null}
          onProviderChange={setProvider}
          onClose={closePaymentMethodDialog}
          onConfirm={() => {
            if (paymentIntent.kind === "upgrade") {
              void createUpgradeOrder()
            } else {
              void createOrder(paymentIntent)
            }
          }}
        />
      ) : null}
    </div>
  )
}

function RechargeSettingsSection({
  balanceMicrocents,
  currency,
  initialOrder,
  onPaid,
}: {
  balanceMicrocents: number
  currency: string
  initialOrder: DesktopRechargePaymentOrder | null
  onPaid: () => Promise<void>
}) {
  const { t } = useI18n()
  const toast = useToast()
  const paidOrderRef = useRef<string | null>(null)
  const [amountInput, setAmountInput] = useState("300")
  const [selectedAmountCents, setSelectedAmountCents] = useState<number | null>(30_000)
  const [provider, setProvider] = useState<DesktopSubscriptionPaymentProvider>("alipay")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null)
  const [orderResponse, setOrderResponse] = useState<DesktopRechargeOrderResponse | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const order = orderResponse?.order ?? null
  const parsedAmountYuan = Number(amountInput)
  const amountIsValid = Number.isFinite(parsedAmountYuan) && parsedAmountYuan >= 1 && parsedAmountYuan <= 10_000
  const amountCents = amountIsValid ? Math.round(parsedAmountYuan * 100) : 0
  const hasPendingOrder = Boolean(order && !terminalOrderStatuses.has(order.status))
  const presets = [
    {
      amountCents: 5_000,
      name: t("settings.subscription.rechargeStarter"),
      description: t("settings.subscription.rechargeStarterDescription"),
    },
    {
      amountCents: 10_000,
      name: t("settings.subscription.rechargeEveryday"),
      description: t("settings.subscription.rechargeEverydayDescription"),
    },
    {
      amountCents: 30_000,
      name: t("settings.subscription.rechargeRecommended"),
      description: t("settings.subscription.rechargeRecommendedDescription"),
    },
    {
      amountCents: 100_000,
      name: t("settings.subscription.rechargeTeam"),
      description: t("settings.subscription.rechargeTeamDescription"),
    },
  ]

  const syncControlsWithOrder = useCallback((nextOrder: DesktopRechargePaymentOrder) => {
    setAmountInput(rechargeAmountInputFromCents(nextOrder.amountCents))
    setSelectedAmountCents(rechargePresetAmountCents.some(
      (presetAmountCents) => presetAmountCents === nextOrder.amountCents,
    ) ? nextOrder.amountCents : null)
    setProvider(nextOrder.provider)
  }, [])

  useEffect(() => {
    if (!initialOrder || terminalOrderStatuses.has(initialOrder.status)) return
    paidOrderRef.current = null
    syncControlsWithOrder(initialOrder)
    setOrderResponse((current) => current?.order.id === initialOrder.id ? current : { order: initialOrder })
  }, [initialOrder, syncControlsWithOrder])

  useEffect(() => {
    if (order?.provider !== "wechat_pay" || !order.codeUrl || terminalOrderStatuses.has(order.status)) {
      setQrDataUrl(null)
      return
    }
    let disposed = false
    void QRCode.toDataURL(order.codeUrl, {
      scale: 8,
      margin: 1,
      errorCorrectionLevel: "M",
    }).then((dataUrl) => {
      if (!disposed) setQrDataUrl(dataUrl)
    }).catch(() => {
      if (!disposed) setQrDataUrl(null)
    })
    return () => {
      disposed = true
    }
  }, [order?.codeUrl, order?.provider, order?.status])

  useEffect(() => {
    if (!order || terminalOrderStatuses.has(order.status) || cancelingOrderId === order.id) return
    const getOrder = window.desktop?.getAnyboxRechargeOrder
    if (!getOrder) return
    let disposed = false
    let timer: number | null = null
    const poll = () => {
      void getOrder({ orderId: order.id }).then((result) => {
        if (disposed) return
        if (result.order.status === "canceled") {
          setOrderResponse(null)
          setQrDataUrl(null)
          setCancelError(null)
          setError(null)
        } else {
          syncControlsWithOrder(result.order)
          setOrderResponse(result)
          if (!cancelError) {
            setError(result.sync?.error ? t("settings.subscription.rechargeOrderStatusFailed") : null)
          }
        }
      }).catch(() => {
        if (disposed) return
        if (!cancelError) {
          setError(t("settings.subscription.rechargeOrderStatusFailed"))
        }
      }).finally(() => {
        if (!disposed) timer = window.setTimeout(poll, 2_000)
      })
    }
    timer = window.setTimeout(poll, 2_000)
    return () => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [cancelError, cancelingOrderId, order, syncControlsWithOrder, t])

  useEffect(() => {
    if (order?.status !== "paid" || paidOrderRef.current === order.id) return
    paidOrderRef.current = order.id
    setError(null)
    toast.success(t("settings.subscription.rechargeSuccess"))
    void onPaid()
  }, [onPaid, order, t, toast])

  async function createRechargeOrder() {
    if (!amountIsValid || creating || hasPendingOrder) return
    const create = window.desktop?.createAnyboxRechargeOrder
    if (!create) {
      setError(t("settings.subscription.unavailable"))
      return
    }
    setCreating(true)
    setError(null)
    setCancelError(null)
    try {
      const result = await create({ amountCents, provider })
      paidOrderRef.current = null
      syncControlsWithOrder(result.order)
      setOrderResponse(result)
      setError(result.sync?.error ? t("settings.subscription.rechargeOrderStatusFailed") : null)
      if (result.order.provider === "alipay" && result.order.codeUrl) {
        await openExternalUrl(result.order.codeUrl)
      }
    } catch (createError) {
      setError(readableDesktopError(createError, t("settings.subscription.createRechargeOrderFailed")))
    } finally {
      setCreating(false)
    }
  }

  async function endRechargeOrder() {
    if (!order || terminalOrderStatuses.has(order.status) || cancelingOrderId === order.id) return
    const cancel = window.desktop?.cancelAnyboxRechargeOrder
    if (!cancel) {
      setCancelError(t("settings.subscription.endRechargeOrderUnavailable"))
      return
    }

    setCancelingOrderId(order.id)
    setCancelError(null)
    setError(null)
    try {
      const result = await cancel({ orderId: order.id })
      if (result.order.status === "paid") {
        paidOrderRef.current = result.order.id
        setOrderResponse(result)
        setQrDataUrl(null)
        await onPaid()
        toast.info(t("settings.subscription.rechargeOrderAlreadyPaid"))
      } else if (terminalOrderStatuses.has(result.order.status)) {
        setOrderResponse(null)
        setQrDataUrl(null)
        toast.success(t(result.order.status === "canceled"
          ? "settings.subscription.orderCanceled"
          : "settings.subscription.orderEnded"))
      } else {
        setOrderResponse(result)
        setCancelError(t("settings.subscription.endRechargeOrderFailed"))
      }
    } catch (endError) {
      const localizedError = t(rechargeCancelErrorKey(endError))
      const getOrder = window.desktop?.getAnyboxRechargeOrder
      if (!getOrder) {
        setCancelError(localizedError)
        return
      }
      try {
        const latest = await getOrder({ orderId: order.id })
        if (latest.order.status === "paid") {
          paidOrderRef.current = latest.order.id
          setOrderResponse(latest)
          setQrDataUrl(null)
          setCancelError(null)
          await onPaid()
          toast.info(t("settings.subscription.rechargeOrderAlreadyPaid"))
        } else if (terminalOrderStatuses.has(latest.order.status)) {
          setOrderResponse(null)
          setQrDataUrl(null)
          setCancelError(null)
          toast.info(t("settings.subscription.orderEnded"))
        } else {
          syncControlsWithOrder(latest.order)
          setOrderResponse(latest)
          setCancelError(localizedError)
        }
      } catch {
        setCancelError(localizedError)
      }
    } finally {
      setCancelingOrderId(null)
    }
  }

  return (
    <section className="settings-recharge" aria-labelledby="settings-recharge-title">
      <header className="settings-recharge-header">
        <div>
          <h3 id="settings-recharge-title">{t("settings.subscription.rechargeTitle")}</h3>
          <p>{t("settings.subscription.rechargeDescription")}</p>
        </div>
        <div className="settings-recharge-balance">
          <span>{t("settings.subscription.currentBalance")}</span>
          <strong>{formatMoneyFromMicrocents(balanceMicrocents, currency)}</strong>
        </div>
      </header>

      <div className="settings-recharge-presets" role="group" aria-label={t("settings.subscription.rechargePresets")}>
        {presets.map((preset) => (
          <button
            key={preset.amountCents}
            className={selectedAmountCents === preset.amountCents ? "is-selected" : undefined}
            type="button"
            aria-pressed={selectedAmountCents === preset.amountCents}
            disabled={creating || hasPendingOrder}
            onClick={() => {
              setSelectedAmountCents(preset.amountCents)
              setAmountInput(String(preset.amountCents / 100))
            }}
          >
            <span>{preset.name}</span>
            <strong>{formatMoneyFromCents(preset.amountCents, currency)}</strong>
            <small>{preset.description}</small>
          </button>
        ))}
      </div>

      <div className="settings-recharge-checkout">
        <label className="settings-recharge-field">
          <span>{t("settings.subscription.customAmount")}</span>
          <span className="settings-recharge-amount-input">
            <span aria-hidden="true">¥</span>
            <input
              type="number"
              min="1"
              max="10000"
              step="0.01"
              inputMode="decimal"
              value={amountInput}
              disabled={creating || hasPendingOrder}
              aria-invalid={!amountIsValid}
              onChange={(event) => {
                setSelectedAmountCents(null)
                setAmountInput(event.currentTarget.value)
              }}
            />
          </span>
        </label>

        <fieldset className="settings-recharge-payment-field">
          <legend>{t("settings.subscription.paymentMethod")}</legend>
          <div className="settings-subscription-payment-methods" role="group" aria-label={t("settings.subscription.rechargePaymentMethod")}>
            {(["alipay", "wechat_pay"] as const).map((value) => (
              <button
                key={value}
                className={provider === value ? "is-active" : undefined}
                type="button"
                aria-pressed={provider === value}
                disabled={creating || hasPendingOrder}
                onClick={() => setProvider(value)}
              >
                {t(value === "alipay" ? "settings.subscription.alipay" : "settings.subscription.wechatPay")}
              </button>
            ))}
          </div>
        </fieldset>

        <button
          className="primary-button settings-recharge-submit"
          type="button"
          disabled={!amountIsValid || creating || hasPendingOrder}
          onClick={() => void createRechargeOrder()}
        >
          {creating
            ? t("settings.subscription.creatingRechargeOrder")
            : hasPendingOrder
              ? t("settings.subscription.paymentPending")
              : t("settings.subscription.createRechargeOrder", {
                  amount: formatMoneyFromCents(amountCents, currency),
                })}
        </button>
      </div>

      {error ? <p className="settings-recharge-message is-error">{error}</p> : null}
      {order ? (
        <RechargePaymentPanel
          order={order}
          qrDataUrl={qrDataUrl}
          cancelError={cancelError}
          canceling={cancelingOrderId === order.id}
          onCancel={endRechargeOrder}
        />
      ) : null}
    </section>
  )
}

function RechargePaymentPanel({
  order,
  qrDataUrl,
  cancelError,
  canceling,
  onCancel,
}: {
  order: DesktopRechargePaymentOrder
  qrDataUrl: string | null
  cancelError: string | null
  canceling: boolean
  onCancel: () => void
}) {
  const { t } = useI18n()
  const isPaid = order.status === "paid"
  const isFailed = terminalOrderStatuses.has(order.status) && !isPaid
  return (
    <div className="settings-recharge-payment" aria-live="polite">
      <div className="settings-recharge-payment-header">
        <div>
          <span>{t("settings.subscription.rechargePaymentOrder")}</span>
          <strong>
            {t(order.provider === "alipay" ? "settings.subscription.alipay" : "settings.subscription.wechatPay")}
            {" · "}
            {formatMoneyFromCents(order.amountCents, order.currency)}
          </strong>
        </div>
        <span className={`settings-subscription-payment-status is-${order.status}`}>
          {isPaid
            ? t("settings.subscription.paymentPaid")
            : isFailed
              ? t("settings.subscription.paymentFailed")
              : t("settings.subscription.paymentPending")}
        </span>
      </div>
      {!isPaid && !isFailed && order.provider === "wechat_pay" ? (
        <div className="settings-subscription-qr">
          {qrDataUrl ? <img src={qrDataUrl} alt={t("settings.subscription.wechatQrAlt")} /> : <span>{t("app.loadingData")}</span>}
          <p>{t("settings.subscription.wechatQrCopy")}</p>
        </div>
      ) : null}
      {!isPaid && !isFailed ? (
        <div className="settings-subscription-payment-actions">
          {order.provider === "alipay" && order.codeUrl ? (
            <button className="primary-button" type="button" disabled={canceling} onClick={() => void openExternalUrl(order.codeUrl!)}>
              {t("settings.subscription.openAlipay")}
            </button>
          ) : null}
          <button className="secondary-button" type="button" disabled={canceling} onClick={onCancel}>
            {canceling ? t("settings.subscription.endingRechargeOrder") : t("settings.subscription.endRechargeOrder")}
          </button>
        </div>
      ) : null}
      {cancelError ? <p className="settings-recharge-message is-error">{cancelError}</p> : null}
      {isPaid ? <p className="settings-recharge-message is-success">{t("settings.subscription.rechargeSuccess")}</p> : null}
      {isFailed ? <p className="settings-recharge-message is-error">{t("settings.subscription.rechargeRetry")}</p> : null}
    </div>
  )
}

function SubscriptionPaymentMethodDialog({
  intent,
  upgradeQuote,
  provider,
  creating,
  onProviderChange,
  onClose,
  onConfirm,
}: {
  intent: SubscriptionPaymentIntent
  upgradeQuote: DesktopSubscriptionUpgradeQuote | null
  provider: DesktopSubscriptionPaymentProvider | null
  creating: boolean
  onProviderChange: (provider: DesktopSubscriptionPaymentProvider) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const replacingOrder = intent.kind === "upgrade" ? undefined : intent.replacingOrder
  const planName = intent.kind === "upgrade" ? upgradeQuote?.targetPlanName : intent.plan.name
  const amount = intent.kind === "upgrade"
    ? upgradeQuote && formatMoneyFromCents(upgradeQuote.amountCents, upgradeQuote.currency)
    : formatMoneyFromCents(intent.plan.priceCents, intent.plan.currency)

  return (
    <div
      className="settings-subscription-upgrade-overlay"
      role="presentation"
      onMouseDown={() => {
        if (!creating) onClose()
      }}
    >
      <section
        className="settings-subscription-upgrade-dialog settings-subscription-payment-method-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-subscription-payment-method-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h3 id="settings-subscription-payment-method-title">
              {t(replacingOrder
                ? "settings.subscription.changePaymentMethod"
                : "settings.subscription.selectPaymentMethod")}
            </h3>
            <p>{t("settings.subscription.paymentPlanSummary", {
              plan: planName ?? "—",
              amount: amount ?? "—",
            })}</p>
          </div>
        </header>
        <div className="settings-subscription-payment-method-body">
          <div
            className="settings-subscription-payment-methods"
            role="radiogroup"
            aria-label={t("settings.subscription.paymentMethod")}
          >
            {(["alipay", "wechat_pay"] as const).map((value) => (
              <button
                key={value}
                className={provider === value ? "is-active" : undefined}
                type="button"
                role="radio"
                aria-checked={provider === value}
                disabled={creating || replacingOrder?.provider === value}
                onClick={() => onProviderChange(value)}
              >
                {t(value === "alipay" ? "settings.subscription.alipay" : "settings.subscription.wechatPay")}
              </button>
            ))}
          </div>
          {replacingOrder ? (
            <p className="settings-subscription-payment-method-note">
              {t("settings.subscription.replacePaymentMethodCopy", {
                provider: t(replacingOrder.provider === "alipay"
                  ? "settings.subscription.alipay"
                  : "settings.subscription.wechatPay"),
              })}
            </p>
          ) : null}
        </div>
        <footer>
          <button className="secondary-button" type="button" disabled={creating} onClick={onClose}>
            {t("app.cancel")}
          </button>
          <button className="primary-button" type="button" disabled={!provider || creating} onClick={onConfirm}>
            {creating ? t("settings.subscription.creatingOrder") : t("settings.subscription.createPaymentOrder")}
          </button>
        </footer>
      </section>
    </div>
  )
}

function SubscriptionPaymentPanel({
  order,
  upgrade,
  qrDataUrl,
  cancelError,
  canceling,
  onCancel,
  onChangePaymentMethod,
}: {
  order: DesktopSubscriptionPaymentOrder
  upgrade?: DesktopSubscriptionUpgradeDetail | null
  qrDataUrl: string | null
  cancelError: string | null
  canceling: boolean
  onCancel: () => void
  onChangePaymentMethod: () => void
}) {
  const { t } = useI18n()
  const isPaid = order.status === "paid"
  const isCanceled = order.status === "canceled"
  const isFailed = terminalOrderStatuses.has(order.status) && !isPaid && !isCanceled
  const isUpgrade = order.purpose === "subscription_upgrade"
  const canChangePaymentMethod = !isUpgrade && order.purpose !== "subscription_renewal"
  const isCreditedFallback = isPaid && upgrade?.status === "credited_fallback"
  const isAppliedUpgrade = isPaid && upgrade?.status === "applied"
  return (
    <section className="settings-subscription-payment" aria-live="polite" aria-label={t("settings.subscription.paymentOrder")}>
      <header>
        <div>
          <span>{t("settings.subscription.paymentOrder")}</span>
          <strong>
            {t(order.provider === "alipay" ? "settings.subscription.alipay" : "settings.subscription.wechatPay")}
            {" · "}
            {formatMoneyFromCents(order.amountCents, order.currency)}
          </strong>
        </div>
        <span className={`settings-subscription-payment-status is-${order.status}`}>
          {isCreditedFallback
            ? t("settings.subscription.upgradeCreditedStatus")
            : isPaid
              ? t("settings.subscription.paymentPaid")
            : isCanceled
              ? t("settings.subscription.paymentCanceled")
            : isFailed
              ? t("settings.subscription.paymentFailed")
              : t("settings.subscription.paymentPending")}
        </span>
      </header>
      {!isPaid && !isFailed && order.provider === "wechat_pay" ? (
        <div className="settings-subscription-qr">
          {qrDataUrl ? <img src={qrDataUrl} alt={t("settings.subscription.wechatQrAlt")} /> : <span>{t("app.loadingData")}</span>}
          <p>{t("settings.subscription.wechatQrCopy")}</p>
        </div>
      ) : null}
      {!isPaid && !isFailed ? (
        <div className="settings-subscription-payment-actions">
          {order.provider === "alipay" && order.codeUrl ? (
            <button className="primary-button" type="button" disabled={canceling} onClick={() => void openExternalUrl(order.codeUrl!)}>
              {t("settings.subscription.openAlipay")}
            </button>
          ) : null}
          {canChangePaymentMethod ? (
            <button className="secondary-button" type="button" disabled={canceling} onClick={onChangePaymentMethod}>
              {t("settings.subscription.changePaymentMethod")}
            </button>
          ) : null}
          <button className="secondary-button" type="button" disabled={canceling} onClick={onCancel}>
            {canceling ? t("settings.subscription.cancelingOrder") : t("settings.subscription.cancelOrder")}
          </button>
        </div>
      ) : null}
      {cancelError ? <p className="settings-subscription-payment-message is-error">{cancelError}</p> : null}
      {isCreditedFallback ? (
        <p className="settings-subscription-payment-message is-warning">{t("settings.subscription.upgradeCreditedFallback")}</p>
      ) : isAppliedUpgrade ? (
        <p className="settings-subscription-payment-message is-success">{t("settings.subscription.upgradeApplied")}</p>
      ) : isPaid ? (
        <p className="settings-subscription-payment-message is-success">{t("settings.subscription.paymentSuccess")}</p>
      ) : null}
      {isFailed ? <p className="settings-subscription-payment-message is-error">{t("settings.subscription.paymentRetry")}</p> : null}
    </section>
  )
}
