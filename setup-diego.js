const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Atualizando usuário diego@diego.com.br para ADMIN...');

    const passwordHash = await bcrypt.hash('adm12345', 12);

    // Primeiro tenta atualizar se o usuário existe
    let updated = await prisma.user.updateMany({
      where: { email: 'diego@diego.com.br' },
      data: {
        role: 'ADMIN',
        passwordHash,
        active: true,
        sessionVersion: 1
      }
    });

    if (updated.count > 0) {
      console.log(`✅ Usuário diego@diego.com.br atualizado para ADMIN`);
      console.log(`Senha: adm12345`);
    } else {
      // Se não existe, cria um novo
      console.log('Usuário não encontrado. Criando novo...');

      const newUser = await prisma.user.create({
        data: {
          name: 'Diego',
          email: 'diego@diego.com.br',
          passwordHash,
          role: 'ADMIN',
          active: true,
          sessionVersion: 1,
        }
      });

      console.log(`✅ Usuário criado como ADMIN`);
      console.log(`Email: ${newUser.email}`);
      console.log(`Senha: adm12345`);
      console.log(`ID: ${newUser.id}`);
    }
  } catch (e) {
    console.error('❌ Erro:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
