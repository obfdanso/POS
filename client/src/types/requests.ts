// Request bodies the client sends (see docs/API.md)
import type { PaymentMethod, SinglePaymentMethod } from './models'

export interface SaleItemInput {
  product_id: string
  quantity: number
  /** The cashier's own discount on the line (promotions are applied by the server) */
  discount?: number
}

export interface SplitPaymentInput {
  method: SinglePaymentMethod
  amount: number
  reference?: string
}

/** `POST /sales` */
export interface CreateSalePayload {
  items: SaleItemInput[]
  customer_id?: string | null
  payment_method: PaymentMethod
  amount_paid?: number
  /** SPLIT only */
  payments?: SplitPaymentInput[]
  discount_amount?: number
  redeem_points?: number
  /** MOBILE_MONEY and CARD: the Paystack reference */
  reference?: string
  notes?: string
  /** The till's own id for the sale, so resending it never records it twice */
  client_ref?: string
}

/** `POST /sales/:id/refund`; no items refunds everything left */
export interface RefundPayload {
  items?: { sale_item_id: string; quantity: number; restock?: boolean }[]
  reason?: string
}

/** `POST /purchase-orders` */
export interface CreatePurchaseOrderPayload {
  supplier_id: string
  items: { product_id: string; quantity: number; unit_cost: number }[]
  expected_at?: string | null
  notes?: string
}

/** `POST /purchase-orders/:id/receive`; no items receives everything outstanding */
export interface ReceivePurchaseOrderPayload {
  items?: { item_id: string; quantity: number }[]
  update_cost?: boolean
  notes?: string
}

/** `POST /promotions` (and `PUT`, with any of the fields) */
export interface PromotionPayload {
  name: string
  percent_off: number | string
  product_id?: string | null
  category_id?: string | null
  starts_at?: string | null
  ends_at?: string | null
  is_active?: boolean
}
