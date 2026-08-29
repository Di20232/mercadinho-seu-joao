"""Os cinco casos de uso combinados com o cliente (secao 6 do briefing).

Cada teste aqui e' um criterio de aceitacao do MVP.
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from app.extensions import db
from app.models import (Categoria, MotivoPerda, Papel, StatusAlerta,
                        TipoAlerta)
from app.servicos import alertas as servico_alertas
from app.servicos import compras as servico_compras
from app.servicos import estoque as servico_estoque
from app.servicos import regras
from app.servicos import relatorios
from conftest import SEGUNDA, SEXTA, criar_produto, criar_usuario


def test_caso_1_contrafile_critico_na_sexta_e_tranquilo_na_segunda(app, dono):
    """"Duas unidades de contrafile e' critico na sexta e tranquilo na segunda."""
    contrafile = criar_produto(
        "Contrafilé", categoria=Categoria.PERECIVEL, setor="Açougue",
        unidade_medida="kg", limite_minimo=Decimal("2"),
        limite_minimo_fim_de_semana=Decimal("8"), responsavel_padrao=dono,
    )
    servico_estoque.registrar_entrada(contrafile, 5, dono,
                                      data_validade=date.today() + timedelta(days=20))
    db.session.commit()

    # A venda reduz o estoque
    servico_estoque.registrar_saida(contrafile, 3, dono, observacao="Venda no balcão")
    db.session.commit()
    assert servico_estoque.estoque_atual(contrafile) == Decimal("2")

    segunda = servico_estoque.situacao_produto(contrafile, SEGUNDA)
    sexta = servico_estoque.situacao_produto(contrafile, SEXTA)

    assert segunda["limite"] == Decimal("2")
    assert sexta["limite"] == Decimal("8")
    assert sexta["status_estoque"] == regras.CRITICO     # na sexta, 2 kg e' pouco
    assert segunda["status_estoque"] != regras.CRITICO   # na segunda, 2 kg esta' de bom tamanho
    assert sexta["motivo_limite"] == "sexta-feira"

    # E o alerta so' aparece no dia em que o estoque e' realmente critico
    servico_alertas.avaliar_produto(contrafile, SEXTA, notificar=False)
    db.session.commit()
    de_reposicao = [a for a in servico_alertas.alertas_do_usuario(dono)
                    if a.tipo == TipoAlerta.LIMITE_MINIMO]
    assert len(de_reposicao) == 1
    assert "sexta-feira" in de_reposicao[0].mensagem

    # Na segunda, o mesmo estoque nao abre alerta de reposicao
    servico_alertas.avaliar_produto(contrafile, SEGUNDA, notificar=False)
    db.session.commit()
    assert [a for a in servico_alertas.alertas_do_usuario(dono)
            if a.tipo == TipoAlerta.LIMITE_MINIMO] == []


def test_caso_2_carne_parada_no_balcao_vira_risco_de_perda(app, dono):
    """"A carne esta' ha 2 dias sem sair" - o sistema avisa antes de estragar."""
    carne = criar_produto("Carne resfriada", categoria=Categoria.PERECIVEL,
                          setor="Açougue", unidade_medida="kg",
                          limite_minimo=Decimal("1"), responsavel_padrao=dono)
    hoje = date.today()
    servico_estoque.registrar_entrada(carne, 5, dono,
                                      data_validade=hoje + timedelta(days=10),
                                      data_entrada=hoje - timedelta(days=3))
    db.session.commit()
    # Ultima saida foi ha 2 dias
    servico_estoque.registrar_saida(
        carne, 1, dono, quando=datetime.combine(hoje - timedelta(days=2), time(9)))
    db.session.commit()

    situacao = servico_estoque.situacao_produto(carne, hoje)
    assert situacao["dias_parado"] == 2
    assert situacao["risco_parado"] is True

    servico_alertas.avaliar_produto(carne, hoje, notificar=False)
    db.session.commit()
    tipos = [a.tipo for a in servico_alertas.alertas_do_usuario(dono)]
    assert TipoAlerta.PARADO_PERECIVEL in tipos


