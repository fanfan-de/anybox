import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  DesktopSubscriptionOrderResponse,
  DesktopSubscriptionOverview,
  DesktopSubscriptionPlan,
} from "../../../../shared/desktop-ipc-contract"
import { ToastProvider } from "../toast"
import { SubscriptionSettingsPanel } from "./SubscriptionSettingsPanel"

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,SUBSCRIPTION_QR"),
  },
}))

const proPlan: DesktopSubscriptionPlan = {
  planId: "plan-pro",
  code: "pro",
  name: "Pro",
  planVersionId: "plan-pro-v1",
  version: 1,
  currency: "CNY",
  priceCents: 19_900,
  billingInterval: "month",
  weeklyLimitMicrocents: 9_000_000_000,
  terms: {},
}

function createOverview(): DesktopSubscriptionOverview {
  return {
    connected: true,
    balanceMicrocents: 14_497_000_000,
    currency: "CNY",
    plans: [proPlan],
    subscription: null,
    limits: [],
    pendingOrder: null,
    pendingOrderPlanVersionId: null,
    pendingUpgrade: null,
  }
}

function createPendingOrder(): DesktopSubscriptionOrderResponse {
  return {
    order: {
      id: "order-1",
      provider: "wechat_pay",
      codeUrl: "weixin://wxpay/order-1",
      amountCents: proPlan.priceCents,
      currency: proPlan.currency,
      purpose: "subscription_purchase",
      status: "pending",
    },
  }
}

function renderPanel() {
  return render(
    <ToastProvider>
      <SubscriptionSettingsPanel accountBusy={false} connected onSignIn={vi.fn()} />
    </ToastProvider>,
  )
}

