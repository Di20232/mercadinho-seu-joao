"""Modelo de dados do controle de estoque do Mercadinho do Seu Joao.

As entidades seguem o levantamento feito com o cliente:
Usuario, Produto, LoteEstoque, MovimentoEstoque, Alerta e ListaCompraSugerida.
DiaEspecial foi acrescentada para dar suporte ao cenario de
"sexta-feira / vespera de feriado" pedido na demonstracao.
"""
import enum
from datetime import date, datetime, timedelta
from decimal import Decimal
from hashlib import sha256

from flask_login import UserMixin
from sqlalchemy import Enum as SAEnum
from werkzeug.security import check_password_hash, generate_password_hash

from .extensions import db

ZERO = Decimal("0")


def _enum(tipo, nome):
    """Enum do Postgres guardando o *valor* (minusculo) e nao o nome."""
    return SAEnum(tipo, name=nome, values_callable=lambda e: [i.value for i in e])


class Papel(str, enum.Enum):
    ADMIN = "admin"          # dono e esposa: cadastra, configura e ve tudo
    OPERADOR = "operador"    # sobrinho: lanca entradas e opera o dia a dia
    REPOSITOR = "repositor"  # funcionarios: dao baixa e recebem seus alertas

    @property
    def rotulo(self):
        return {"admin": "Dono", "operador": "Operador", "repositor": "Repositor"}[self.value]


class Categoria(str, enum.Enum):
    PERECIVEL = "perecivel"
    NAO_PERECIVEL = "nao_perecivel"

    @property
    def rotulo(self):
        return "Perecível" if self.value == "perecivel" else "Não perecível"


class TipoMovimento(str, enum.Enum):
    ENTRADA = "entrada"
    SAIDA = "saida"
    PERDA = "perda"

    @property
    def rotulo(self):
        return {"entrada": "Chegou mercadoria", "saida": "Saiu / vendeu", "perda": "Perda"}[self.value]


class MotivoPerda(str, enum.Enum):
    VENCIDO = "vencido"
    ESTRAGADO = "estragado"
    DANIFICADO = "danificado"

    @property
    def rotulo(self):
        return {"vencido": "Venceu", "estragado": "Estragou", "danificado": "Quebrou/danificou"}[self.value]


class TipoAlerta(str, enum.Enum):
    LIMITE_MINIMO = "limite_minimo"
    VALIDADE_PROXIMA = "validade_proxima"
    PARADO_PERECIVEL = "parado_perecivel"


class StatusAlerta(str, enum.Enum):
    PENDENTE = "pendente"
    RESOLVIDO = "resolvido"


class Usuario(UserMixin, db.Model):
    __tablename__ = "usuario"

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(120), nullable=False)
    login = db.Column(db.String(60), unique=True, nullable=False, index=True)
    senha_hash = db.Column(db.String(255), nullable=False)
    papel = db.Column(_enum(Papel, "papel_usuario"), nullable=False, default=Papel.REPOSITOR)
    contato_telegram = db.Column(db.String(60))  # chat_id do bot, opcional
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    criado_em = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    # Trava contra chute de senha
    tentativas_falhas = db.Column(db.Integer, nullable=False, default=0)
    bloqueado_ate = db.Column(db.DateTime)

    produtos_sob_responsabilidade = db.relationship(
        "Produto", back_populates="responsavel_padrao", foreign_keys="Produto.responsavel_padrao_id"
    )
    movimentos = db.relationship("MovimentoEstoque", back_populates="usuario")
    alertas = db.relationship("Alerta", back_populates="destinatario")

    def definir_senha(self, senha):
        self.senha_hash = generate_password_hash(senha)

    def conferir_senha(self, senha):
        return check_password_hash(self.senha_hash, senha)

    @property
    def is_active(self):
        return self.ativo

    @property
    def eh_admin(self):
        return self.papel == Papel.ADMIN

    def pode(self, acao):
        """Permissoes simples por papel (ver README, secao Perfis)."""
        return acao in PERMISSOES.get(self.papel, set())

    def get_id(self):
        """Identificador da sessao: o id mais uma marca da senha atual.

        Com a marca, trocar a senha invalida na hora as sessoes e os cookies
        de "lembrar de mim" que ja' existiam.
        """
        marca = sha256((self.senha_hash or "").encode()).hexdigest()[:16]
        return f"{self.id}:{marca}"

    @property
    def esta_bloqueado(self):
        """True enquanto durar a trava por erro de senha."""
        return bool(self.bloqueado_ate and self.bloqueado_ate > datetime.utcnow())

    def registrar_erro_de_senha(self, maximo, minutos):
        """Conta mais um erro e tranca a conta quando passar do limite."""
        self.tentativas_falhas = (self.tentativas_falhas or 0) + 1
        if self.tentativas_falhas >= maximo:
            self.bloqueado_ate = datetime.utcnow() + timedelta(minutes=minutos)
            self.tentativas_falhas = 0

    def registrar_acerto_de_senha(self):
        self.tentativas_falhas = 0
        self.bloqueado_ate = None

    def __repr__(self):
        return f"<Usuario {self.login} ({self.papel.value})>"


