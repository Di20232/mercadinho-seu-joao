"""Lista de compras sugerida.

O sistema faz a conta: olha o que ta' abaixo do limite do dia, ve quanto sai
por dia em media e sugere quanto comprar para aguentar os proximos dias.
O usuario so olha a lista e compra.
"""
import math
from datetime import date, timedelta
from decimal import Decimal

from flask import current_app

from ..extensions import db
from ..models import ListaCompraSugerida, Produto
from . import estoque as servico_estoque
from . import regras

ZERO = Decimal("0")


def _arredondar(valor, unidade):
    """Unidade fracionada (kg, L) arredonda em 0,5; o resto vai para inteiro."""
    valor = Decimal(valor)
    if valor <= ZERO:
        return ZERO
    if unidade.lower() in ("kg", "l", "lt", "litro", "g"):
        return (Decimal(math.ceil(valor * 2)) / 2).quantize(Decimal("0.5"))
    return Decimal(math.ceil(valor))


def calcular_sugestao(produto, dia=None, feriados=None):
    """Quanto comprar deste produto hoje, e por que. None se nao precisa."""
    dia = dia or date.today()
    situacao = servico_estoque.situacao_produto(produto, dia, feriados)
    if situacao["status_estoque"] == regras.OK:
        return None

    saldo = situacao["estoque"]
    limite = situacao["limite"]
    dias_cobertura = current_app.config.get("DIAS_COBERTURA_COMPRA", 3)
    media = servico_estoque.consumo_medio_diario(produto, ate=dia)

    # Alvo: repor o limite do dia com uma folga, ou o que costuma sair no periodo
    alvo_por_limite = limite * Decimal("2")
    alvo_por_venda = media * Decimal(dias_cobertura)
    alvo = max(alvo_por_limite, alvo_por_venda)
    quantidade = _arredondar(alvo - saldo, produto.unidade_medida)
    if quantidade <= ZERO:
        return None

    unidade = produto.unidade_medida
    if saldo <= ZERO:
        motivo = f"Acabou {regras.artigo(produto.nome)} {produto.nome}"
    else:
        motivo = (f"Só tem {regras.formatar_quantidade(saldo)} {unidade} e o mínimo "
                  f"é {regras.formatar_quantidade(limite)} {unidade}")
    if situacao["dia_de_pico"]:
        motivo += f" (hoje é {situacao['motivo_limite']}, sai mais)"
    if media > ZERO:
        motivo += f". Costuma sair {regras.formatar_quantidade(media.quantize(Decimal('0.1')))} {unidade} por dia"

    return {
        "produto": produto,
        "quantidade": quantidade,
        "justificativa": motivo[:255],
        "situacao": situacao,
        "media_diaria": media,
    }


def gerar_lista(dia=None, setor=None):
    """(Re)gera a lista do dia e grava no banco. Mantem o que ja foi comprado."""
    from ..models import DiaEspecial
    dia = dia or date.today()
    feriados = {
        linha.data for linha in DiaEspecial.query.filter(
            DiaEspecial.data.between(dia, dia + timedelta(days=1))
        ).all()
    }

    consulta = Produto.query.filter_by(ativo=True)
    if setor:
        consulta = consulta.filter_by(setor=setor)

    sugeridos = []
    for produto in consulta.order_by(Produto.nome).all():
        sugestao = calcular_sugestao(produto, dia, feriados)
        if not sugestao:
            continue
        linha = ListaCompraSugerida.query.filter_by(
            produto_id=produto.id, data_geracao=dia
        ).first()
        if linha is None:
            linha = ListaCompraSugerida(produto_id=produto.id, data_geracao=dia)
            db.session.add(linha)
        if not linha.comprado:
            linha.quantidade_sugerida = sugestao["quantidade"]
            linha.justificativa = sugestao["justificativa"]
        sugeridos.append(linha)

    # Tira da lista o que resolveu sozinho (chegou mercadoria no meio do caminho).
    # Restrito ao mesmo setor filtrado acima - senao gerar a lista de um so'
    # setor apagava as sugestoes pendentes de todos os outros setores do dia.
    ids = {linha.produto_id for linha in sugeridos}
    antigas = ListaCompraSugerida.query.filter_by(data_geracao=dia, comprado=False)
    if setor:
        antigas = antigas.join(Produto).filter(Produto.setor == setor)
    for antiga in antigas.all():
        if antiga.produto_id not in ids:
            db.session.delete(antiga)

    db.session.commit()
    return lista_do_dia(dia, setor)


def lista_do_dia(dia=None, setor=None):
    dia = dia or date.today()
    consulta = ListaCompraSugerida.query.filter_by(data_geracao=dia).join(Produto)
    if setor:
        consulta = consulta.filter(Produto.setor == setor)
    return consulta.order_by(ListaCompraSugerida.comprado, Produto.nome).all()