describe("SubscriptionSettingsPanel payment flow", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as typeof window & { desktop?: unknown }).desktop
  })

  it("asks for a payment method only after a plan action", async () => {
    const createOrder = vi.fn().mockResolvedValue(createPendingOrder())
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue(createOverview()),
      createAnyboxSubscriptionOrder: createOrder,
      getAnyboxSubscriptionOrder: vi.fn().mockResolvedValue(createPendingOrder()),
    } as unknown as Window["desktop"]

    renderPanel()

    await screen.findByText("Pro")
    expect(screen.queryByRole("radiogroup", { name: "Payment method" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Subscribe now" }))

    const dialog = screen.getByRole("dialog", { name: "Choose a payment method" })
    const paymentMethods = within(dialog).getByRole("radiogroup", { name: "Payment method" })
    expect(within(paymentMethods).getByRole("radio", { name: "Alipay" })).toHaveAttribute("aria-checked", "false")
    expect(within(dialog).getByRole("button", { name: "Create payment order" })).toBeDisabled()

    fireEvent.click(within(paymentMethods).getByRole("radio", { name: "WeChat Pay" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Create payment order" }))

    await waitFor(() => {
      expect(createOrder).toHaveBeenCalledWith({
        planVersionId: proPlan.planVersionId,
        provider: "wechat_pay",
      })
    })
    expect(screen.queryByRole("dialog", { name: "Choose a payment method" })).not.toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "Cancel order" })).toBeInTheDocument()
  })

  it("returns the plans to their initial state after canceling an unpaid order", async () => {
    const pendingOrder = createPendingOrder()
    const cancelOrder = vi.fn().mockResolvedValue({
      order: { ...pendingOrder.order, status: "canceled" },
    })
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue(createOverview()),
      createAnyboxSubscriptionOrder: vi.fn().mockResolvedValue(pendingOrder),
      cancelAnyboxSubscriptionOrder: cancelOrder,
      getAnyboxSubscriptionOrder: vi.fn().mockResolvedValue(pendingOrder),
    } as unknown as Window["desktop"]

    renderPanel()

    fireEvent.click(await screen.findByRole("button", { name: "Subscribe now" }))
    const dialog = screen.getByRole("dialog", { name: "Choose a payment method" })
    fireEvent.click(within(dialog).getByRole("radio", { name: "WeChat Pay" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Create payment order" }))
    fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }))

    await waitFor(() => expect(cancelOrder).toHaveBeenCalledWith({ orderId: "order-1" }))
    await waitFor(() => {
      expect(screen.queryByLabelText("Payment order")).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Subscribe now" })).toBeEnabled()
    })
    expect(screen.queryByRole("radiogroup", { name: "Payment method" })).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps a historical renewal order visible without allowing it to be replaced", async () => {
    const renewalOrder: DesktopSubscriptionOrderResponse = {
      order: {
        id: "renewal-order-1",
        provider: "wechat_pay",
        codeUrl: "weixin://wxpay/renewal-order-1",
        amountCents: proPlan.priceCents,
        currency: proPlan.currency,
        purpose: "subscription_renewal",
        status: "pending",
      },
    }
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue({
        ...createOverview(),
        pendingOrder: renewalOrder.order,
        pendingOrderPlanVersionId: proPlan.planVersionId,
      }),
      getAnyboxSubscriptionOrder: vi.fn().mockResolvedValue(renewalOrder),
      cancelAnyboxSubscriptionOrder: vi.fn(),
    } as unknown as Window["desktop"]

    renderPanel()

    expect(await screen.findByRole("img", { name: "WeChat Pay QR code" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Change payment method" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument()
  })

  it("creates a custom WeChat recharge order below the subscription plans", async () => {
    const rechargeOrder = {
      order: {
        id: "recharge-1",
        provider: "wechat_pay" as const,
        codeUrl: "weixin://wxpay/recharge-1",
        amountCents: 8_850,
        currency: "CNY",
        status: "pending" as const,
      },
    }
    const createRechargeOrder = vi.fn().mockResolvedValue(rechargeOrder)
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue(createOverview()),
      createAnyboxRechargeOrder: createRechargeOrder,
      getAnyboxRechargeOrder: vi.fn().mockResolvedValue(rechargeOrder),
    } as unknown as Window["desktop"]

    renderPanel()

    await screen.findByRole("heading", { name: "Add prepaid balance" })
    fireEvent.change(screen.getByRole("spinbutton", { name: "Custom amount" }), { target: { value: "88.50" } })
    fireEvent.click(screen.getByRole("button", { name: "WeChat Pay" }))
    fireEvent.click(screen.getByRole("button", { name: /Pay .*88\.50/ }))

    await waitFor(() => {
      expect(createRechargeOrder).toHaveBeenCalledWith({ amountCents: 8_850, provider: "wechat_pay" })
    })
    expect(await screen.findByRole("img", { name: "WeChat Pay QR code" })).toBeInTheDocument()
  })

  it("restores a pending recharge order from the account overview", async () => {
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue({
        ...createOverview(),
        pendingRechargeOrder: {
          id: "recharge-restored-1",
          provider: "wechat_pay",
          codeUrl: "weixin://wxpay/recharge-restored-1",
          amountCents: 10_000,
          currency: "CNY",
          status: "pending",
        },
      }),
      getAnyboxRechargeOrder: vi.fn().mockResolvedValue({
        order: {
          id: "recharge-restored-1",
          provider: "wechat_pay",
          codeUrl: "weixin://wxpay/recharge-restored-1",
          amountCents: 10_000,
          currency: "CNY",
          status: "pending",
        },
      }),
      cancelAnyboxRechargeOrder: vi.fn(),
    } as unknown as Window["desktop"]

    renderPanel()

    expect(await screen.findByRole("img", { name: "WeChat Pay QR code" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "End order" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Awaiting payment" })).toBeDisabled()
    expect(screen.getByRole("spinbutton", { name: "Custom amount" })).toHaveValue(100)
    const rechargeMethods = screen.getByRole("group", { name: "Recharge payment method" })
    expect(within(rechargeMethods).getByRole("button", { name: "Alipay" })).toHaveAttribute("aria-pressed", "false")
    expect(within(rechargeMethods).getByRole("button", { name: "WeChat Pay" })).toHaveAttribute("aria-pressed", "true")
    const rechargePresets = screen.getByRole("group", { name: "Recharge amounts" })
    expect(within(rechargePresets).getByRole("button", { name: /Everyday/ })).toHaveAttribute("aria-pressed", "true")
    expect(within(rechargePresets).getByRole("button", { name: /Recommended/ })).toHaveAttribute("aria-pressed", "false")
  })

  it("aligns recharge controls with the order returned after creation", async () => {
    const normalizedOrder = {
      order: {
        id: "recharge-normalized-1",
        provider: "wechat_pay" as const,
        codeUrl: "weixin://wxpay/recharge-normalized-1",
        amountCents: 10_000,
        currency: "CNY",
        status: "pending" as const,
      },
      sync: {
        checked: true,
        error: "ECONNRESET from upstream payment query",
      },
    }
    const createRechargeOrder = vi.fn().mockResolvedValue(normalizedOrder)
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue(createOverview()),
      createAnyboxRechargeOrder: createRechargeOrder,
      getAnyboxRechargeOrder: vi.fn().mockResolvedValue(normalizedOrder),
    } as unknown as Window["desktop"]

    renderPanel()

    fireEvent.click(await screen.findByRole("button", { name: /^Pay / }))

    await waitFor(() => {
      expect(createRechargeOrder).toHaveBeenCalledWith({ amountCents: 30_000, provider: "alipay" })
    })
    expect(await screen.findByRole("img", { name: "WeChat Pay QR code" })).toBeInTheDocument()
    expect(screen.getByRole("spinbutton", { name: "Custom amount" })).toHaveValue(100)
    const rechargeMethods = screen.getByRole("group", { name: "Recharge payment method" })
    expect(within(rechargeMethods).getByRole("button", { name: "Alipay" })).toHaveAttribute("aria-pressed", "false")
    expect(within(rechargeMethods).getByRole("button", { name: "WeChat Pay" })).toHaveAttribute("aria-pressed", "true")
    const rechargePresets = screen.getByRole("group", { name: "Recharge amounts" })
    expect(within(rechargePresets).getByRole("button", { name: /Everyday/ })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getAllByText("Unable to refresh the recharge status.")).toHaveLength(1)
    expect(screen.queryByText("ECONNRESET from upstream payment query")).not.toBeInTheDocument()
  })

  it("shows a localized sync error once and clears it after a successful refresh", async () => {
    const pendingOrder = {
      id: "recharge-sync-1",
      provider: "wechat_pay" as const,
      codeUrl: "weixin://wxpay/recharge-sync-1",
      amountCents: 5_000,
      currency: "CNY",
      status: "pending" as const,
    }
    const getRechargeOrder = vi.fn()
      .mockResolvedValueOnce({
        order: pendingOrder,
        sync: { checked: true, error: "payment gateway ECONNRESET" },
      })
      .mockResolvedValue({ order: pendingOrder, sync: { checked: true } })
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue({
        ...createOverview(),
        pendingRechargeOrder: pendingOrder,
      }),
      getAnyboxRechargeOrder: getRechargeOrder,
      cancelAnyboxRechargeOrder: vi.fn(),
    } as unknown as Window["desktop"]

    renderPanel()

    expect(await screen.findByText("Unable to refresh the recharge status.", {}, { timeout: 3_500 })).toBeInTheDocument()
    expect(screen.getAllByText("Unable to refresh the recharge status.")).toHaveLength(1)
    expect(screen.queryByText("payment gateway ECONNRESET")).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText("Unable to refresh the recharge status.")).not.toBeInTheDocument()
      expect(getRechargeOrder).toHaveBeenCalledTimes(2)
    }, { timeout: 5_000 })
  })

  it("removes the Electron IPC wrapper from recharge errors", async () => {
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue(createOverview()),
      createAnyboxRechargeOrder: vi.fn().mockRejectedValue(
        new Error("Error invoking remote method 'desktop:create-anybox-recharge-order': Error: ANYBOX_PROVIDER_ERROR:invalid_token:Please sign in"),
      ),
    } as unknown as Window["desktop"]

    renderPanel()

    fireEvent.click(await screen.findByRole("button", { name: /^Pay / }))

    expect(await screen.findByText("Please sign in")).toBeInTheDocument()
    expect(screen.queryByText(/Error invoking remote method/)).not.toBeInTheDocument()
    expect(screen.queryByText(/ANYBOX_PROVIDER_ERROR/)).not.toBeInTheDocument()
  })

  it("ends a pending recharge order and restores the recharge form", async () => {
    const pendingOrder = {
      order: {
        id: "recharge-1",
        provider: "wechat_pay" as const,
        codeUrl: "weixin://wxpay/recharge-1",
        amountCents: 3_000,
        currency: "CNY",
        status: "pending" as const,
      },
    }
    const cancelRechargeOrder = vi.fn().mockResolvedValue({
      order: { ...pendingOrder.order, status: "canceled" as const },
    })
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue(createOverview()),
      createAnyboxRechargeOrder: vi.fn().mockResolvedValue(pendingOrder),
      getAnyboxRechargeOrder: vi.fn().mockResolvedValue(pendingOrder),
      cancelAnyboxRechargeOrder: cancelRechargeOrder,
    } as unknown as Window["desktop"]

    renderPanel()

    fireEvent.click(await screen.findByRole("button", { name: "WeChat Pay" }))
    fireEvent.click(screen.getByRole("button", { name: /^Pay / }))
    expect(await screen.findByRole("img", { name: "WeChat Pay QR code" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "End order" }))

    await waitFor(() => expect(cancelRechargeOrder).toHaveBeenCalledWith({ orderId: "recharge-1" }))
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: "WeChat Pay QR code" })).not.toBeInTheDocument()
      expect(screen.queryByText("Recharge order")).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: /^Pay / })).toBeEnabled()
    })
  })

  it("keeps a pending recharge order usable when it cannot be closed safely", async () => {
    const pendingOrder = {
      order: {
        id: "recharge-close-failed",
        provider: "wechat_pay" as const,
        codeUrl: "weixin://wxpay/recharge-close-failed",
        amountCents: 3_000,
        currency: "CNY",
        status: "pending" as const,
      },
    }
    const typedProviderError = Object.assign(
      new Error("ANYBOX_PROVIDER_ERROR:recharge_order_initializing upstream socket failed"),
      { code: "recharge_order_close_failed" },
    )
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue(createOverview()),
      createAnyboxRechargeOrder: vi.fn().mockResolvedValue(pendingOrder),
      getAnyboxRechargeOrder: vi.fn().mockResolvedValue({
        ...pendingOrder,
        sync: { checked: true, error: "raw provider reconciliation failure" },
      }),
      cancelAnyboxRechargeOrder: vi.fn().mockRejectedValue(typedProviderError),
    } as unknown as Window["desktop"]

    renderPanel()

    fireEvent.click(await screen.findByRole("button", { name: "WeChat Pay" }))
    fireEvent.click(screen.getByRole("button", { name: /^Pay / }))
    fireEvent.click(await screen.findByRole("button", { name: "End order" }))

    const localizedMessage = "The payment provider did not confirm that this order was closed. Check whether payment completed, then try again."
    expect(await screen.findByText(localizedMessage)).toBeInTheDocument()
    expect(screen.getAllByText(localizedMessage)).toHaveLength(1)
    expect(screen.queryByText(/upstream socket failed/i)).not.toBeInTheDocument()
    expect(screen.queryByText("raw provider reconciliation failure")).not.toBeInTheDocument()
    expect(screen.getByRole("img", { name: "WeChat Pay QR code" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "End order" })).toBeEnabled()
  })

  it("localizes a serialized provider error without showing technical details", async () => {
    const pendingOrder = {
      order: {
        id: "recharge-initializing",
        provider: "wechat_pay" as const,
        codeUrl: "weixin://wxpay/recharge-initializing",
        amountCents: 3_000,
        currency: "CNY",
        status: "pending" as const,
      },
    }
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue(createOverview()),
      createAnyboxRechargeOrder: vi.fn().mockResolvedValue(pendingOrder),
      getAnyboxRechargeOrder: vi.fn().mockResolvedValue(pendingOrder),
      cancelAnyboxRechargeOrder: vi.fn().mockRejectedValue(
        new Error("Error invoking remote method 'desktop:cancel-anybox-recharge-order': Error: ANYBOX_PROVIDER_ERROR:recharge_order_initializing"),
      ),
    } as unknown as Window["desktop"]

    renderPanel()

    fireEvent.click(await screen.findByRole("button", { name: "WeChat Pay" }))
    fireEvent.click(screen.getByRole("button", { name: /^Pay / }))
    fireEvent.click(await screen.findByRole("button", { name: "End order" }))

    expect(await screen.findByText("This order is still being created. Wait a moment, then try again.")).toBeInTheDocument()
    expect(screen.queryByText(/ANYBOX_PROVIDER_ERROR/)).not.toBeInTheDocument()
  })

  it("refreshes the balance when payment wins a recharge cancellation race", async () => {
    const pendingOrder = {
      order: {
        id: "recharge-2",
        provider: "wechat_pay" as const,
        codeUrl: "weixin://wxpay/recharge-2",
        amountCents: 5_000,
        currency: "CNY",
        status: "pending" as const,
      },
    }
    const paidOrder = {
      order: { ...pendingOrder.order, status: "paid" as const },
    }
    const loadOverview = vi.fn().mockResolvedValue(createOverview())
    window.desktop = {
      getAnyboxSubscriptionOverview: loadOverview,
      createAnyboxRechargeOrder: vi.fn().mockResolvedValue(pendingOrder),
      cancelAnyboxRechargeOrder: vi.fn().mockRejectedValue(new Error("The recharge order was already paid")),
      getAnyboxRechargeOrder: vi.fn().mockResolvedValue(paidOrder),
    } as unknown as Window["desktop"]

    renderPanel()

    fireEvent.click(await screen.findByRole("button", { name: "WeChat Pay" }))
    fireEvent.click(screen.getByRole("button", { name: /^Pay / }))
    fireEvent.click(await screen.findByRole("button", { name: "End order" }))

    expect(await screen.findByText("The order was already paid. Your balance has been refreshed.")).toBeInTheDocument()
    await waitFor(() => expect(loadOverview).toHaveBeenCalledTimes(2))
    expect(screen.getByText("Paid")).toBeInTheDocument()
  })

  it("ignores an in-flight recharge poll after the order is ended", async () => {
    const pendingOrder = {
      order: {
        id: "recharge-3",
        provider: "wechat_pay" as const,
        codeUrl: "weixin://wxpay/recharge-3",
        amountCents: 5_000,
        currency: "CNY",
        status: "pending" as const,
      },
    }
    let resolveStalePoll!: (value: typeof pendingOrder) => void
    const stalePoll = new Promise<typeof pendingOrder>((resolve) => {
      resolveStalePoll = resolve
    })
    const getRechargeOrder = vi.fn().mockReturnValue(stalePoll)
    window.desktop = {
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue(createOverview()),
      createAnyboxRechargeOrder: vi.fn().mockResolvedValue(pendingOrder),
      getAnyboxRechargeOrder: getRechargeOrder,
      cancelAnyboxRechargeOrder: vi.fn().mockResolvedValue({
        order: { ...pendingOrder.order, status: "canceled" as const },
      }),
    } as unknown as Window["desktop"]

    renderPanel()

    fireEvent.click(await screen.findByRole("button", { name: "WeChat Pay" }))
    fireEvent.click(screen.getByRole("button", { name: /^Pay / }))
    expect(await screen.findByRole("button", { name: "End order" })).toBeInTheDocument()
    await waitFor(() => expect(getRechargeOrder).toHaveBeenCalledWith({ orderId: "recharge-3" }), { timeout: 3_000 })

    fireEvent.click(screen.getByRole("button", { name: "End order" }))
    await waitFor(() => expect(screen.queryByText("Recharge order")).not.toBeInTheDocument())

    await act(async () => {
      resolveStalePoll(pendingOrder)
      await stalePoll
    })

    expect(screen.queryByText("Recharge order")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "End order" })).not.toBeInTheDocument()
  })
})
