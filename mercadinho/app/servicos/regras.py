"""Regras de negocio de estoque: limite do dia, semaforo e linguagem simples.

Tudo aqui e' calculado pelo sistema. O usuario nunca precisa fazer conta.
"""
from datetime import date, timedelta
from decimal import Decimal

from flask import current_app

from ..models import Categoria, LoteEstoque, Produto

ZERO = Decimal("0")

OK = "ok"
ATENCAO = "atencao"
CRITICO = "critico"

_ORDEM = {OK: 0, ATENCAO: 1, CRITICO: 2}

ROTULO_SEMAFORO = {OK: "Tudo certo", ATENCAO: "Tá baixando", CRITICO: "Tá acabando"}
COR_SEMAFORO = {OK: "success", ATENCAO: "warning", CRITICO: "danger"}


def pior(*status):
    """Devolve o status mais grave entre os informados."""
    return max(status, key=lambda s: _ORDEM.get(s, 0))


def dias_aviso_validade(produto=None):
    padrao = current_app.config.get("DIAS_AVISO_VALIDADE", 3)
    if produto is not None and produto.dias_aviso_validade:
        return produto.dias_aviso_validade
    return padrao


def eh_dia_de_pico(dia=None, feriados=None):
    """Sexta, sabado, domingo, feriado ou vespera de feriado.

    Nesses dias vale o limite minimo de fim de semana: o cliente contou que
    2 unidades de contrafile e' tranquilo numa segunda e critico numa sexta.
    """
    dia = dia or date.today()
    if dia.weekday() in (4, 5, 6):  # sexta, sabado, domingo
        return True
    datas = feriados if feriados is not None else _feriados_proximos(dia)
    return dia in datas or (dia + timedelta(days=1)) in datas


def _feriados_proximos(dia):
    from ..models import DiaEspecial
    linhas = DiaEspecial.query.filter(
        DiaEspecial.data.between(dia, dia + timedelta(days=1))
    ).all()
    return {linha.data for linha in linhas}


def motivo_do_limite(dia=None, feriados=None):
    dia = dia or date.today()
    if not eh_dia_de_pico(dia, feriados):
        return "dia normal"
    if dia.weekday() == 4:
        return "sexta-feira"
    if dia.weekday() == 5:
        return "sábado"
    if dia.weekday() == 6:
        return "domingo"
    return "véspera de feriado"


def limite_do_dia(produto, dia=None, feriados=None):
    """Limite minimo que vale hoje para este produto."""
    dia = dia or date.today()
    limite = produto.limite_minimo or ZERO
    if produto.limite_minimo_fim_de_semana is not None and eh_dia_de_pico(dia, feriados):
        return Decimal(produto.limite_minimo_fim_de_semana)
    return Decimal(limite)


def semaforo_estoque(estoque, limite):
    """Verde/amarelo/vermelho so pela quantidade em estoque.

    Vermelho e' ficar *abaixo* do minimo do dia; ficar exatamente no minimo
    ainda e' amarelo. Foi assim que o cliente descreveu: duas unidades de
    contrafile numa segunda ainda e' tranquilo, numa sexta ja' e' critico -
    o que muda entre os dois dias e' o minimo, nao a regra.
    """
    estoque = Decimal(estoque or 0)
    limite = Decimal(limite or 0)
    if estoque <= ZERO:
        return CRITICO
    if limite <= ZERO:
        return OK
    if estoque < limite:
        return CRITICO
    if estoque <= limite * Decimal("1.5"):
        return ATENCAO
    return OK


def semaforo_validade(lotes, dia=None, dias_aviso=3):
    """Verde/amarelo/vermelho pela validade dos lotes que ainda tem saldo."""
    dia = dia or date.today()
    situacao = OK
    for lote in lotes:
        if Decimal(lote.quantidade or 0) <= ZERO or not lote.data_validade:
            continue
        faltam = (lote.data_validade - dia).days
        if faltam <= 0:
            situacao = pior(situacao, CRITICO)
        elif faltam <= dias_aviso:
            situacao = pior(situacao, ATENCAO)
    return situacao


def artigo(nome):
    """'o' ou 'a' para o nome do produto.

    Regra simples do portugues: primeira palavra terminada em 'a' costuma ser
    feminina (banana, cerveja, carne moida). O resto fica no masculino.
    """
    primeira = (nome or "").strip().split(" ")[0].lower()
    return "a" if primeira.endswith(("a", "ã")) else "o"


def frase_estoque(produto, estoque, limite, status):
    """Frase curta, do jeito que o Seu Joao fala."""
    art = artigo(produto.nome)
    unidade = produto.unidade_medida
    estoque_txt = formatar_quantidade(estoque)
    if status == CRITICO and Decimal(estoque or 0) <= ZERO:
        return f"Acabou {art} {produto.nome}"
    if status == CRITICO:
        return f"Tá acabando {art} {produto.nome}: só tem {estoque_txt} {unidade}"
    if status == ATENCAO:
        return f"{art.upper()} {produto.nome} tá baixando: {estoque_txt} {unidade}"
    return f"{produto.nome}: {estoque_txt} {unidade}"


def frase_validade(produto, faltam):
    if faltam is None:
        return ""
    inicio = f"{artigo(produto.nome).upper()} {produto.nome}"
    if faltam < 0:
        return f"{inicio} já venceu"
    if faltam == 0:
        return f"{inicio} vence hoje"
    if faltam == 1:
        return f"{inicio} vence amanhã"
    return f"{inicio} vence em {faltam} dias"


def formatar_quantidade(valor):
    """3.000 -> '3'; 2.500 -> '2,5'."""
    numero = Decimal(valor or 0)
    normalizado = numero.normalize()
    texto = format(normalizado, "f")
    if "." in texto:
        texto = texto.rstrip("0").rstrip(".")
    return texto.replace(".", ",") or "0"


def formatar_dinheiro(valor):
    numero = Decimal(valor or 0)
    return f"R$ {numero:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
