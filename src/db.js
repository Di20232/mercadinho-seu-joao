const { PrismaClient } = require('@prisma/client');

// Cliente único do Prisma. Todas as queries usam parâmetros tipados
// (nunca concatenação de string), o que elimina injeção de SQL por construção.
const prisma = new PrismaClient();

module.exports = prisma;
