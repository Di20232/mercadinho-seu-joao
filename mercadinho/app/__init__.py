"""Mercadinho do Seu João — sistema de controle de estoque (MVP)."""
from datetime import date, datetime

from flask import Flask, g, session

from .config import Config
from .extensions import db, login_manager, migrate


def create_app(config_object=Config):
    app = Flask(__name__)
    app.config.from_object(config_object)

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)

    from . import models  # noqa: F401  (registra as tabelas)

    @login_manager.user_loader
    def carregar_usuario(usuario_id):
        return db.session.get(models.Usuario, int(usuario_id))

    _registrar_blueprints(app)
    _registrar_filtros(app)
    _registrar_comandos(app)

    @app.context_processor
    def variaveis_globais():
        from .servicos import regras, telegram
        return {
            "hoje": date.today(),
            "data_referencia": data_referencia(),
            "modo_demonstracao": "data_demo" in session,
            "regras": regras,
            "telegram_ligado": telegram.esta_ligado(),
            "Papel": models.Papel,
            "Categoria": models.Categoria,
            "TipoMovimento": models.TipoMovimento,
            "MotivoPerda": models.MotivoPerda,
            "TipoAlerta": models.TipoAlerta,
        }

    return app


def data_referencia():
    """Data usada nos calculos.

    Normalmente e' hoje. Na demonstracao o dono pode "olhar" outro dia
    (ex.: uma sexta-feira) para mostrar como os limites mudam.
    """
    valor = session.get("data_demo")
    if valor:
        try:
            return datetime.strptime(valor, "%Y-%m-%d").date()
        except ValueError:
            session.pop("data_demo", None)
    return date.today()


def _registrar_blueprints(app):
    from .blueprints.alertas import bp as bp_alertas
    from .blueprints.api import bp as bp_api
    from .blueprints.auth import bp as bp_auth
    from .blueprints.compras import bp as bp_compras
    from .blueprints.movimentos import bp as bp_movimentos
    from .blueprints.painel import bp as bp_painel
    from .blueprints.produtos import bp as bp_produtos
    from .blueprints.relatorios import bp as bp_relatorios
    from .blueprints.usuarios import bp as bp_usuarios

    for bp in (bp_auth, bp_painel, bp_produtos, bp_movimentos, bp_alertas,
               bp_compras, bp_relatorios, bp_usuarios, bp_api):
        app.register_blueprint(bp)


def _registrar_filtros(app):
    from .servicos import regras

    app.jinja_env.filters["qtd"] = regras.formatar_quantidade
    app.jinja_env.filters["dinheiro"] = regras.formatar_dinheiro

    @app.template_filter("data")
    def _data(valor):
        if not valor:
            return "—"
        return valor.strftime("%d/%m/%Y")

    @app.template_filter("data_hora")
    def _data_hora(valor):
        if not valor:
            return "—"
        return valor.strftime("%d/%m/%Y %H:%M")

    @app.template_filter("dia_semana")
    def _dia_semana(valor):
        nomes = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
                 "sexta-feira", "sábado", "domingo"]
        return nomes[valor.weekday()]


def _registrar_comandos(app):
    import click

    from .models import Papel, Usuario

    @app.cli.command("criar-tabelas")
    def criar_tabelas():
        """Cria as tabelas no PostgreSQL (alternativa rapida ao migrate)."""
        db.create_all()
        click.echo("Tabelas criadas.")

    @app.cli.command("criar-admin")
    def criar_admin():
        """Cria o usuario administrador inicial a partir do .env."""
        login = app.config["ADMIN_LOGIN"]
        if Usuario.query.filter_by(login=login).first():
            click.echo(f"Usuário '{login}' já existe.")
            return
        usuario = Usuario(nome=app.config["ADMIN_NOME"], login=login, papel=Papel.ADMIN)
        usuario.definir_senha(app.config["ADMIN_SENHA"])
        db.session.add(usuario)
        db.session.commit()
        click.echo(f"Administrador '{login}' criado.")

    @app.cli.command("verificar-alertas")
    def verificar_alertas():
        """Roda a checagem de estoque/validade e dispara os avisos (use no cron)."""
        from .servicos import alertas
        novos = alertas.verificar_tudo()
        click.echo(f"{len(novos)} alerta(s) novo(s).")

    @app.cli.command("gerar-lista-compras")
    def gerar_lista_compras():
        """Gera a lista de compras sugerida do dia."""
        from .servicos import compras
        lista = compras.gerar_lista()
        click.echo(f"{len(lista)} produto(s) na lista de hoje.")
