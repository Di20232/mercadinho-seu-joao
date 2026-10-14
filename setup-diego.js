require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { generateUsername } = require('./src/username');

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.USER_EMAIL || '').toLowerCase().trim();
  const name = process.env.USER_NAME || 'Usuário';
  const role = (process.env.USER_ROLE || 'CASHIER').toUpperCase();
  const password = process.env.USER_PASSWORD;

  if (!email) throw new Error('Defina USER_EMAIL para criar ou atualizar o usuário.');
  if (!['ADMIN', 'CASHIER'].includes(role)) throw new Error('USER_ROLE deve ser ADMIN ou CASHIER.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing && !password) {
    throw new Error('USER_PASSWORD é obrigatório ao criar usuário novo.');
  }

  const data = { name, role, active: true };
  if (password) {
    if (password.length < 8) throw new Error('USER_PASSWORD precisa ter ao menos 8 caracteres.');
    data.passwordHash = await bcrypt.hash(password, 12);
    data.sessionVersion = { increment: 1 };
  }

  const createData = {
    name,
    email,
    username: existing ? undefined : await generateUsername(prisma, name),
    role,
    active: true,
    passwordHash: data.passwordHash,
  };

  const user = existing
    ? await prisma.user.update({ where: { email }, data })
    : await prisma.user.create({ data: createData });

  console.log(`Usuário pronto: ${user.email} — usuário ${user.username} (${user.role})`);
  console.log('Senha não exibida. Se informada, foi lida de USER_PASSWORD.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
