// Response envelopes every API endpoint uses (see docs/API.md, "Response format")

export interface ApiSuccess<T> {
  success: true
  data: T
  message?: string
}

/** A success response whose endpoint always says what it did (shown to the user as a toast) */
export interface ApiMessage<T> extends ApiSuccess<T> {
  message: string
}

export interface PaginationMeta {
  page: number
  per_page: number
  total: number
  total_pages: number
}

export interface ApiPaginated<T> {
  success: true
  data: T[]
  meta: PaginationMeta
  message?: string
}

export interface ApiFieldError {
  field: string
  message: string
}

export interface ApiErrorBody {
  code: string
  message: string
  details?: ApiFieldError[]
  /** Present on unexpected server errors; matches the server log entry */
  request_id?: string
}

export interface ApiErrorResponse {
  success: false
  error: ApiErrorBody
}

/** Query-string parameters for list and report endpoints (page, per_page, search, dates, filters) */
export type QueryParams = Record<string, string | number | boolean | null | undefined>
