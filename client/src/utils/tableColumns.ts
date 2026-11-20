import type { ReactNode } from 'react'

export type SortOrder = 'asc' | 'desc'

/** The column a table is sorted by: its `sortKey` (or `key`) and the direction */
export interface TableSort {
  key: string
  order: SortOrder
}

interface ColumnBase<T> {
  label: string
  sortable?: boolean
  /** Field sent to the server when sorting; defaults to `key` */
  sortKey?: string
  /** Value used when sorting in the browser; defaults to `row[key]` */
  sortValue?: (row: T) => unknown
}

/**
 * A column of rows of type T. `key` is usually a field of T, and `render` then gets that field's
 * value; any other key (e.g. 'actions') gets undefined and renders from the row.
 */
export type Column<T, K extends string = string> = ColumnBase<T> & {
  key: K
  render?: (value: K extends keyof T ? T[K] : undefined, row: T) => ReactNode
}

/** What Table accepts: any Column<T, K> fits, whatever its key */
export type TableColumn<T> = ColumnBase<T> & {
  key: string
  render?: (value: never, row: T) => ReactNode
}

/**
 * Types a list of columns for rows of type T, so each `render` gets the type of its own field:
 * `const columns = defineColumns<Product>()([{ key: 'price', label: 'Price', render: (v) => formatCurrency(v) }])`
 */
export function defineColumns<T>() {
  return <const K extends readonly string[]>(columns: [...{ [I in keyof K]: Column<T, K[I]> }]) => columns
}
