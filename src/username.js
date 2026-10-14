const crypto = require('crypto');

// Nome de usuário para login: primeiro nome (minúsculo, sem acento, só letras
// e números) + código aleatório de 4 dígitos — ex: "Diego Souza" -> "diego1239".
// Dá ao funcionário um login curto para usar no lugar do e-mail. A migration
// 20261014000000_add_user_username aplica a mesma regra às contas antigas.
function usernameBase(name) {
  const firstName = String(name || '').trim().split(/\s+/)[0];
  const base = firstName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
  return base || 'usuario';
}

// `db` é o cliente Prisma (ou a transação) de quem chama — os scripts em
// prisma/ usam a própria instância. Tenta códigos de 4 dígitos e, se o primeiro
// nome for muito comum e eles estiverem esgotando, passa para 6 dígitos.
async function generateUsername(db, name) {
  const base = usernameBase(name);
  for (let attempt = 0; attempt < 30; attempt++) {
    const digits = attempt < 20 ? 4 : 6;
    const code = crypto.randomInt(10 ** (digits - 1), 10 ** digits);
    const candidate = `${base}${code}`;
    const taken = await db.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new Error('Não foi possível gerar um nome de usuário único.');
}

module.exports = { generateUsername, usernameBase };
