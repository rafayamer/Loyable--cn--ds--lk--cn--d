import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.business.updateMany({
    where: {
      OR: [
        { wahaSessionId: null },
        { wahaSessionId: { not: 'default' } },
      ],
    },
    data: {
      wahaBaseUrl:      'http://localhost:3001',
      wahaSessionId:    'default',
      wahaApiKey:       'loyable',
      whatsappProvider: 'WAHA',
    },
  });

  console.log(`Updated ${updated.count} business record(s) → wahaSessionId=default`);

  const businesses = await prisma.business.findMany({
    select: { id: true, name: true, wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });
  console.table(businesses);
}

main().catch(console.error).finally(() => prisma.$disconnect());
