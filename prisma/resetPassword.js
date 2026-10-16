// Script de recuperação de emergência: redefine a senha de um usuário já
// existente diretamente no banco. Não cria contas novas — só quem já tem
// acesso ao servidor/banco de dados (mesmo nível de confiança de quem roda
// migrations ou o seed) pode executar isto, então não é uma porta de entrada
// nova, é uma rede de segurança para o dono não ficar trancado para sempre
// fora do próprio sistema caso esqueça a senha e não haja outro administrador.
//
// Uso (a senha é pedida no terminal, sem aparecer na tela nem no histórico):
//   npm run reset-password -- admin@example.com
//
// Uso não interativo (scripts/CI), lendo tudo do ambiente:
//   RESET_EMAIL=admin@example.com RESET_PASSWORD="NovaSenhaForte123!" node prisma/resetPassword.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Lê uma linha do terminal sem ecoar o que é digitado. Usa raw mode em vez de
// readline para não depender de APIs internas do Node para esconder a entrada.
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error('Defina RESET_PASSWORD ou rode o script em um terminal interativo.'));
      return;
    }

    let value = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (ch === '\u0003') { // Ctrl+C
          cleanup();
          reject(new Error('Cancelado.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
        } else if (ch >= ' ') {
          value += ch;
        }
      }
    };

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function readNewPassword() {
  if (process.env.RESET_PASSWORD) return process.env.RESET_PASSWORD;

  const password = await askHidden('Nova senha: ');
  const confirmation = await askHidden('Repita a nova senha: ');
  if (password !== confirmation) throw new Error('As senhas não conferem. Nada foi alterado.');
  return password;
}

async function main() {
  const email = (process.env.RESET_EMAIL || process.argv[2] || '').toLowerCase().trim();
  if (!email) {
    throw new Error('Informe o e-mail: npm run reset-password -- usuario@exemplo.com');
  }

  // select mínimo: o script também precisa funcionar em bancos antigos que
  // ainda não receberam migrations mais novas (ex: a coluna username).
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (!user) throw new Error(`Nenhum usuário encontrado com o e-mail ${email}.`);

  const password = await readNewPassword();
  if (!password || password.length < 8) {
    throw new Error('A nova senha precisa ter ao menos 8 caracteres. Nada foi alterado.');
  }

  // Incrementar sessionVersion derruba os cookies JWT já emitidos para essa
  // conta, igual ao reset pela API. Sem isso, quem entrou com a senha antiga
  // (por exemplo, uma senha vazada) continuaria logado até o token expirar.
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, active: true, sessionVersion: { increment: 1 } },
  });

  console.log(`Senha redefinida para ${email} (${user.role}). A conta também foi reativada, caso estivesse desativada.`);
  console.log('Todas as sessões abertas dessa conta foram encerradas.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
