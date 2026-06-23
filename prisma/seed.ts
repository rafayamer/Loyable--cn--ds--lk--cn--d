import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const hash = (pw: string) => argon2.hash(pw, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });

  // ── Platform Admin business ──────────────────────────────────────
  const adminBusiness = await prisma.business.upsert({
    where:  { slug: 'cube-retain-platform' },
    update: {},
    create: { name: 'Cube Retain Platform', slug: 'cube-retain-platform', country: 'GB', timezone: 'Europe/London', currency: 'GBP' },
  });

  await prisma.user.upsert({
    where:  { email_businessId: { email: 'admin@cuberetain.com', businessId: adminBusiness.id } },
    update: {},
    create: {
      businessId:   adminBusiness.id,
      name:         'Platform Admin',
      email:        'admin@cuberetain.com',
      passwordHash: await hash('Admin@123!'),
      role:         'PLATFORM_ADMINISTRATOR',
    },
  });

  // ── Demo tenant ──────────────────────────────────────────────────
  const demoBusiness = await prisma.business.upsert({
    where:  { slug: 'the-coffee-house' },
    update: {
      wahaBaseUrl:      'http://localhost:3001',
      wahaSessionId:    'default',
      wahaApiKey:       'loyable',
      whatsappProvider: 'WAHA',
    },
    create: {
      name: 'The Coffee House', slug: 'the-coffee-house',
      industry: 'Café & Restaurant', country: 'GB',
      timezone: 'Europe/London', currency: 'GBP',
      loyalDaysWindow: 7, irregularGapDays: 14, lostDaysThreshold: 60,
      messageCooldownHours: 72,
      wahaBaseUrl:      'http://localhost:3001',
      wahaSessionId:    'default',
      wahaApiKey:       'loyable',
      whatsappProvider: 'WAHA',
    },
  });

  await prisma.subscription.upsert({
    where:  { businessId: demoBusiness.id },
    update: {},
    create: { businessId: demoBusiness.id, tier: 'PROFESSIONAL', status: 'ACTIVE', monthlyMessageQuota: 50000 },
  });

  await prisma.user.upsert({
    where:  { email_businessId: { email: 'owner@coffeehouse.com', businessId: demoBusiness.id } },
    update: {},
    create: {
      businessId: demoBusiness.id, name: 'Alex Thompson',
      email: 'owner@coffeehouse.com', passwordHash: await hash('Owner@123!'),
      role: 'TENANT_OWNER',
    },
  });

  // ── Loyalty tiers ────────────────────────────────────────────────
  for (const tier of [
    { rank: 1, name: 'Bronze', minVisitCount: 0,  minTotalSpend: 0,    color: '#cd7f32' },
    { rank: 2, name: 'Silver', minVisitCount: 5,  minTotalSpend: 100,  color: '#c0c0c0' },
    { rank: 3, name: 'Gold',   minVisitCount: 15, minTotalSpend: 500,  color: '#ffd700' },
    { rank: 4, name: 'VIP',    minVisitCount: 30, minTotalSpend: 1000, color: '#b19cd9' },
  ]) {
    await prisma.loyaltyTier.upsert({
      where:  { businessId_rank: { businessId: demoBusiness.id, rank: tier.rank } },
      update: tier,
      create: { businessId: demoBusiness.id, ...tier },
    });
  }

  console.log('✅ Database seeded.');
  console.log('   Platform Admin: admin@cuberetain.com / Admin@123!');
  console.log('   Tenant Owner:   owner@coffeehouse.com / Owner@123!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
