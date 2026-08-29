"""Login e logout. Simples de proposito: usuario e senha, sem OAuth."""
from flask import (Blueprint, flash, redirect, render_template, request,
                   session, url_for)
from flask_login import current_user, login_required, login_user, logout_user

from ..models import Usuario

bp = Blueprint("auth", __name__)


@bp.route("/entrar", methods=["GET", "POST"])
def entrar():
    if current_user.is_authenticated:
        return redirect(url_for("painel.inicio"))

    if request.method == "POST":
        login = (request.form.get("login") or "").strip().lower()
        senha = request.form.get("senha") or ""
        usuario = Usuario.query.filter_by(login=login).first()
        if usuario and usuario.ativo and usuario.conferir_senha(senha):
            login_user(usuario, remember=True)
            return redirect(request.args.get("next") or url_for("painel.inicio"))
        flash("Usuário ou senha não conferem.", "erro")

    return render_template("entrar.html")


@bp.route("/sair")
@login_required
def sair():
    logout_user()
    session.pop("data_demo", None)
    flash("Você saiu do sistema.", "ok")
    return redirect(url_for("auth.entrar"))
