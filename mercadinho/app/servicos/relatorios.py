"""Relatorios simples. O sistema soma; o usuario so le o numero pronto."""
from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func

from ..extensions import db
from ..models import (MotivoPerda, MovimentoEstoque, Produto, TipoMovimento)

ZERO = Decimal("0")


def intervalo_do_mes(ano, mes):
    inicio = date(ano, mes, 1)
    fim = date(ano, mes, monthrange(ano, mes)[1])
    return inicio, fim


def perdas(inicio, fim):
    """Perdas do periodo: total em R$, total por motivo e detalhe por produto."""
    de = datetime.combine(inicio, datetime.min.time())
    ate = datetime.combine(fim, datetime.max.time())

    base = MovimentoEstoque.query.filter(
        MovimentoEstoque.tipo == TipoMovimento.PERDA,
        MovimentoEstoque.data_hora.between(de, ate),
    )

    total_valor = db.session.query(
        func.coalesce(func.sum(MovimentoEstoque.valor_estimado), 0)
    ).filter(
        MovimentoEstoque.tipo == TipoMovimento.PERDA,
        MovimentoEstoque.data_hora.between(de, ate),
    ).scalar()

    por_motivo = db.session.query(
        MovimentoEstoque.motivo,
        func.coalesce(func.sum(MovimentoEstoque.quantidade), 0),
        func.coalesce(func.sum(MovimentoEstoque.valor_estimado), 0),
    ).filter(
        MovimentoEstoque.tipo == TipoMovimento.PERDA,
        MovimentoEstoque.data_hora.between(de, ate),
    ).group_by(MovimentoEstoque.motivo).all()

    por_produto = db.session.query(
        Produto,
        func.coalesce(func.sum(MovimentoEstoque.quantidade), 0),
        func.coalesce(func.sum(MovimentoEstoque.valor_estimado), 0),
    ).join(MovimentoEstoque, MovimentoEstoque.produto_id == Produto.id).filter(
        MovimentoEstoque.tipo == TipoMovimento.PERDA,
        MovimentoEstoque.data_hora.between(de, ate),
    ).group_by(Produto.id).order_by(
        func.coalesce(func.sum(MovimentoEstoque.valor_estimado), 0).desc()
    ).all()

    return {
        "inicio": inicio,
        "fim": fim,
        "total_valor": Decimal(total_valor or 0),
        "total_itens": base.count(),
        "por_motivo": [
            {"motivo": motivo, "quantidade": Decimal(qtd), "valor": Decimal(valor)}
            for motivo, qtd, valor in por_motivo
        ],
        "por_produto": [
            {"produto": produto, "quantidade": Decimal(qtd), "valor": Decimal(valor)}
            for produto, qtd, valor in por_produto
        ],
        "movimentos": base.order_by(MovimentoEstoque.data_hora.desc()).limit(200).all(),
    }


def perdas_do_mes(ano=None, mes=None):
    hoje = date.today()
    ano = ano or hoje.year
    mes = mes or hoje.month
    inicio, fim = intervalo_do_mes(ano, mes)
    resultado = perdas(inicio, fim)
    resultado["ano"] = ano
    resultado["mes"] = mes
    return resultado


def movimentos(limite=100, produto_id=None, tipo=None, usuario_id=None):
    consulta = MovimentoEstoque.query
    if produto_id:
        consulta = consulta.filter_by(produto_id=produto_id)
    if tipo:
        consulta = consulta.filter_by(tipo=tipo)
    if usuario_id:
        consulta = consulta.filter_by(usuario_id=usuario_id)
    return consulta.order_by(MovimentoEstoque.data_hora.desc()).limit(limite).all()
