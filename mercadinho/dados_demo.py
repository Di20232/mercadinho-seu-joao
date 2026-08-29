"""Carga de demonstracao do Mercadinho do Seu Joao.

Monta a loja do jeito que ela apareceu na entrevista: o dono, a esposa, o
sobrinho (que cuida das bebidas) e os dois funcionarios; os produtos que
"nao podem faltar" no fim de semana; e um historico de vendas dos ultimos
dias para a lista de compras ter base de calculo.

    python dados_demo.py            # cria tudo (apaga o que existir)
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from app import create_app
from app.extensions import db
from app.models import (Alerta, Categoria, DiaEspecial, ListaCompraSugerida,
                        LoteEstoque, MotivoPerda, MovimentoEstoque, Papel,
                        Produto, TipoMovimento, Usuario)
from app.servicos import alertas as servico_alertas
from app.servicos import estoque as servico_estoque

HOJE = date.today()


def limpar():
    for modelo in (Alerta, ListaCompraSugerida, MovimentoEstoque, LoteEstoque,
                   Produto, DiaEspecial, Usuario):
        modelo.query.delete()
    db.session.commit()


def criar_usuarios():
    pessoas = [
        ("Seu João", "joao", Papel.ADMIN, "joao123"),
        ("Dona Maria", "maria", Papel.ADMIN, "maria123"),
        ("Lucas (sobrinho)", "lucas", Papel.OPERADOR, "lucas123"),
        ("Cida", "cida", Papel.REPOSITOR, "cida123"),
        ("Bruno", "bruno", Papel.REPOSITOR, "bruno123"),
    ]
    criados = {}
    for nome, login, papel, senha in pessoas:
        usuario = Usuario(nome=nome, login=login, papel=papel)
        usuario.definir_senha(senha)
        db.session.add(usuario)
        criados[login] = usuario
    db.session.commit()
    return criados


def criar_produtos(pessoas):
    #  nome, setor, categoria, unidade, minimo, minimo_fds, custo, venda, responsavel
    catalogo = [
        ("Contrafilé", "Açougue", Categoria.PERECIVEL, "kg", 3, 8, "32.90", "45.90", "cida"),
        ("Linguiça toscana", "Açougue", Categoria.PERECIVEL, "kg", 2, 6, "18.50", "26.90", "cida"),
        ("Carne moída", "Açougue", Categoria.PERECIVEL, "kg", 3, 6, "24.00", "33.90", "cida"),
        ("Cerveja lata 350ml", "Bebidas", Categoria.NAO_PERECIVEL, "un", 24, 72, "2.80", "4.50", "lucas"),
        ("Refrigerante 2L", "Bebidas", Categoria.NAO_PERECIVEL, "un", 12, 24, "6.20", "9.90", "lucas"),
        ("Água mineral 1,5L", "Bebidas", Categoria.NAO_PERECIVEL, "un", 12, 18, "1.90", "3.50", "lucas"),
        ("Carvão 3kg", "Mercearia", Categoria.NAO_PERECIVEL, "un", 5, 15, "12.00", "19.90", "bruno"),
        ("Queijo mussarela", "Frios e laticínios", Categoria.PERECIVEL, "kg", 2, 4, "36.00", "49.90", "cida"),
        ("Presunto", "Frios e laticínios", Categoria.PERECIVEL, "kg", 2, 3, "28.00", "39.90", "cida"),
        ("Leite integral 1L", "Frios e laticínios", Categoria.PERECIVEL, "un", 12, 18, "4.20", "5.99", "bruno"),
        ("Arroz 5kg", "Mercearia", Categoria.NAO_PERECIVEL, "pct", 10, None, "22.00", "28.90", "bruno"),
        ("Feijão 1kg", "Mercearia", Categoria.NAO_PERECIVEL, "pct", 10, None, "6.50", "9.49", "bruno"),
        ("Óleo de soja 900ml", "Mercearia", Categoria.NAO_PERECIVEL, "un", 8, None, "5.90", "8.49", "bruno"),
        ("Pão de forma", "Padaria", Categoria.PERECIVEL, "un", 4, 8, "6.00", "9.90", "bruno"),
        ("Detergente", "Limpeza e higiene", Categoria.NAO_PERECIVEL, "un", 10, None, "1.80", "2.99", "bruno"),
        ("Papel higiênico 4un", "Limpeza e higiene", Categoria.NAO_PERECIVEL, "pct", 8, None, "5.40", "8.90", "bruno"),
        ("Tomate", "Hortifruti", Categoria.PERECIVEL, "kg", 3, 5, "4.50", "7.90", "cida"),
        ("Banana", "Hortifruti", Categoria.PERECIVEL, "kg", 4, 6, "3.20", "5.90", "cida"),
    ]
    produtos = {}
    for nome, setor, categoria, unidade, minimo, minimo_fds, custo, venda, dono in catalogo:
        produto = Produto(
            nome=nome, setor=setor, categoria=categoria, unidade_medida=unidade,
            limite_minimo=Decimal(minimo),
            limite_minimo_fim_de_semana=Decimal(minimo_fds) if minimo_fds else None,
            preco_custo=Decimal(custo), preco_venda=Decimal(venda),
            responsavel_padrao=pessoas[dono],
        )
        db.session.add(produto)
        produtos[nome] = produto
    db.session.commit()
    return produtos


def criar_estoque(produtos, pessoas):
    """Entradas de mercadoria. Algumas ja entram baixas de proposito."""
    operador = pessoas["lucas"]
    #  produto, quantidade, dias atras, validade em dias (None = nao perece)
    entradas = [
        ("Contrafilé", 12, 6, 4),
        ("Contrafilé", 2, 1, 5),
        ("Linguiça toscana", 8, 5, 6),
        ("Carne moída", 6, 3, 2),       # perto de vencer
        ("Cerveja lata 350ml", 120, 7, None),
        ("Refrigerante 2L", 30, 7, None),
        ("Água mineral 1,5L", 40, 7, None),
        ("Carvão 3kg", 8, 10, None),
        ("Queijo mussarela", 5, 4, 9),
        ("Presunto", 3, 4, 3),          # perto de vencer
        ("Leite integral 1L", 36, 5, 12),
        ("Arroz 5kg", 40, 12, None),
        ("Feijão 1kg", 35, 12, None),
        ("Óleo de soja 900ml", 24, 12, None),
        ("Pão de forma", 10, 2, 2),
        ("Detergente", 30, 15, None),
        ("Papel higiênico 4un", 20, 15, None),
        ("Tomate", 10, 2, 3),
        ("Banana", 12, 2, 4),
    ]
    for nome, quantidade, dias_atras, validade in entradas:
        produto = produtos[nome]
        entrada = HOJE - timedelta(days=dias_atras)
        servico_estoque.registrar_entrada(
            produto, Decimal(quantidade), operador,
            data_validade=(HOJE + timedelta(days=validade)) if validade is not None else None,
            origem_compra="Atacadão", data_entrada=entrada,
        )
    db.session.commit()


def criar_historico_vendas(produtos, pessoas):
    """Saidas dos ultimos dias: base para o calculo de quanto comprar."""
    vendedor = pessoas["cida"]
    #  produto, quanto sai por dia (media)
    ritmo = {
        "Contrafilé": Decimal("1.5"), "Linguiça toscana": Decimal("1"),
        "Carne moída": Decimal("0.8"), "Cerveja lata 350ml": Decimal("14"),
        "Refrigerante 2L": Decimal("3"), "Água mineral 1,5L": Decimal("4"),
        "Carvão 3kg": Decimal("1.5"), "Queijo mussarela": Decimal("0.6"),
        "Leite integral 1L": Decimal("4"), "Arroz 5kg": Decimal("2"),
        "Feijão 1kg": Decimal("2"), "Óleo de soja 900ml": Decimal("1"),
        "Detergente": Decimal("1.5"), "Papel higiênico 4un": Decimal("1"),
        "Tomate": Decimal("1"), "Banana": Decimal("1.5"),
    }
    for dias_atras in range(7, 0, -1):
        dia = HOJE - timedelta(days=dias_atras)
        for nome, media in ritmo.items():
            produto = produtos[nome]
            # fim de semana vende mais
            fator = Decimal("1.8") if dia.weekday() in (4, 5) else Decimal("1")
            quantidade = (media * fator).quantize(Decimal("0.1"))
            if quantidade <= 0:
                continue
            try:
                servico_estoque.registrar_saida(
                    produto, quantidade, vendedor, observacao="Venda no balcão",
                    quando=datetime.combine(dia, time(hour=16)),
                )
            except servico_estoque.EstoqueInsuficiente:
                pass  # acabou antes; e' exatamente o que o sistema quer evitar
        db.session.commit()


def criar_perdas(produtos, pessoas):
    """Algumas perdas do mes, para o relatorio nao nascer vazio."""
    repositor = pessoas["bruno"]
    perdas = [
        ("Leite integral 1L", 3, MotivoPerda.VENCIDO, 5),
        ("Tomate", Decimal("1.5"), MotivoPerda.ESTRAGADO, 3),
        ("Pão de forma", 2, MotivoPerda.VENCIDO, 2),
        ("Refrigerante 2L", 1, MotivoPerda.DANIFICADO, 1),
    ]
    for nome, quantidade, motivo, dias_atras in perdas:
        produto = produtos[nome]
        try:
            servico_estoque.registrar_perda(
                produto, Decimal(str(quantidade)), repositor, motivo,
                quando=datetime.combine(HOJE - timedelta(days=dias_atras), time(hour=10)),
            )
        except servico_estoque.EstoqueInsuficiente:
            pass
    db.session.commit()


def criar_feriados():
    """Uma vespera de feriado proxima, para demonstrar o limite reforcado."""
    proximo = HOJE + timedelta(days=7)
    db.session.add(DiaEspecial(data=proximo, descricao="Feriado (exemplo para demonstração)"))
    db.session.commit()
    return proximo


def main():
    app = create_app()
    with app.app_context():
        db.create_all()
        print("Limpando dados antigos...")
        limpar()

        print("Criando as pessoas da loja...")
        pessoas = criar_usuarios()

        print("Cadastrando os produtos...")
        produtos = criar_produtos(pessoas)

        print("Lançando as entradas de mercadoria...")
        criar_estoque(produtos, pessoas)

        # As perdas vem antes das vendas porque acontecem com o estoque cheio;
        # se rodassem depois, boa parte ja' teria sido vendida.
        print("Registrando as perdas do mês...")
        criar_perdas(produtos, pessoas)

        print("Simulando as vendas da semana...")
        criar_historico_vendas(produtos, pessoas)

        feriado = criar_feriados()

        print("Gerando os avisos...")
        novos = servico_alertas.verificar_tudo(HOJE, notificar=False)

        print()
        print("Pronto! Dados de demonstração carregados.")
        print(f"  {len(produtos)} produtos, {len(pessoas)} pessoas, {len(novos)} aviso(s) aberto(s).")
        print(f"  Feriado de exemplo cadastrado em {feriado.strftime('%d/%m/%Y')}.")
        print()
        print("Entre no sistema com:")
        print("  joao  / joao123   (dono)")
        print("  maria / maria123  (esposa, também dona)")
        print("  lucas / lucas123  (sobrinho, operador — cuida das bebidas)")
        print("  cida  / cida123   (repositora — açougue, frios e hortifruti)")
        print("  bruno / bruno123  (repositor — mercearia e limpeza)")


if __name__ == "__main__":
    main()
