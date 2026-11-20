import { createContext, useReducer, useContext, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react'
import { useSettings } from './SettingsContext'
import { useBranch } from '../hooks/useBranch'
import { applyPromotions, calculateTotals, maxRedeemablePoints, round2, type PricedLine } from '../utils/saleTotals'
import type { ActivePromotion, Customer, Money, Product } from '../types'

/** A line in the cart, before promotions are applied */
export interface CartItem {
  product_id: string
  category_id: string
  name: string
  price: Money
  sku: string
  /** Stock on hand at the branch when the product was last looked up */
  quantity_available: number
  quantity: number
  /** The cashier's own discount on the line */
  discount: number
}

/** A cart line priced with its promotion */
export type PricedCartItem = PricedLine<CartItem, ActivePromotion>

/** Latest price and stock for a product in the cart, fetched from the server */
export type CartItemUpdate = Pick<CartItem, 'price' | 'quantity_available'>

export interface CartState {
  items: CartItem[]
  cartDiscount: number
  customer: Customer | null
  redeemPoints: number
  promotions: ActivePromotion[]
}

export interface CartContextValue extends Omit<CartState, 'items'> {
  items: PricedCartItem[]
  maxPoints: number
  pointValue: number
  pointsDiscount: number
  subtotal: number
  taxAmount: number
  taxRate: number
  total: number
  addItem: (product: Product) => void
  removeItem: (product_id: string) => void
  updateQuantity: (product_id: string, quantity: number) => void
  updateDiscount: (product_id: string, discount: number) => void
  setCartDiscount: (amount: number) => void
  setCustomer: (customer: Customer | null) => void
  setRedeemPoints: (points: number) => void
  clearCart: () => void
  syncItems: (updates: Record<string, CartItemUpdate>) => void
  setPromotions: (promotions: ActivePromotion[]) => void
}

type CartAction =
  | { type: 'ADD_ITEM'; payload: Omit<CartItem, 'quantity' | 'discount'> }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'UPDATE_QUANTITY'; payload: { product_id: string; quantity: number } }
  | { type: 'UPDATE_DISCOUNT'; payload: { product_id: string; discount: number } }
  | { type: 'SYNC_ITEMS'; payload: Record<string, CartItemUpdate> }
  | { type: 'SET_CART_DISCOUNT'; payload: number }
  | { type: 'SET_CUSTOMER'; payload: Customer | null }
  | { type: 'SET_REDEEM_POINTS'; payload: number }
  | { type: 'SET_PROMOTIONS'; payload: ActivePromotion[] }
  | { type: 'CLEAR_CART' }

export const CartContext = createContext<CartContextValue | null>(null)

// Discounts can't exceed what they apply to (a line's discount comes off what is left after its
// promotion); re-check them whenever quantities, prices or promotions change
function clampDiscounts(state: CartState): CartState {
  const priced = applyPromotions(state.items, state.promotions)
  const items = state.items.map((i, index) => (i.discount > priced[index].discount ? { ...i, discount: priced[index].discount } : i))
  const { subtotal } = calculateTotals(priced, 0, 0)
  return { ...state, items, cartDiscount: Math.min(state.cartDiscount || 0, subtotal) }
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const { payload } = action
      const existing = state.items.find((i) => i.product_id === payload.product_id)
      if (existing) {
        // Never go past the stock on hand, even if two scans resolve before a re-render
        if (existing.quantity >= payload.quantity_available) return state
        // Take the latest price and stock from the product just looked up
        return clampDiscounts({
          ...state,
          items: state.items.map((i) =>
            i.product_id === payload.product_id
              ? { ...i, price: payload.price, quantity_available: payload.quantity_available, quantity: i.quantity + 1 }
              : i
          ),
        })
      }
      if (payload.quantity_available < 1) return state
      return { ...state, items: [...state.items, { ...payload, quantity: 1, discount: 0 }] }
    }
    case 'REMOVE_ITEM':
      return clampDiscounts({ ...state, items: state.items.filter((i) => i.product_id !== action.payload) })
    case 'UPDATE_QUANTITY':
      return clampDiscounts({
        ...state,
        items: state.items
          .map((i) =>
            i.product_id === action.payload.product_id ? { ...i, quantity: action.payload.quantity } : i
          )
          .filter((i) => i.quantity > 0),
      })
    case 'UPDATE_DISCOUNT':
      return clampDiscounts({
        ...state,
        items: state.items.map((i) =>
          i.product_id === action.payload.product_id ? { ...i, discount: action.payload.discount } : i
        ),
      })
    case 'SYNC_ITEMS': {
      // payload: { [product_id]: { price, quantity_available } } fetched from the server
      return clampDiscounts({
        ...state,
        items: state.items.map((i) => (action.payload[i.product_id] ? { ...i, ...action.payload[i.product_id] } : i)),
      })
    }
    case 'SET_CART_DISCOUNT':
      return clampDiscounts({ ...state, cartDiscount: action.payload })
    case 'SET_CUSTOMER':
      // Points belong to the customer, so a different customer starts with none redeemed
      return { ...state, customer: action.payload, redeemPoints: 0 }
    case 'SET_REDEEM_POINTS':
      return { ...state, redeemPoints: action.payload }
    case 'SET_PROMOTIONS':
      return clampDiscounts({ ...state, promotions: action.payload })
    case 'CLEAR_CART':
      // Promotions belong to the store, not the sale, so they stay loaded
      return { ...initialState, promotions: state.promotions }
    default:
      return state
  }
}

