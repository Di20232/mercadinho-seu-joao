"""Alertas dentro do sistema (fallback do Telegram e caixa de entrada do usuario)."""
from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from ..extensions import db
from ..models import Alerta, StatusAlerta
from ..servicos import alertas as servico_alertas

bp = Blueprint("alertas", __name__, url_prefix="/alertas")


@bp.route("/")
@login_required
def listar():
    servico_alertas.verificar_tudo()  # sempre no dia real, nunca no "dia de teste"
    pendentes = servico_alertas.alertas_do_usuario(current_user, StatusAlerta.PENDENTE)
    resolvidos = servico_alertas.alertas_do_usuario(current_user, StatusAlerta.RESOLVIDO)[:20]
    return render_template("alertas/listar.html", pendentes=pendentes,
                           resolvidos=resolvidos)


@bp.route("/<int:alerta_id>/resolver", methods=["POST"])
@login_required
def resolver(alerta_id):
    alerta = db.get_or_404(Alerta, alerta_id)
    if not current_user.eh_admin and alerta.destinatario_id != current_user.id:
        flash("Esse aviso é de outra pessoa.", "aviso")
        return redirect(url_for("alertas.listar"))
    servico_alertas.resolver(alerta)
    flash("Aviso marcado como resolvido.", "ok")
    return redirect(request.referrer or url_for("alertas.listar"))
