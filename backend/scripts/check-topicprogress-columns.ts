import { prisma } from '../src/config/database.js';

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'TopicProgress' ORDER BY ordinal_position"
  );
  console.log(rows.map((r) => r.column_name));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
