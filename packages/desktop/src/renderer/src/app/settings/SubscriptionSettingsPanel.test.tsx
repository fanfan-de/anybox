import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
})
