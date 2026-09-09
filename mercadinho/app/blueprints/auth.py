"""Login e logout. Simples de proposito: usuario e senha, sem OAuth."""
from urllib.parse import urlparse

from flask import (Blueprint, current_app, flash, redirect, render_template,
                   request, session, url_for)
from flask_login import current_user, login_required, login_user, logout_user

from ..extensions import db
from ..models import Usuario

bp = Blueprint("auth", __name__)


def _proximo_seguro(destino):
    """So aceita um caminho relativo do proprio site.

    Sem isso, um link tipo /entrar?next=https://site-falso.com levaria quem
    fizesse login direto para fora do sistema (open redirect).
    """
    if not destino:
        return None
    partes = urlparse(destino)
    if partes.scheme or partes.netloc:
        return None
    return destino


@bp.route("/entrar", methods=["GET", "POST"])
def entrar():
    if current_user.is_authenticated:
        return redirect(url_for("painel.inicio"))

    if request.method == "POST":
        login = (request.form.get("login") or "").strip().lower()[:60]
        senha = request.form.get("senha") or ""
        usuario = Usuario.query.filter_by(login=login).first()

        if usuario and usuario.esta_bloqueado:
            minutos = current_app.config["LOGIN_MINUTOS_BLOQUEIO"]
            flash(f"Muitas tentativas erradas. Espere {minutos} minutos e tente de novo.",
                  "erro")
            return render_template("entrar.html")

        if usuario and usuario.ativo and usuario.conferir_senha(senha):
            usuario.registrar_acerto_de_senha()
            db.session.commit()
            login_user(usuario, remember=True)
            return redirect(_proximo_seguro(request.args.get("next")) or url_for("painel.inicio"))

        if usuario:
            usuario.registrar_erro_de_senha(
                current_app.config["LOGIN_MAX_TENTATIVAS"],
                current_app.config["LOGIN_MINUTOS_BLOQUEIO"],
            )
            db.session.commit()
        # Mensagem igual para senha errada e usuario inexistente, para nao
        # entregar quais logins existem na loja.
        flash("Usuário ou senha não conferem.", "erro")

    return render_template("entrar.html")


@bp.route("/sair", methods=["POST"])
@login_required
def sair():
    # So' por POST (com token CSRF): por GET, bastava um <img src="/sair"> num
    # site qualquer para deslogar quem estivesse usando o sistema.
    logout_user()
    session.pop("data_demo", None)
    flash("Você saiu do sistema.", "ok")
    return redirect(url_for("auth.entrar"))
