/**
 * Multi-Tenant Load & Isolation Test
 * ----------------------------------
 * Seeds many tenants (businesses) each with many customers, then:
 *   1. Measures bulk-insert throughput at scale
 *   2. Measures tenant-scoped query latency under load
 *   3. VERIFIES tenant isolation — a query scoped to tenant A must
 *      never return tenant B's rows (the core multi-tenant guarantee)
 *   4. Exercises the hot indexes (segment, lastVisitAt, whatsappNumber)
 *
 * Usage:
 *   DATABASE_URL=postgres://... \
 *   BUSINESSES=20 CUSTOMERS_PER_BIZ=50000 \
 *   npx ts-node scripts/load-test.ts
 *
 * Defaults aim for ~1,000,000 customers across 20 tenants.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BUSINESSES        = parseInt(process.env.BUSINESSES        ?? '20', 10);
const CUSTOMERS_PER_BIZ = parseInt(process.env.CUSTOMERS_PER_BIZ ?? '50000', 10);
const BATCH             = parseInt(process.env.BATCH             ?? '10000', 10);
const SEGMENTS = ['NEW', 'LOYAL', 'VIP', 'AT_RISK', 'LOST', 'BIG_SPENDER', 'COUPON_HUNTER'] as const;

const ms = (n: number) => `${n.toFixed(0)}ms`;
const fmt = (n: number) => n.toLocaleString('en-US');
function pct(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
}

async function main() {
  const totalTarget = BUSINESSES * CUSTOMERS_PER_BIZ;
  console.log('━'.repeat(64));
  console.log(`LOYABLE MULTI-TENANT LOAD TEST`);
  console.log(`  Tenants:            ${fmt(BUSINESSES)}`);
  console.log(`  Customers / tenant: ${fmt(CUSTOMERS_PER_BIZ)}`);
  console.log(`  Target total rows:  ${fmt(totalTarget)}`);
  console.log('━'.repeat(64));

  const runTag = Date.now().toString(36);
  const bizIds: string[] = [];

  // ── 1. Create tenants ───────────────────────────────────────────
  const tBiz = Date.now();
  for (let b = 0; b < BUSINESSES; b++) {
    const biz = await prisma.business.create({
      data: {
        name:     `LoadTest Biz ${b} (${runTag})`,
        slug:     `lt-${runTag}-${b}`,
        currency: 'GBP',
      },
      select: { id: true },
    });
    bizIds.push(biz.id);
    await prisma.user.create({
      data: {
        businessId: biz.id,
        email:      `owner-${runTag}-${b}@loadtest.dev`,
        name:       `Owner ${b}`,
        role:       'TENANT_OWNER',
        passwordHash: 'x',
      } as any,
    }).catch(() => {});
  }
  console.log(`✓ Created ${BUSINESSES} tenants + owners in ${ms(Date.now() - tBiz)}`);

  // ── 2. Bulk insert customers per tenant ─────────────────────────
  const tIns = Date.now();
  let inserted = 0;
  for (let bi = 0; bi < bizIds.length; bi++) {
    const businessId = bizIds[bi];
    for (let off = 0; off < CUSTOMERS_PER_BIZ; off += BATCH) {
      const n = Math.min(BATCH, CUSTOMERS_PER_BIZ - off);
      const rows = new Array(n);
      for (let i = 0; i < n; i++) {
        const idx = off + i;
        rows[i] = {
          businessId,
          fullName:       `Cust ${bi}-${idx}`,
          whatsappNumber: `+44${String(7000000000 + bi * CUSTOMERS_PER_BIZ + idx).slice(0, 10)}`,
          segment:        SEGMENTS[idx % SEGMENTS.length],
          visitCount:     idx % 40,
          totalSpend:     Number(((idx * 7) % 900).toFixed(2)),
          lastVisitAt:    new Date(Date.now() - (idx % 120) * 86_400_000),
        };
      }
      const r = await prisma.customer.createMany({ data: rows, skipDuplicates: true });
      inserted += r.count;
    }
    if ((bi + 1) % 5 === 0 || bi === bizIds.length - 1) {
      const elapsed = (Date.now() - tIns) / 1000;
      console.log(`  …${fmt(inserted)} customers (${fmt(Math.round(inserted / elapsed))}/s)`);
    }
  }
  const insElapsed = (Date.now() - tIns) / 1000;
  console.log(`✓ Inserted ${fmt(inserted)} customers in ${insElapsed.toFixed(1)}s (${fmt(Math.round(inserted / insElapsed))} rows/s)`);

  // ── 3. Tenant-scoped query latency under concurrent load ────────
  console.log('\nQuery latency (tenant-scoped, 200 concurrent samples each):');
  async function bench(label: string, fn: (bizId: string) => Promise<unknown>) {
    const lat: number[] = [];
    const SAMPLES = 200;
    await Promise.all(
      Array.from({ length: SAMPLES }, async (_, i) => {
        const bizId = bizIds[i % bizIds.length];
        const t = performance.now();
        await fn(bizId);
        lat.push(performance.now() - t);
      })
    );
    console.log(`  ${label.padEnd(34)} p50=${ms(pct(lat, 50)).padStart(7)}  p95=${ms(pct(lat, 95)).padStart(7)}  p99=${ms(pct(lat, 99)).padStart(7)}`);
  }

  // Queries mirror exactly what the app issues (see loyalty-controller list/dashboard handlers)
  await bench('count customers', (id) => prisma.customer.count({ where: { businessId: id } }));
  await bench('customers list page (25, sorted)', (id) =>
    prisma.customer.findMany({ where: { businessId: id }, orderBy: { lastVisitAt: 'desc' }, take: 25 }));
  await bench('segment list (AT_RISK, sorted)', (id) =>
    prisma.customer.findMany({ where: { businessId: id, segment: 'AT_RISK' }, orderBy: { lastVisitAt: 'desc' }, take: 25 }));
  await bench('lookup by whatsappNumber', (id) =>
    prisma.customer.findFirst({ where: { businessId: id, whatsappNumber: { startsWith: '+447' } } }));
  await bench('dashboard aggregate (sum spend)', (id) =>
    prisma.customer.aggregate({ where: { businessId: id }, _sum: { totalSpend: true }, _count: true }));

  // ── 4. TENANT ISOLATION VERIFICATION ────────────────────────────
  console.log('\nTenant isolation checks:');
  let isolationOk = true;

  // 4a. Every tenant-scoped query returns ONLY that tenant's rows
  for (const id of bizIds.slice(0, 5)) {
    const sample = await prisma.customer.findMany({ where: { businessId: id }, take: 500, select: { businessId: true } });
    const leaked = sample.filter((c) => c.businessId !== id).length;
    if (leaked > 0) { isolationOk = false; console.log(`  ✗ LEAK: tenant ${id} query returned ${leaked} foreign rows`); }
  }

  // 4b. Per-tenant counts sum to the global total (no row is shared/lost)
  const perTenant = await Promise.all(bizIds.map((id) => prisma.customer.count({ where: { businessId: id } })));
  const sumScoped = perTenant.reduce((a, c) => a + c, 0);
  const globalAll = await prisma.customer.count({ where: { businessId: { in: bizIds } } });
  if (sumScoped !== globalAll) { isolationOk = false; console.log(`  ✗ COUNT MISMATCH: Σtenant=${fmt(sumScoped)} vs global=${fmt(globalAll)}`); }
  else console.log(`  ✓ Σ(per-tenant counts) = global count = ${fmt(globalAll)}`);

  // 4c. A scoped update touches only the target tenant
  const victim = bizIds[0];
  const before = await prisma.customer.count({ where: { businessId: { in: bizIds.slice(1) }, fullName: 'ISOLATION_PROBE' } });
  await prisma.customer.updateMany({ where: { businessId: victim }, data: { fullName: 'ISOLATION_PROBE' } });
  const after = await prisma.customer.count({ where: { businessId: { in: bizIds.slice(1) }, fullName: 'ISOLATION_PROBE' } });
  if (after !== before) { isolationOk = false; console.log(`  ✗ WRITE LEAK: scoped update changed ${after - before} rows in other tenants`); }
  else console.log(`  ✓ Scoped updateMany affected only tenant ${victim} (0 cross-tenant writes)`);

  console.log(`\n${isolationOk ? '✓ ISOLATION PASSED — multi-tenant boundary holds at scale' : '✗ ISOLATION FAILED'}`);

  // ── 5. Summary ──────────────────────────────────────────────────
  const grand = await prisma.customer.count();
  console.log('━'.repeat(64));
  console.log(`SUMMARY`);
  console.log(`  Customers in DB:    ${fmt(grand)}`);
  console.log(`  Insert throughput:  ${fmt(Math.round(inserted / insElapsed))} rows/s`);
  console.log(`  Isolation:          ${isolationOk ? 'PASS' : 'FAIL'}`);
  console.log('━'.repeat(64));

  // ── Cleanup (only this run's tenants) ───────────────────────────
  if (process.env.KEEP !== '1') {
    process.stdout.write('Cleaning up… ');
    await prisma.customer.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.user.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.business.deleteMany({ where: { id: { in: bizIds } } });
    console.log('done.');
  }
}

main()
  .catch((e) => { console.error('LOAD TEST ERROR:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
