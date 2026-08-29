"""Criacao e direcionamento dos alertas.

Regra que o cliente fez questao: o aviso vai para quem cuida daquele produto,
nao para todo mundo. "Muita informacao pra gente que nao precisa da informacao"
foi exatamente o que ele pediu para evitar.
"""
from datetime import date, datetime
from decimal import Decimal

from flask import current_app

from ..extensions import db
from ..models import (Alerta, Papel, StatusAlerta, TipoAlerta, Usuario)
from . import estoque as servico_estoque
from . import regras, telegram

ZERO = Decimal("0")


def destinatario_do_produto(produto):
    """Quem cuida deste produto. Sem responsavel definido, cai para um dono."""
    if produto.responsavel_padrao and produto.responsavel_padrao.ativo:
        return produto.responsavel_padrao
    return Usuario.query.filter_by(papel=Papel.ADMIN, ativo=True).order_by(Usuario.id).first()


def _pendente(produto_id, tipo):
    return Alerta.query.filter_by(
        produto_id=produto_id, tipo=tipo, status=StatusAlerta.PENDENTE
    ).first()


def _resolver(produto_id, tipo):
    alerta = _pendente(produto_id, tipo)
    if alerta:
        alerta.status = StatusAlerta.RESOLVIDO
        alerta.resolvido_em = datetime.utcnow()
    return alerta


def _abrir(produto, tipo, mensagem):
    """Abre o alerta se ainda nao existir um pendente igual (nao repete aviso)."""
    existente = _pendente(produto.id, tipo)
    if existente:
        if existente.mensagem != mensagem:
            existente.mensagem = mensagem
        return None
    destinatario = destinatario_do_produto(produto)
    if destinatario is None:
        return None
    alerta = Alerta(produto=produto, tipo=tipo, destinatario=destinatario, mensagem=mensagem,
                    status=StatusAlerta.PENDENTE, data_criacao=datetime.utcnow())
    db.session.add(alerta)
    db.session.flush()
    return alerta


def avaliar_produto(produto, dia=None, feriados=None, notificar=True):
    """Confere um produto e abre/fecha os alertas dele. Devolve os alertas novos."""
    dia = dia or date.today()
    situacao = servico_estoque.situacao_produto(produto, dia, feriados)
    novos = []

    # 1) Estoque no limite (ou abaixo) do que o dia pede
    if situacao["status_estoque"] == regras.CRITICO:
        falta = regras.formatar_quantidade(situacao["falta_comprar"])
        texto = situacao["frase"]
        if situacao["dia_de_pico"] and produto.limite_minimo_fim_de_semana is not None:
            texto += f" — e hoje é {situacao['motivo_limite']}, precisa de mais"
        if situacao["falta_comprar"] > ZERO:
            texto += f". Repor pelo menos {falta} {produto.unidade_medida}"
        alerta = _abrir(produto, TipoAlerta.LIMITE_MINIMO, texto[:255])
        if alerta:
            novos.append(alerta)
    else:
        _resolver(produto.id, TipoAlerta.LIMITE_MINIMO)

    # 2) Validade chegando
    faltam = situacao["dias_para_vencer"]
    if faltam is not None and faltam <= regras.dias_aviso_validade(produto):
        texto = regras.frase_validade(produto, faltam)
        quantidade = regras.formatar_quantidade(situacao["lote_critico"].quantidade)
        texto += f" ({quantidade} {produto.unidade_medida} no estoque)"
        alerta = _abrir(produto, TipoAlerta.VALIDADE_PROXIMA, texto[:255])
        if alerta:
            novos.append(alerta)
    else:
        _resolver(produto.id, TipoAlerta.VALIDADE_PROXIMA)

    # 3) Perecivel parado no balcao (risco de perder antes de vender)
    if situacao["risco_parado"]:
        dias = situacao["dias_parado"]
        artigo = regras.artigo(produto.nome).upper()
        texto = (f"{artigo} {produto.nome} está há {dias} dia{'s' if dias != 1 else ''} "
                 f"sem sair. Pode estragar antes de vender")
        alerta = _abrir(produto, TipoAlerta.PARADO_PERECIVEL, texto[:255])
        if alerta:
            novos.append(alerta)
    else:
        _resolver(produto.id, TipoAlerta.PARADO_PERECIVEL)

    if notificar:
        for alerta in novos:
            enviar_alerta(alerta)
    return novos


def verificar_tudo(dia=None, notificar=True):
    """Passa por todos os produtos ativos. Usado no login, apos movimentos e no cron."""
    from ..models import Produto
    dia = dia or date.today()
    novos = []
    for produto in Produto.query.filter_by(ativo=True).all():
        novos.extend(avaliar_produto(produto, dia, notificar=notificar))
    db.session.commit()
    return novos


def enviar_alerta(alerta):
    """Manda pelo Telegram para o responsavel (e copia para os donos, se ligado)."""
    if not telegram.esta_ligado():
        return False
    texto = f"🛒 Mercadinho do Seu João\n{alerta.mensagem}"
    enviado = False
    destinos = {alerta.destinatario.id: alerta.destinatario}
    if current_app.config.get("ALERTA_COPIA_ADMIN", True):
        for admin in Usuario.query.filter_by(papel=Papel.ADMIN, ativo=True).all():
            destinos.setdefault(admin.id, admin)
    for usuario in destinos.values():
        if usuario.contato_telegram and telegram.enviar(usuario.contato_telegram, texto):
            enviado = True
    alerta.enviado_telegram = enviado
    return enviado


def alertas_do_usuario(usuario, status=StatusAlerta.PENDENTE):
    """Admin ve todos; os demais veem so os que sao deles."""
    consulta = Alerta.query.filter_by(status=status)
    if not usuario.eh_admin:
        consulta = consulta.filter_by(destinatario_id=usuario.id)
    return consulta.order_by(Alerta.data_criacao.desc()).all()


def resolver(alerta):
    alerta.status = StatusAlerta.RESOLVIDO
    alerta.resolvido_em = datetime.utcnow()
    db.session.commit()
    return alerta
