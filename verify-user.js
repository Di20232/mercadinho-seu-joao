require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.VERIFY_EMAIL || '').toLowerCase().trim();
  const password = process.env.VERIFY_PASSWORD;

  if (!email) throw new Error('Defina VERIFY_EMAIL para consultar o usuário.');

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, active: true, passwordHash: true },
  });

  if (!user) {
    console.log('Usuário não encontrado.');
    return;
  }

  console.log('Usuário encontrado:');
  console.log(`  ID: ${user.id}`);
  console.log(`  Email: ${user.email}`);
  console.log(`  Nome: ${user.name}`);
  console.log(`  Role: ${user.role}`);
  console.log(`  Ativo: ${user.active ? 'sim' : 'não'}`);

  if (password) {
    const isValid = await bcrypt.compare(password, user.passwordHash);
    console.log(`Senha informada válida? ${isValid ? 'sim' : 'não'}`);
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
