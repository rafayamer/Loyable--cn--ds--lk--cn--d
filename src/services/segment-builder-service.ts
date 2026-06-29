// ================================================================
//  segment-builder-service.ts
//  No-code custom segment builder.
//
//  A segment is stored as a JSON rule tree:
//  {
//    "logic": "AND",
//    "conditions": [
//      { "field": "lastVisitAt",  "op": "gt",      "value": "30" },   // days
//      { "field": "totalSpend",   "op": "gte",     "value": "200" },
//      { "field": "visitCount",   "op": "gte",     "value": "3" },
//      { "field": "tier",         "op": "eq",      "value": "Gold" },
//      { "field": "churnRiskScore","op": "gte",    "value": "70" }
//    ]
//  }
//
//  Supported fields: lastVisitAt (days since), totalSpend, visitCount,
//    pointsBalance, referralCount, churnRiskScore, tier
//  Supported operators: gt, gte, lt, lte, eq, neq
// ================================================================

import { Prisma } from '@prisma/client';
import { prisma }       from '../config/prisma';

// ── Types ─────────────────────────────────────────────────────────

export type SegmentOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
export type SegmentField =
  | 'lastVisitAt'    // days since last visit
  | 'totalSpend'     // total spend in currency units
  | 'visitCount'
  | 'pointsBalance'
  | 'referralCount'
  | 'churnRiskScore'
  | 'tier';          // matches tier name (string)

export interface SegmentCondition {
  field: SegmentField;
  op:    SegmentOp;
  value: string;     // always string; parsed to number/date inside evaluator
}

export interface SegmentRuleTree {
  logic:      'AND' | 'OR';
  conditions: SegmentCondition[];
}

export interface CustomSegment {
  id:          string;
  businessId:  string;
  name:        string;
  description: string | null;
  rulesJson:   SegmentRuleTree;
  createdAt:   Date;
  updatedAt:   Date;
}

// ── SQL builder ───────────────────────────────────────────────────

const OPS: Record<SegmentOp, string> = {
  gt:  '>',
  gte: '>=',
  lt:  '<',
  lte: '<=',
  eq:  '=',
  neq: '!=',
};

/** Builds a raw SQL WHERE fragment for a single condition. */
function buildCondition(cond: SegmentCondition): string | null {
  const op = OPS[cond.op] ?? '=';
  const val = cond.value.replace(/'/g, "''"); // basic SQL-injection guard; params used for businessId

  switch (cond.field) {
    case 'lastVisitAt':
      // value = days since last visit
      return `EXTRACT(EPOCH FROM (NOW() - c."lastVisitAt")) / 86400 ${op} ${parseFloat(val) || 0}`;

    case 'totalSpend':
      return `c."totalSpend" ${op} ${parseFloat(val) || 0}`;

    case 'visitCount':
      return `c."visitCount" ${op} ${parseInt(val) || 0}`;

    case 'pointsBalance':
      return `c."pointsBalance" ${op} ${parseInt(val) || 0}`;

    case 'referralCount':
      return `(SELECT COUNT(*) FROM "customers" r WHERE r."referredById" = c."id") ${op} ${parseInt(val) || 0}`;

    case 'churnRiskScore':
      return `c."churnRiskScore" ${op} ${parseInt(val) || 0}`;

    case 'tier':
      // value = tier name; join via currentTierId
      if (cond.op === 'eq')  return `(SELECT t."name" FROM "tiers" t WHERE t."id" = c."currentTierId") = '${val}'`;
      if (cond.op === 'neq') return `(SELECT t."name" FROM "tiers" t WHERE t."id" = c."currentTierId") != '${val}'`;
      return null;

    default:
      return null;
  }
}

function buildWhereClause(rules: SegmentRuleTree): string {
  const fragments = rules.conditions
    .map(buildCondition)
    .filter(Boolean) as string[];

  if (fragments.length === 0) return 'true';

  const joiner = rules.logic === 'OR' ? ' OR ' : ' AND ';
  return `(${fragments.join(joiner)})`;
}

// ── Evaluate segment → customer IDs ──────────────────────────────

export const evaluateSegment = async (
  businessId: string,
  rules:      SegmentRuleTree,
  limit = 10_000
): Promise<string[]> => {
  const where = buildWhereClause(rules);
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    SELECT c."id"
    FROM   "customers" c
    WHERE  c."businessId" = $1
      AND  c."isActive"   = true
      AND  c."isStaff"    = false
      AND  c."isSuppressed" = false
      AND  c."marketingConsentWhatsapp" = true
      AND  ${where}
    LIMIT  ${limit}
  `, businessId);

  return rows.map(r => r.id);
};

// ── CRUD for saved custom segments ───────────────────────────────

export const listCustomSegments = async (businessId: string) => {
  const rows = await (prisma as any).customSegment.findMany({
    where:   { businessId },
    orderBy: { updatedAt: 'desc' },
  });
  return rows;
};

export const createCustomSegment = async (
  businessId:  string,
  name:        string,
  description: string | null,
  rules:       SegmentRuleTree
) => {
  return (prisma as any).customSegment.create({
    data: { businessId, name, description, rulesJson: rules as unknown as Prisma.InputJsonValue },
  });
};

export const updateCustomSegment = async (
  id:          string,
  businessId:  string,
  name?:       string,
  description?: string | null,
  rules?:      SegmentRuleTree
) => {
  const existing = await (prisma as any).customSegment.findFirst({ where: { id, businessId } });
  if (!existing) throw new Error('CUSTOM_SEGMENT_NOT_FOUND');
  return (prisma as any).customSegment.update({
    where: { id },
    data: {
      ...(name        !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(rules       !== undefined && { rulesJson: rules as unknown as Prisma.InputJsonValue }),
      updatedAt: new Date(),
    },
  });
};

export const deleteCustomSegment = async (id: string, businessId: string) => {
  const existing = await (prisma as any).customSegment.findFirst({ where: { id, businessId } });
  if (!existing) throw new Error('CUSTOM_SEGMENT_NOT_FOUND');
  await (prisma as any).customSegment.delete({ where: { id } });
};
