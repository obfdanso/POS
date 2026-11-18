import { createContext, useReducer, useContext, useCallback, useMemo } from 'react'
import { useSettings } from './SettingsContext'
import { calculateTotals, maxRedeemablePoints, round2 } from '../utils/saleTotals'

export const CartContext = createContext(null)

// Discounts can't exceed what they apply to; re-check them whenever quantities change
function clampDiscounts(state) {
  const items = state.items.map((i) => {
    const lineGross = round2(parseFloat(i.price) * i.quantity)
    return i.discount > lineGross ? { ...i, discount: lineGross } : i
  })
  const { subtotal } = calculateTotals(items, 0, 0)
  return { ...state, items, cartDiscount: Math.min(state.cartDiscount || 0, subtotal) }
}

function cartReducer(state, action) {
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
    case 'CLEAR_CART':
      return initialState
    default:
      return state
  }
}

const initialState = {
  items: [],
  cartDiscount: 0,
  customer: null,
  redeemPoints: 0,
}

export function CartProvider({ children }) {
  const [state, dispatch] = useReducer(cartReducer, initialState)
  const { tax_rate, loyalty_point_value } = useSettings()

  const taxRate = parseFloat(tax_rate) || 0
  const pointValue = parseFloat(loyalty_point_value) || 0
  // The requested points, capped by the balance and by what is left to pay as the cart changes
  const cartSubtotal = calculateTotals(state.items, 0, 0).subtotal
  const maxPoints = state.customer
    ? maxRedeemablePoints(cartSubtotal, Math.min(state.cartDiscount || 0, cartSubtotal), state.customer.loyalty_points, pointValue)
    : 0
  const redeemPoints = Math.min(state.redeemPoints, maxPoints)
  const { subtotal, taxAmount, total, pointsDiscount } = calculateTotals(
    state.items,
    state.cartDiscount,
    taxRate,
    round2(redeemPoints * pointValue)
  )

  // Stable callbacks: POS keyboard/scanner listeners depend on them
  const addItem = useCallback((product) => {
    dispatch({ type: 'ADD_ITEM', payload: { product_id: product.id, name: product.name, price: product.price, sku: product.sku, quantity_available: product.quantity } })
  }, [])
  const removeItem = useCallback((product_id) => dispatch({ type: 'REMOVE_ITEM', payload: product_id }), [])
  const updateQuantity = useCallback((product_id, quantity) => dispatch({ type: 'UPDATE_QUANTITY', payload: { product_id, quantity } }), [])
  const updateDiscount = useCallback((product_id, discount) => dispatch({ type: 'UPDATE_DISCOUNT', payload: { product_id, discount } }), [])
  const setCartDiscount = useCallback((amount) => dispatch({ type: 'SET_CART_DISCOUNT', payload: amount }), [])
  const setCustomer = useCallback((customer) => dispatch({ type: 'SET_CUSTOMER', payload: customer }), [])
  const setRedeemPoints = useCallback((points) => dispatch({ type: 'SET_REDEEM_POINTS', payload: Math.max(0, Math.floor(points) || 0) }), [])
  const clearCart = useCallback(() => dispatch({ type: 'CLEAR_CART' }), [])
  const syncItems = useCallback((updates) => dispatch({ type: 'SYNC_ITEMS', payload: updates }), [])

  const value = useMemo(
    () => ({ ...state, redeemPoints, maxPoints, pointValue, pointsDiscount, subtotal, taxAmount, taxRate, total, addItem, removeItem, updateQuantity, updateDiscount, setCartDiscount, setCustomer, setRedeemPoints, clearCart, syncItems }),
    [state, redeemPoints, maxPoints, pointValue, pointsDiscount, subtotal, taxAmount, taxRate, total, addItem, removeItem, updateQuantity, updateDiscount, setCartDiscount, setCustomer, setRedeemPoints, clearCart, syncItems]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
