// Cliente HTTP mínimo para os testes de integração: mantém cookies entre
// requisições (como um navegador) e já inclui o cabeçalho X-Requested-With
// que a defesa anti-CSRF da aplicação exige em toda rota que altera estado.
function makeCookieJar() {
  const cookies = new Map();
  return {
    apply(headers) {
      const setCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
      for (const raw of setCookies) {
        const [pair] = raw.split(';');
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function request(baseUrl, jar, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'X-Requested-With': 'fetch',
      ...(jar ? { Cookie: jar.header() } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (jar) jar.apply(res.headers);
  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

module.exports = { makeCookieJar, request };
