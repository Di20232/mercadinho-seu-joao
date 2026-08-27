require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  if (!email) {
    throw new Error('Defina ADMIN_EMAIL no .env antes de rodar o seed.');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Usuário administrador já existe (${email}). Nada a fazer.`);
    return;
  }

  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Defina ADMIN_PASSWORD (mínimo 8 caracteres) no .env antes de rodar o seed.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      name: process.env.ADMIN_NAME || 'Administrador',
      email,
      passwordHash,
      role: 'ADMIN',
    },
  });

  console.log(`Usuário administrador criado: ${email}`);
  console.log('Troque a senha após o primeiro login.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
