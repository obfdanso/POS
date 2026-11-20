// Domain records as the API returns them (field names follow server/prisma/schema.prisma).
// Dates arrive as ISO strings. Prisma Decimal columns arrive as decimal strings (see Money).

/** A Prisma Decimal serialized to JSON, e.g. "12.5". Parse it before doing arithmetic. */
export type Money = string

/** A money value from the API or one the client computed itself */
export type MoneyLike = Money | number

export type Role = 'ADMIN' | 'MANAGER' | 'CASHIER'
export type PaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'SPLIT'
/** The methods a single payment part can use (a split sale is made of these) */
export type SinglePaymentMethod = Exclude<PaymentMethod, 'SPLIT'>
export type PaymentStatus = 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'PENDING'
export type GatewayRefundStatus = 'NOT_SENT' | 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED'
export type ShiftStatus = 'OPEN' | 'CLOSED'
export type InventoryChangeType = 'SALE' | 'RESTOCK' | 'ADJUSTMENT' | 'RETURN'
export type PurchaseOrderStatus = 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED'
export type PromotionStatus = 'ACTIVE' | 'SCHEDULED' | 'ENDED' | 'OFF'

export interface Timestamps {
  created_at: string
  updated_at: string
}

export interface Branch extends Timestamps {
  id: string
  name: string
  code: string
  address: string | null
  phone: string | null
  is_active: boolean
}

/** A branch as embedded in other records (and as `GET /branches?active=true` lists them) */
export type BranchRef = Pick<Branch, 'id' | 'name' | 'code'> & Partial<Pick<Branch, 'address' | 'phone' | 'is_active'>>

export interface User extends Timestamps {
  id: string
  username: string
  email: string
  full_name: string
  role: Role
  is_active: boolean
  branch_id?: string | null
  branch?: BranchRef | null
  /** `GET /users` only */
  locked_until?: string | null
  /** `GET /users` only */
  is_locked?: boolean
}

/** A user as embedded in other records (cashier on a sale, who processed a refund) */
export type UserRef = Pick<User, 'id' | 'full_name'> & Partial<Pick<User, 'username' | 'role'>>

export interface Category extends Timestamps {
  id: string
  name: string
  description: string | null
  _count?: { products: number }
}

export interface Supplier extends Timestamps {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  website: string | null
  /** `GET /suppliers` rows */
  product_count?: number
  /** `GET /suppliers/:id`: its active products */
  products?: Product[]
}

export interface BranchStock {
  branch_id: string
  branch?: BranchRef
  quantity: number
  low_stock_threshold: number
}

export interface Product extends Timestamps {
  id: string
  name: string
  sku: string
  barcode: string | null
  category_id: string
  supplier_id: string | null
  price: Money
  cost_price: Money | null
  /** Stock at the acting branch (summed across branches for an admin viewing all) */
  quantity: number
  low_stock_threshold: number
  stocked?: boolean
  image_url: string | null
  is_active: boolean
  parent_id: string | null
  variant_name: string | null
  category?: Pick<Category, 'id' | 'name'>
  supplier?: Pick<Supplier, 'id' | 'name'> | null
  parent?: Pick<Product, 'id' | 'name'> | null
  variants?: Product[]
  stocks?: BranchStock[]
  _count?: { variants: number }
}

export interface Customer extends Timestamps {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  loyalty_points: number
  /** `GET /customers` rows: lifetime spend on completed sales */
  total_purchases?: number
  /** `GET /customers/:id` */
  purchase_summary?: CustomerPurchaseSummary
}

export interface CustomerPurchaseSummary {
  total_spent: number
  purchase_count: number
  average_purchase: number
  last_purchase_at: string | null
}

export interface Payment extends Timestamps {
  id: string
  sale_id: string
  method: SinglePaymentMethod
  amount_paid: Money
  change_given: Money
  /** Left out of another branch's sale */
  reference?: string | null
}

export interface SaleItem extends Timestamps {
  id: string
  sale_id: string
  product_id: string
  quantity: number
  unit_price: Money
  unit_cost: Money | null
  discount: Money
  total: Money
  refunded_quantity: number
  promotion_id: string | null
  promotion_discount: Money
  product?: Pick<Product, 'id' | 'name' | 'sku'>
  promotion?: Pick<Promotion, 'id' | 'name' | 'percent_off'> | null
}

export interface RefundItem {
  sale_item_id: string
  quantity: number
  amount: Money
  restocked: boolean
}

export interface Refund extends Timestamps {
  id: string
  sale_id: string
  user_id: string
  shift_id: string | null
  amount: Money
  method: PaymentMethod
  cash_amount: Money
  reason: string
  gateway_status: GatewayRefundStatus | null
  gateway_amount: Money | null
  gateway_reference?: string | null
  gateway_refund_id?: string | null
  gateway_error?: string | null
  /** Another branch's sale hides the gateway fields and says only whether there is a reference */
  has_gateway_reference?: boolean
  branch_id: string
  user?: UserRef
  branch?: BranchRef
  items: RefundItem[]
}

export interface Sale extends Timestamps {
  id: string
  transaction_id: string
  user_id: string
  customer_id: string | null
  subtotal: Money
  discount_amount: Money
  tax_amount: Money
  total_amount: Money
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  notes: string | null
  loyalty_points_earned: number
  refunded_amount: Money
  loyalty_points_reversed: number
  loyalty_points_redeemed: number
  points_discount: Money
  loyalty_points_restored: number
  client_ref: string | null
  shift_id: string | null
  branch_id: string
  user?: UserRef
  customer?: Pick<Customer, 'id' | 'name'> & Partial<Pick<Customer, 'phone' | 'email'>> | null
  branch?: BranchRef
  /** Single sale responses: lines with their product */
  items?: SaleItem[]
  /** Single sale responses: every payment part, cash first */
  payments?: Payment[]
  /** Single sale responses: the first of `payments` */
  payment?: Payment | null
  refunds?: Refund[]
  /** List rows */
  items_count?: number
}

