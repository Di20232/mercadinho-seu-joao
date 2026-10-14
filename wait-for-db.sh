#!/bin/sh
# Script que aguarda o PostgreSQL ficar pronto antes de tentar a migration

set -e

host="$1"
port="${2:-5432}"
shift 2

echo "Aguardando banco de dados em $host:$port..."

i=1
while [ $i -le 60 ]; do
  if node -e "const net = require('net'); const s = net.createConnection({host: '$host', port: $port, timeout: 1000}); s.on('connect', () => { s.destroy(); process.exit(0); }); s.on('error', () => process.exit(1));" 2>/dev/null; then
    echo "✓ Banco de dados pronto!"
    exec "$@"
  fi
  echo "[$i/60] Aguardando..."
  sleep 1
  i=$((i+1))
done

echo "✗ Banco de dados não ficou pronto em tempo hábil"
exit 1
