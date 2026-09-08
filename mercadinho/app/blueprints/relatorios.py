"""Relatorio de perdas (Modulo 3). O sistema soma sozinho."""
from datetime import date

from flask import Blueprint, render_template, request
from flask_login import login_required

from ..seguranca import exige
from ..servicos import relatorios as servico

bp = Blueprint("relatorios", __name__, url_prefix="/relatorios")

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
         "agosto", "setembro", "outubro", "novembro", "dezembro"]


@bp.route("/perdas")
@login_required
@exige("ver_relatorios")
def perdas():
    hoje = date.today()
    try:
        ano = int(request.args.get("ano", hoje.year))
        mes = int(request.args.get("mes", hoje.month))
        if not 1 <= mes <= 12 or not 1 <= ano <= 9999:
            raise ValueError
    except ValueError:
        ano, mes = hoje.year, hoje.month

    dados = servico.perdas_do_mes(ano, mes)
    return render_template("relatorios/perdas.html", dados=dados, meses=MESES,
                           ano=ano, mes=mes, nome_mes=MESES[mes - 1],
                           anos=range(hoje.year - 2, hoje.year + 1))
