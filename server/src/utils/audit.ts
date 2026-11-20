import type { Prisma, PrismaClient } from '@prisma/client'
import prisma from './prismaClient'

export interface AuditEntry {
  userId: string
  action: string
  entity: string
  entityId?: string | null
  details?: string | null
}

/**
 * Record who performed a destructive or sensitive operation.
 * Pass a transaction client as `db` to make the audit row part of the same transaction.
 */
export function recordAudit(
  { userId, action, entity, entityId, details }: AuditEntry,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.auditLog.create({
    data: { user_id: userId, action, entity, entity_id: entityId ?? null, details: details ?? null },
  })
}