const initialState: CartState = {
  items: [],
  cartDiscount: 0,
  customer: null,
  redeemPoints: 0,
  // Running promotions (GET /promotions/active), applied to every line automatically
  promotions: [],
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, initialState)
  const { tax_rate, loyalty_point_value } = useSettings()

  const taxRate = parseFloat(tax_rate) || 0
  const pointValue = parseFloat(loyalty_point_value) || 0
  // Lines priced with their promotions; `discount` on each stays the cashier's own discount
  const pricedItems = useMemo(() => applyPromotions(state.items, state.promotions), [state.items, state.promotions])
  // The requested points, capped by the balance and by what is left to pay as the cart changes
  const cartSubtotal = calculateTotals(pricedItems, 0, 0).subtotal
  const maxPoints = state.customer
    ? maxRedeemablePoints(cartSubtotal, Math.min(state.cartDiscount || 0, cartSubtotal), state.customer.loyalty_points, pointValue)
    : 0
  const redeemPoints = Math.min(state.redeemPoints, maxPoints)
  const { subtotal, taxAmount, total, pointsDiscount } = calculateTotals(
    pricedItems,
    state.cartDiscount,
    taxRate,
    round2(redeemPoints * pointValue)
  )

  // Stable callbacks: POS keyboard/scanner listeners depend on them
  const addItem = useCallback((product: Product) => {
    dispatch({
      type: 'ADD_ITEM',
      payload: { product_id: product.id, category_id: product.category_id, name: product.name, price: product.price, sku: product.sku, quantity_available: product.quantity },
    })
  }, [])
  const removeItem = useCallback((product_id: string) => dispatch({ type: 'REMOVE_ITEM', payload: product_id }), [])
  const updateQuantity = useCallback((product_id: string, quantity: number) => dispatch({ type: 'UPDATE_QUANTITY', payload: { product_id, quantity } }), [])
  const updateDiscount = useCallback((product_id: string, discount: number) => dispatch({ type: 'UPDATE_DISCOUNT', payload: { product_id, discount } }), [])
  const setCartDiscount = useCallback((amount: number) => dispatch({ type: 'SET_CART_DISCOUNT', payload: amount }), [])
  const setCustomer = useCallback((customer: Customer | null) => dispatch({ type: 'SET_CUSTOMER', payload: customer }), [])
  const setRedeemPoints = useCallback((points: number) => dispatch({ type: 'SET_REDEEM_POINTS', payload: Math.max(0, Math.floor(points) || 0) }), [])
  const clearCart = useCallback(() => dispatch({ type: 'CLEAR_CART' }), [])
  const syncItems = useCallback((updates: Record<string, CartItemUpdate>) => dispatch({ type: 'SYNC_ITEMS', payload: updates }), [])
  const setPromotions = useCallback((promotions: ActivePromotion[]) => dispatch({ type: 'SET_PROMOTIONS', payload: promotions }), [])

  // A cart belongs to one branch's stock, so switching branch starts a new one
  const { branchId } = useBranch()
  const cartBranch = useRef(branchId)
  useEffect(() => {
    if (cartBranch.current !== branchId) {
      cartBranch.current = branchId
      dispatch({ type: 'CLEAR_CART' })
    }
  }, [branchId])

  const value = useMemo(
    (): CartContextValue => ({ ...state, items: pricedItems, redeemPoints, maxPoints, pointValue, pointsDiscount, subtotal, taxAmount, taxRate, total, addItem, removeItem, updateQuantity, updateDiscount, setCartDiscount, setCustomer, setRedeemPoints, clearCart, syncItems, setPromotions }),
    [state, pricedItems, redeemPoints, maxPoints, pointValue, pointsDiscount, subtotal, taxAmount, taxRate, total, addItem, removeItem, updateQuantity, updateDiscount, setCartDiscount, setCustomer, setRedeemPoints, clearCart, syncItems, setPromotions]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
