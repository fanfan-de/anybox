import QRCode from "qrcode"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
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
      setError(loadError instanceof Error ? loadError.message : t("settings.subscription.loadFailed"))
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
        setError(pollError instanceof Error ? pollError.message : t("settings.subscription.paymentStatusFailed"))
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
      setError(quoteError instanceof Error ? quoteError.message : t("settings.subscription.createUpgradeQuoteFailed"))
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
      setError(createError instanceof Error ? createError.message : t("settings.subscription.createUpgradeOrderFailed"))
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
