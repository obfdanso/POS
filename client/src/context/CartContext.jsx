import { createContext, useReducer, useContext, useCallback, useMemo } from 'react'
import { useSettings } from './SettingsContext'
import { calculateTotals, round2 } from '../utils/saleTotals'

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
      const existing = state.items.find((i) => i.product_id === action.payload.product_id)
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            i.product_id === action.payload.product_id
              ? { ...i, quantity: i.quantity + 1 }
              : i
          ),
        }
      }
      return { ...state, items: [...state.items, { ...action.payload, quantity: 1, discount: 0 }] }
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
    case 'SET_CART_DISCOUNT':
      return clampDiscounts({ ...state, cartDiscount: action.payload })
    case 'SET_CUSTOMER':
      return { ...state, customer: action.payload }
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
}

export function CartProvider({ children }) {
  const [state, dispatch] = useReducer(cartReducer, initialState)
  const { tax_rate } = useSettings()

  const taxRate = parseFloat(tax_rate) || 0
  const { subtotal, taxAmount, total } = calculateTotals(state.items, state.cartDiscount, taxRate)

  // Stable callbacks: POS keyboard/scanner listeners depend on them
  const addItem = useCallback((product) => {
    dispatch({ type: 'ADD_ITEM', payload: { product_id: product.id, name: product.name, price: product.price, sku: product.sku, quantity_available: product.quantity } })
  }, [])
  const removeItem = useCallback((product_id) => dispatch({ type: 'REMOVE_ITEM', payload: product_id }), [])
  const updateQuantity = useCallback((product_id, quantity) => dispatch({ type: 'UPDATE_QUANTITY', payload: { product_id, quantity } }), [])
  const updateDiscount = useCallback((product_id, discount) => dispatch({ type: 'UPDATE_DISCOUNT', payload: { product_id, discount } }), [])
  const setCartDiscount = useCallback((amount) => dispatch({ type: 'SET_CART_DISCOUNT', payload: amount }), [])
  const setCustomer = useCallback((customer) => dispatch({ type: 'SET_CUSTOMER', payload: customer }), [])
  const clearCart = useCallback(() => dispatch({ type: 'CLEAR_CART' }), [])

  const value = useMemo(
    () => ({ ...state, subtotal, taxAmount, taxRate, total, addItem, removeItem, updateQuantity, updateDiscount, setCartDiscount, setCustomer, clearCart }),
    [state, subtotal, taxAmount, taxRate, total, addItem, removeItem, updateQuantity, updateDiscount, setCartDiscount, setCustomer, clearCart]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
