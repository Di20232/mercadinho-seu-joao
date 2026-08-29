#!/usr/bin/env bash
# Commit e push automático das alterações.
#
# Chamado pelo hook "Stop" do Claude Code: toda vez que o Claude termina uma
# resposta, o que ele mexeu é commitado e enviado para o GitHub.
#
# Uso manual: scripts/auto-commit.sh [caminho-do-repositorio]
set -uo pipefail

REPO="${1:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$REPO" ] && cd "$REPO" 2>/dev/null || exit 0

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
case "$BRANCH" in
  master|main|HEAD) exit 0 ;;  # nunca commita direto na branch principal
esac

git add -A
git diff --cached --quiet && exit 0  # nada mudou, nada a fazer

TOTAL=$(git diff --cached --name-only | wc -l | tr -d ' ')
RESUMO=$(git diff --cached --name-only | head -3 | paste -sd ', ' -)
[ "$TOTAL" -gt 3 ] && RESUMO="$RESUMO e mais $((TOTAL - 3)) arquivo(s)"

git commit -q -m "Atualiza $RESUMO" \
  -m "Commit automático feito ao fim da resposta do Claude Code." \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>" || exit 0

git push -q origin "$BRANCH" 2>/dev/null || git push -q -u origin "$BRANCH" 2>/dev/null
exit 0
