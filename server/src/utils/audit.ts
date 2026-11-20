const prisma = require('./prismaClient')

/**
 * Record who performed a destructive or sensitive operation.
 * Pass a transaction client as `db` to make the audit row part of the same transaction.
 * @param {{ userId: string, action: string, entity: string, entityId?: string, details?: string }} entry
 * @param {import('@prisma/client').PrismaClient} [db]
 */
function recordAudit({ userId, action, entity, entityId, details }, db = prisma) {
  return db.auditLog.create({
    data: { user_id: userId, action, entity, entity_id: entityId ?? null, details: details ?? null },
  })
}

module.exports = { recordAudit }
