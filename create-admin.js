const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Criando usuário admin...');

    const passwordHash = await bcrypt.hash('adm12345', 12);

    const admin = await prisma.user.create({
      data: {
        name: 'Administrador',
        email: 'adm@adm.com.br',
        passwordHash,
        role: 'ADMIN',
        active: true,
        sessionVersion: 1,
      }
    });

    console.log('✅ Usuário admin criado com sucesso!');
    console.log(`  Email: ${admin.email}`);
    console.log(`  Senha: adm12345`);
    console.log(`  ID: ${admin.id}`);
  } catch (e) {
    if (e.code === 'P2002') {
      console.log('⚠️  Admin com este email já existe. Atualizando senha...');

      const passwordHash = await bcrypt.hash('adm12345', 12);
      const admin = await prisma.user.updateMany({
        where: { email: 'adm@adm.com.br' },
        data: { passwordHash }
      });

      console.log('✅ Senha atualizada com sucesso!');
      console.log(`Senha: adm12345`);
    } else {
      console.error('❌ Erro:', e.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