# O que cada papel pode fazer. Mantido simples de proposito.
PERMISSOES = {
    Papel.ADMIN: {
        "ver_painel", "cadastrar_produto", "editar_produto", "registrar_entrada",
        "registrar_saida", "registrar_perda", "ver_relatorios", "gerenciar_usuarios",
        "gerar_lista_compras", "configurar_dias_especiais",
    },
    Papel.OPERADOR: {
        "ver_painel", "cadastrar_produto", "editar_produto", "registrar_entrada",
        "registrar_saida", "registrar_perda", "ver_relatorios", "gerar_lista_compras",
    },
    Papel.REPOSITOR: {
        "ver_painel", "registrar_saida", "registrar_perda",
    },
}


class Produto(db.Model):
    __tablename__ = "produto"

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(120), nullable=False, index=True)
    categoria = db.Column(_enum(Categoria, "categoria_produto"), nullable=False,
                          default=Categoria.NAO_PERECIVEL)
    # Area da loja (acougue, bebidas, frios...). Usada para dividir a responsabilidade.
    setor = db.Column(db.String(60), nullable=False, default="Mercearia", index=True)
    unidade_medida = db.Column(db.String(10), nullable=False, default="un")

    limite_minimo = db.Column(db.Numeric(12, 3), nullable=False, default=ZERO)
    # Limite usado na sexta/fim de semana e vespera de feriado (regra do cliente)
    limite_minimo_fim_de_semana = db.Column(db.Numeric(12, 3))

    dias_aviso_validade = db.Column(db.Integer)  # sobrepoe o padrao global, se preenchido
    preco_custo = db.Column(db.Numeric(12, 2))
    preco_venda = db.Column(db.Numeric(12, 2))

    responsavel_padrao_id = db.Column(db.Integer, db.ForeignKey("usuario.id"))
    responsavel_padrao = db.relationship("Usuario", back_populates="produtos_sob_responsabilidade",
                                         foreign_keys=[responsavel_padrao_id])

    ativo = db.Column(db.Boolean, nullable=False, default=True, index=True)
    criado_em = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    atualizado_em = db.Column(db.DateTime, nullable=False, default=datetime.utcnow,
                              onupdate=datetime.utcnow)

    lotes = db.relationship("LoteEstoque", back_populates="produto",
                            cascade="all, delete-orphan", order_by="LoteEstoque.id")
    movimentos = db.relationship("MovimentoEstoque", back_populates="produto",
                                 cascade="all, delete-orphan")
    alertas = db.relationship("Alerta", back_populates="produto", cascade="all, delete-orphan")

    __table_args__ = (db.UniqueConstraint("nome", name="uq_produto_nome"),)

    @property
    def estoque_atual(self):
        return sum((lote.quantidade for lote in self.lotes), ZERO)

    @property
    def eh_perecivel(self):
        return self.categoria == Categoria.PERECIVEL

    def __repr__(self):
        return f"<Produto {self.nome}>"