/** `GET /sales/:id/receipt` */
export interface ReceiptData {
  store: { name: string; address: string; phone: string }
  sale: Sale
}

export interface ShiftMethodTotal {
  count: number
  total: number
}

export interface ShiftSummary {
  sales_count: number
  sales_total: number
  by_method: Record<SinglePaymentMethod, ShiftMethodTotal>
  split_count: number
  cash_sales: number
  cash_refunds: number
  expected_cash: number
}

export interface Shift extends Timestamps {
  id: string
  user_id: string
  status: ShiftStatus
  opening_float: Money
  expected_cash: Money | null
  counted_cash: Money | null
  difference: Money | null
  opened_at: string
  closed_at: string | null
  closed_by_id: string | null
  notes: string | null
  branch_id: string
  user?: UserRef
  closed_by?: UserRef | null
  branch?: BranchRef
  summary?: ShiftSummary
  /** List rows */
  sales_count?: number
}

/** A single shift response (current, open, close, get): always has its takings */
export type ShiftWithSummary = Shift & { summary: ShiftSummary }

export interface InventoryLog extends Timestamps {
  id: string
  product_id: string
  change_type: InventoryChangeType
  quantity_change: number
  previous_quantity: number
  new_quantity: number
  user_id: string
  notes: string | null
  branch_id: string
  user?: UserRef
  branch?: BranchRef
}

/** Store settings: every value is a string, as stored in the Settings table */
export interface Settings {
  store_name: string
  store_address: string
  store_phone: string
  tax_rate: string
  loyalty_points_rate: string
  loyalty_point_value: string
  currency_symbol: string
  receipt_footer: string
  require_open_shift?: string
}

export interface Promotion extends Timestamps {
  id: string
  name: string
  percent_off: Money
  product_id: string | null
  category_id: string | null
  starts_at: string
  ends_at: string | null
  is_active: boolean
  product?: Pick<Product, 'id' | 'name'> | null
  category?: Pick<Category, 'id' | 'name'> | null
  status?: PromotionStatus
  /** `GET /promotions`: sale lines it was applied to */
  times_used?: number
}

/** `GET /promotions/active`: what the till needs to price the cart */
export type ActivePromotion = Pick<Promotion, 'id' | 'name' | 'percent_off' | 'product_id' | 'category_id' | 'ends_at'>

export interface PurchaseOrderItem extends Timestamps {
  id: string
  purchase_order_id: string
  product_id: string
  quantity_ordered: number
  quantity_received: number
  quantity_outstanding: number
  unit_cost: Money
  product?: Pick<Product, 'id' | 'name' | 'sku'> & Partial<Product>
}

export interface PurchaseOrder extends Timestamps {
  id: string
  po_number: string
  supplier_id: string
  created_by_id: string
  status: PurchaseOrderStatus
  total_cost: Money
  expected_at: string | null
  received_at: string | null
  notes: string | null
  branch_id: string
  supplier?: Pick<Supplier, 'id' | 'name'> & Partial<Supplier>
  created_by?: UserRef
  branch?: BranchRef
  items?: PurchaseOrderItem[]
  item_count?: number
  units_ordered?: number
  units_received?: number
}

/** A single purchase order response (create, get, receive, cancel): with its supplier, creator and lines */
export type PurchaseOrderDetail = Omit<PurchaseOrder, 'supplier' | 'created_by' | 'branch' | 'items'> & {
  supplier: Pick<Supplier, 'id' | 'name' | 'phone' | 'email'>
  created_by: UserRef
  branch: BranchRef
  items: (PurchaseOrderItem & { product: Pick<Product, 'id' | 'name' | 'sku' | 'cost_price'> })[]
}

/** `GET /purchase-orders/suggestions`: a low-stock product to reorder */
export interface PurchaseSuggestion extends Pick<Product, 'name' | 'sku' | 'quantity' | 'low_stock_threshold'> {
  product_id: string
  on_order: number
  /** The product's last cost price, as a number */
  unit_cost: number | null
  suggested_quantity: number
}

/** Report rows ready for charts */
export interface ChartPoint {
  label: string
  value: number
}

export interface SalesSummaryReport {
  total_revenue: number
  transaction_count: number
  average_sale: number
  total_discount: number
  total_tax: number
}

export interface DashboardReport {
  today_revenue: number
  today_transactions: number
  low_stock_alerts: number
  top_products: { name: string; revenue: number; quantity: number }[]
}

export interface SalesByDayRow extends ChartPoint {
  transactions: number
}

export interface TopProductRow extends ChartPoint {
  sku: string
  quantity: number
}

export interface CategoryPerformanceRow extends ChartPoint {
  quantity: number
}

export interface CashierPerformanceRow extends ChartPoint {
  username: string
  transactions: number
}

export interface BranchPerformanceRow extends ChartPoint {
  id: string
  code: string
  transactions: number
  refunds: number
}

export interface InventoryStatusRow {
  id: string
  name: string
  sku: string
  quantity: number
  low_stock_threshold?: number
  /** The branch's name */
  branch: string
}

export interface InventoryStatusReport {
  total_products: number
  low_stock_count: number
  out_of_stock_count: number
  low_stock: InventoryStatusRow[]
  out_of_stock: InventoryStatusRow[]
}

export interface ProfitRow {
  id: string
  name: string
  sku: string
  revenue: number
  cost: number
  profit: number
  margin: number
}
