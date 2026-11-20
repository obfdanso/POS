/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Paystack public key for card and Mobile Money payments at the till */
  readonly VITE_PAYSTACK_PUBLIC_KEY?: string
  /** Sentry DSN; error reporting is off when unset */
  readonly VITE_SENTRY_DSN?: string
  /** Release name attached to Sentry reports */
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
