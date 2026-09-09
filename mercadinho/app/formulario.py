"""Leitura segura dos campos que chegam do navegador.

Todo dado de formulario passa por aqui antes de virar numero ou texto no banco.
Sem isso, um campo com "NaN", "Infinity", "abc" ou um texto gigante derrubava a
pagina com erro 500 - ou pior, entrava no estoque e estragava a conta.
"""
from decimal import Decimal, InvalidOperation

# Limites das colunas do banco (ver models.py)
MAX_QUANTIDADE = Decimal("999999999.999")   # Numeric(12, 3)
MAX_DINHEIRO = Decimal("9999999999.99")     # Numeric(12, 2)
MAX_ID = 2 ** 31 - 1                        # Integer do Postgres

ZERO = Decimal("0")


def inteiro(valor, padrao=None):
    """Le um id vindo do formulario. Devolve o padrao se nao for um id valido."""
    texto_limpo = (valor or "").strip()
    if not texto_limpo.isdigit():
        return padrao
    numero = int(texto_limpo)
    return numero if 0 < numero <= MAX_ID else padrao


def decimal(valor, padrao=None, minimo=ZERO, maximo=MAX_QUANTIDADE):
    """Le um numero do formulario, ja dentro da faixa que a coluna aguenta.

    Recusa NaN e Infinity: os dois passavam pelas validacoes de quantidade
    (NaN quebrava a comparacao, Infinity era "maior que zero") e chegavam a
    ser gravados como saldo de estoque.
    """
    texto_limpo = (valor or "").strip().replace(",", ".")
    if not texto_limpo:
        return padrao
    try:
        numero = Decimal(texto_limpo)
    except (InvalidOperation, ValueError, ArithmeticError):
        return padrao
    if not numero.is_finite():
        return padrao
    if minimo is not None and numero < minimo:
        return padrao
    if maximo is not None and numero > maximo:
        return padrao
    return numero


def dinheiro(valor, padrao=None):
    """Le um valor em reais, na faixa da coluna Numeric(12, 2)."""
    return decimal(valor, padrao=padrao, maximo=MAX_DINHEIRO)


def texto(valor, limite, padrao=""):
    """Le um texto limpo e ja' cortado no tamanho da coluna.

    Tira os caracteres de controle: o byte nulo derrubava a pagina com erro,
    porque o PostgreSQL nao aceita \\x00 dentro de texto.
    """
    limpo = "".join(c for c in (valor or "") if c == "\n" or c >= " ")
    return limpo.strip()[:limite] or padrao


def preenchido(valor):
    """True quando o usuario digitou alguma coisa no campo."""
    return bool((valor or "").strip())
