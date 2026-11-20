import type { User } from '@prisma/client'

/** The signed-in user that `authenticate` puts on `req.user`. */
export type AuthUser = Pick<User, 'id' | 'username' | 'email' | 'full_name' | 'role' | 'is_active' | 'branch_id'>

declare global {
  // Express's own types are declared in this namespace, so augmenting it needs one too
  namespace Express {
    interface Request {
      /** Set by the requestId middleware on every request. */
      id?: string
      /** Set by `authenticate`. */
      user?: AuthUser
      /** Set by `authenticate` (via resolveBranch): the branch the request acts on, or null for all branches. */
      branchId?: string | null
      /** The exact JSON body bytes, kept only for the Paystack webhook (its signature covers them). */
      rawBody?: Buffer
    }
  }
}
