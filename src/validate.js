// Middleware genérico de validação com Zod. Nunca confia em req.body/query/params
// "crus": troca-os pelo resultado já validado e tipado (schema.parse), então
// handlers nunca leem entrada não validada.
const FIELD_LABELS = {
  email: 'E-mail',
  login: 'E-mail ou usuário',
  password: 'Senha',
  name: 'Nome',
  token: 'Link de recuperação',
};

function validationMessage(error) {
  const firstIssue = error.issues[0];
  if (!firstIssue) return 'Dados inválidos.';

  const field = firstIssue.path && firstIssue.path.length > 0 ? String(firstIssue.path[0]) : '';
  const label = FIELD_LABELS[field] || field;
  const message = firstIssue.message && firstIssue.message !== 'Required'
    ? firstIssue.message
    : 'preencha este campo corretamente.';

  return label ? `${label}: ${message}` : message;
}

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: validationMessage(result.error),
        details: result.error.flatten(),
      });
    }
    req[source] = result.data;
    next();
  };
}

module.exports = validate;
