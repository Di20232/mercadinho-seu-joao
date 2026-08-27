const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../db');
const validate = require('../validate');
const { verifyPassword, signToken, setAuthCookie, clearAuthCookie, authenticate, DUMMY_HASH_PROMISE } = require('../auth');

const router = express.Router();

// Limita tentativas de login por IP para dificultar força bruta de senha.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200),
});

router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  // Mensagem genérica: não revela se o e-mail existe ou se foi a senha que errou.
  const invalid = () => res.status(401).json({ error: 'E-mail ou senha inválidos.' });

  if (!user || !user.active) {
    // Ainda assim compara contra um hash isca, gastando o mesmo tempo de CPU
    // de um bcrypt.compare real — impede que a resposta rápida (usuário
    // inexistente) sirva de oráculo de tempo para enumerar e-mails cadastrados.
    await verifyPassword(password, await DUMMY_HASH_PROMISE);
    return invalid();
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return invalid();

  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user || !user.active) return res.status(401).json({ error: 'Não autenticado.' });
  res.json(user);
});

module.exports = router;
