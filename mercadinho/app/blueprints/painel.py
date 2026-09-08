"""Tela inicial: o semaforo do estoque e o resumo do dia."""
from datetime import datetime

from flask import (Blueprint, flash, redirect, render_template, request,
                   session, url_for)
from flask_login import current_user, login_required

from .. import data_referencia
from ..models import Produto, StatusAlerta
from ..seguranca import somente_admin
from ..servicos import alertas as servico_alertas
from ..servicos import compras as servico_compras
from ..servicos import estoque as servico_estoque
from ..servicos import regras

bp = Blueprint("painel", __name__)


@bp.route("/")
@login_required
def inicio():
    dia = data_referencia()
    setor = request.args.get("setor") or None
    filtro = request.args.get("ver") or "todos"

    # Mantem os alertas em dia sempre que alguem abre o painel. Usa sempre o
    # dia real (nao o "dia de teste"), senao um dono so' olhando como fica
    # numa sexta-feira acabaria abrindo/fechando avisos e mandando Telegram
    # de verdade com base num dia fictício.
    servico_alertas.verificar_tudo()

    itens = servico_estoque.visao_geral(dia, setor=setor)
    resumo = servico_estoque.resumo_semaforo(itens)
    if filtro == "problemas":
        itens = [i for i in itens if i["status"] != regras.OK]

    meus_alertas = servico_alertas.alertas_do_usuario(current_user)
    setores = [s[0] for s in Produto.query.with_entities(Produto.setor)
               .filter_by(ativo=True).distinct().order_by(Produto.setor).all()]

    return render_template(
        "painel.html", itens=itens, resumo=resumo, dia=dia, setor=setor,
        setores=setores, filtro=filtro, meus_alertas=meus_alertas,
        dia_de_pico=regras.eh_dia_de_pico(dia),
        motivo_limite=regras.motivo_do_limite(dia),
    )


@bp.route("/consolidado")
@login_required
def consolidado():
    """Painel do Modulo 4: tudo numa tela so, para a demonstracao."""
    dia = data_referencia()
    servico_alertas.verificar_tudo()  # sempre com o dia real, ver comentário acima

    itens = servico_estoque.visao_geral(dia)
    criticos = [i for i in itens if i["status_estoque"] == regras.CRITICO]
    vencendo = [i for i in itens if i["dias_para_vencer"] is not None
                and i["dias_para_vencer"] <= regras.dias_aviso_validade(i["produto"])]
    parados = [i for i in itens if i["risco_parado"]]
    lista = servico_compras.gerar_lista(dia)
    pendentes = servico_alertas.alertas_do_usuario(current_user, StatusAlerta.PENDENTE)

    return render_template(
        "consolidado.html", dia=dia, itens=itens,
        resumo=servico_estoque.resumo_semaforo(itens), criticos=criticos,
        vencendo=vencendo, parados=parados, lista=lista, alertas=pendentes,
        dia_de_pico=regras.eh_dia_de_pico(dia), motivo_limite=regras.motivo_do_limite(dia),
    )


@bp.route("/dia-de-teste", methods=["POST"])
@login_required
@somente_admin
def dia_de_teste():
    """Permite olhar o sistema como se fosse outro dia (demonstracao)."""
    valor = (request.form.get("data") or "").strip()
    if not valor:
        session.pop("data_demo", None)
        flash("Voltando para o dia de hoje.", "ok")
    else:
        try:
            datetime.strptime(valor, "%Y-%m-%d")
            session["data_demo"] = valor
            flash("Mostrando o sistema como ficaria nesse dia.", "aviso")
        except ValueError:
            flash("Data inválida.", "erro")
    return redirect(request.referrer or url_for("painel.inicio"))
