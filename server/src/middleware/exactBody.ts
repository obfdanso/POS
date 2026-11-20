import { checkExact, type ValidationChain } from 'express-validator'

/**
 * Wraps a route's validation chains so the request body may only contain the
 * fields those chains declare; anything else is rejected with a 422.
 * Use as `exactBody([...chains])` in place of the bare chain list, followed by `validate`.
 */
function exactBody(chains: ValidationChain[]) {
  return [...chains, checkExact(chains, { locations: ['body'], message: 'Unexpected fields in request body' })]
}

export default exactBody