def test_caso_3_lista_de_compras_da_sexta_aponta_carne_carvao_e_cerveja(app, dono):
    """Sexta a tarde: o que nao pode faltar no fim de semana ja' aparece na lista."""
    carne = criar_produto("Contrafilé", categoria=Categoria.PERECIVEL, setor="Açougue",
                          unidade_medida="kg", limite_minimo=Decimal("3"),
                          limite_minimo_fim_de_semana=Decimal("8"), responsavel_padrao=dono)
    carvao = criar_produto("Carvão 3kg", setor="Mercearia", limite_minimo=Decimal("5"),
                           limite_minimo_fim_de_semana=Decimal("15"), responsavel_padrao=dono)
    cerveja = criar_produto("Cerveja lata 350ml", setor="Bebidas", limite_minimo=Decimal("24"),
                            limite_minimo_fim_de_semana=Decimal("72"), responsavel_padrao=dono)
    arroz = criar_produto("Arroz 5kg", setor="Mercearia", limite_minimo=Decimal("10"))

    for produto, quantidade in ((carne, 5), (carvao, 10), (cerveja, 40), (arroz, 50)):
        servico_estoque.registrar_entrada(
            produto, quantidade, dono,
            data_validade=date.today() + timedelta(days=30) if produto.eh_perecivel else None)
    db.session.commit()

    lista = servico_compras.gerar_lista(SEXTA)
    nomes = {item.produto.nome for item in lista}

    assert {"Contrafilé", "Carvão 3kg", "Cerveja lata 350ml"} <= nomes
    assert "Arroz 5kg" not in nomes          # esse esta' folgado, nao entra na lista
    assert all(item.quantidade_sugerida > 0 for item in lista)
    assert any("sexta-feira" in item.justificativa for item in lista)


def test_caso_4_perda_por_vencimento_entra_sozinha_no_relatorio_do_mes(app, dono):
    """O dono nao faz conta: o relatorio ja' mostra o prejuizo somado."""
    leite = criar_produto("Leite integral 1L", categoria=Categoria.PERECIVEL,
                          setor="Frios e laticínios", preco_custo=Decimal("4.20"),
                          limite_minimo=Decimal("6"))
    servico_estoque.registrar_entrada(leite, 12, dono,
                                      data_validade=date.today() + timedelta(days=1))
    db.session.commit()

    servico_estoque.registrar_perda(leite, 5, dono, MotivoPerda.VENCIDO)
    db.session.commit()

    hoje = date.today()
    dados = relatorios.perdas_do_mes(hoje.year, hoje.month)

    assert dados["total_valor"] == Decimal("21.00")     # 5 x R$ 4,20
    assert dados["por_motivo"][0]["motivo"] == MotivoPerda.VENCIDO
    assert dados["por_produto"][0]["produto"].nome == "Leite integral 1L"
    assert servico_estoque.estoque_atual(leite) == Decimal("7")


def test_caso_5_alerta_de_bebidas_vai_so_para_o_responsavel(app, dono):
    """"O sobrinho recebe o alerta das bebidas; os outros nao recebem."""
    sobrinho = criar_usuario("Lucas (sobrinho)", "lucas", Papel.OPERADOR)
    outro = criar_usuario("Bruno", "bruno", Papel.REPOSITOR)

    cerveja = criar_produto("Cerveja lata 350ml", setor="Bebidas",
                            limite_minimo=Decimal("24"), responsavel_padrao=sobrinho)
    arroz = criar_produto("Arroz 5kg", setor="Mercearia",
                          limite_minimo=Decimal("10"), responsavel_padrao=outro)

    servico_estoque.registrar_entrada(cerveja, 10, dono)   # abaixo do minimo
    servico_estoque.registrar_entrada(arroz, 50, dono)     # folgado
    db.session.commit()

    servico_alertas.verificar_tudo(date.today(), notificar=False)

    do_sobrinho = servico_alertas.alertas_do_usuario(sobrinho)
    do_outro = servico_alertas.alertas_do_usuario(outro)

    assert len(do_sobrinho) == 1
    assert do_sobrinho[0].produto.nome == "Cerveja lata 350ml"
    assert do_outro == []                                  # nao recebe o que nao e' dele

    # O dono, como admin, enxerga tudo o que acontece na loja
    todos = servico_alertas.alertas_do_usuario(dono)
    assert len(todos) == 1
