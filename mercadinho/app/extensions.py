"""Extensoes Flask instanciadas fora da fabrica para evitar import circular."""
from flask_login import LoginManager
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
migrate = Migrate()
login_manager = LoginManager()
login_manager.login_view = "auth.entrar"
login_manager.login_message = "Faça o login para continuar."
login_manager.login_message_category = "aviso"