class LoteEstoque(db.Model):
    """Cada chegada de mercadoria vira um lote, com sua propria validade."""
    __tablename__ = "lote_estoque"

    id = db.Column(db.Integer, primary_key=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produto.id"), nullable=False, index=True)
    quantidade = db.Column(db.Numeric(12, 3), nullable=False, default=ZERO)  # o que ainda resta
    quantidade_inicial = db.Column(db.Numeric(12, 3), nullable=False, default=ZERO)
    data_entrada = db.Column(db.Date, nullable=False, default=date.today, index=True)
    data_validade = db.Column(db.Date, index=True)  # so perecivel
    origem_compra = db.Column(db.String(120))
    custo_unitario = db.Column(db.Numeric(12, 2))
    criado_em = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    produto = db.relationship("Produto", back_populates="lotes")
    movimentos = db.relationship("MovimentoEstoque", back_populates="lote")

    def dias_para_vencer(self, hoje=None):
        if not self.data_validade:
            return None
        return (self.data_validade - (hoje or date.today())).days

    def __repr__(self):
        return f"<Lote {self.produto_id} qtd={self.quantidade} val={self.data_validade}>"


class MovimentoEstoque(db.Model):
    __tablename__ = "movimento_estoque"

    id = db.Column(db.Integer, primary_key=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produto.id"), nullable=False, index=True)
    lote_id = db.Column(db.Integer, db.ForeignKey("lote_estoque.id"))
    tipo = db.Column(_enum(TipoMovimento, "tipo_movimento"), nullable=False, index=True)
    quantidade = db.Column(db.Numeric(12, 3), nullable=False)
    data_hora = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey("usuario.id"), nullable=False)
    motivo = db.Column(_enum(MotivoPerda, "motivo_perda"))  # so para perdas
    observacao = db.Column(db.String(200))
    valor_estimado = db.Column(db.Numeric(12, 2))  # usado no relatorio de perdas

    produto = db.relationship("Produto", back_populates="movimentos")
    lote = db.relationship("LoteEstoque", back_populates="movimentos")
    usuario = db.relationship("Usuario", back_populates="movimentos")

    def __repr__(self):
        return f"<Movimento {self.tipo.value} {self.quantidade} produto={self.produto_id}>"


class Alerta(db.Model):
    __tablename__ = "alerta"

    id = db.Column(db.Integer, primary_key=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produto.id"), nullable=False, index=True)
    tipo = db.Column(_enum(TipoAlerta, "tipo_alerta"), nullable=False, index=True)
    destinatario_id = db.Column(db.Integer, db.ForeignKey("usuario.id"), nullable=False, index=True)
    data_criacao = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    status = db.Column(_enum(StatusAlerta, "status_alerta"), nullable=False,
                       default=StatusAlerta.PENDENTE, index=True)
    mensagem = db.Column(db.String(255), nullable=False)
    enviado_telegram = db.Column(db.Boolean, nullable=False, default=False)
    resolvido_em = db.Column(db.DateTime)

    produto = db.relationship("Produto", back_populates="alertas")
    destinatario = db.relationship("Usuario", back_populates="alertas")

    __table_args__ = (
        # No maximo um aviso pendente por produto e tipo. Sem isso, duas telas
        # abertas ao mesmo tempo abriam o mesmo aviso duas vezes.
        db.Index("uq_alerta_pendente_por_produto", "produto_id", "tipo",
                 unique=True, postgresql_where=db.text("status = 'pendente'")),
    )

    def __repr__(self):
        return f"<Alerta {self.tipo.value} produto={self.produto_id} {self.status.value}>"


class ListaCompraSugerida(db.Model):
    __tablename__ = "lista_compra_sugerida"

    id = db.Column(db.Integer, primary_key=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produto.id"), nullable=False, index=True)
    quantidade_sugerida = db.Column(db.Numeric(12, 3), nullable=False)
    data_geracao = db.Column(db.Date, nullable=False, default=date.today, index=True)
    justificativa = db.Column(db.String(255), nullable=False)
    comprado = db.Column(db.Boolean, nullable=False, default=False)

    produto = db.relationship("Produto")

    __table_args__ = (
        db.UniqueConstraint("produto_id", "data_geracao", name="uq_sugestao_produto_dia"),
    )


class DiaEspecial(db.Model):
    """Feriados e datas comemorativas: mudam o limite minimo do dia anterior."""
    __tablename__ = "dia_especial"

    id = db.Column(db.Integer, primary_key=True)
    data = db.Column(db.Date, nullable=False, unique=True, index=True)
    descricao = db.Column(db.String(120), nullable=False)
