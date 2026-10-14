require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { generateUsername } = require('./src/username');

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Administrador';

  if (!email) throw new Error('Defina ADMIN_EMAIL no .env antes de criar o admin.');
  if (!password || password.length < 8) throw new Error('Defina ADMIN_PASSWORD (mínimo 8 caracteres) no .env.');

  const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (existingAdmin && existingAdmin.email !== email) {
    throw new Error(`Já existe um administrador (${existingAdmin.email}). Use npm run reset-password para recuperação.`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, role: 'ADMIN', active: true, sessionVersion: { increment: 1 } },
    create: { name, email, username: await generateUsername(prisma, name), passwordHash, role: 'ADMIN', active: true },
  });

  console.log(`Administrador pronto: ${admin.email} (usuário: ${admin.username})`);
  console.log('Senha lida de ADMIN_PASSWORD. Ela não foi exibida por segurança.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
