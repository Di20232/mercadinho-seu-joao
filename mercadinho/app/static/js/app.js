/* Mercadinho do Seu Joao - JavaScript das telas.
   Sem framework: so o necessario para a tela ficar simples de usar no celular. */
(function () {
  "use strict";

  /* ---------- mostrar/esconder senha ---------- */
  document.querySelectorAll("[data-ver-senha]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      var campo = document.querySelector(botao.dataset.verSenha);
      if (!campo) return;
      var escondido = campo.type === "password";
      campo.type = escondido ? "text" : "password";
      botao.innerHTML = escondido ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
    });
  });

  /* ---------- filtro da lista do painel ---------- */
  var buscaLista = document.getElementById("busca-lista");
  if (buscaLista) {
    buscaLista.addEventListener("input", function () {
      var termo = buscaLista.value.trim().toLowerCase();
      document.querySelectorAll("#lista-produtos [data-nome]").forEach(function (item) {
        item.hidden = termo !== "" && item.dataset.nome.indexOf(termo) === -1;
      });
    });
    buscaLista.form.addEventListener("submit", function (evento) { evento.preventDefault(); });
  }

  /* ---------- seletor de produto das telas de movimento ---------- */
  document.querySelectorAll("[data-seletor]").forEach(function (seletor) {
    var campoId = seletor.querySelector("[data-produto-id]");
    var busca = seletor.querySelector("[data-busca-produto]");
    var passoBusca = seletor.querySelector("[data-passo-busca]");
    var escolhido = seletor.querySelector("[data-produto-escolhido]");
    var nomeEscolhido = seletor.querySelector("[data-nome-escolhido]");
    var estoqueEscolhido = seletor.querySelector("[data-estoque-escolhido]");
    var formulario = seletor.closest("form");
    var unidade = formulario ? formulario.querySelector("[data-unidade]") : null;
    var blocoValidade = formulario ? formulario.querySelector("[data-so-perecivel]") : null;
    var campoValidade = blocoValidade ? blocoValidade.querySelector("input") : null;

    if (busca) {
      busca.addEventListener("input", function () {
        var termo = busca.value.trim().toLowerCase();
        seletor.querySelectorAll(".opcao-produto").forEach(function (opcao) {
          opcao.hidden = termo !== "" && opcao.dataset.filtro.indexOf(termo) === -1;
        });
      });
    }

    seletor.querySelectorAll(".opcao-produto").forEach(function (opcao) {
      opcao.addEventListener("click", function () {
        campoId.value = opcao.dataset.id;
        nomeEscolhido.textContent = opcao.dataset.nome;
        if (estoqueEscolhido && opcao.dataset.estoque !== undefined) {
          estoqueEscolhido.textContent = "Tem " + opcao.dataset.estoque + " " + opcao.dataset.unidade + " no estoque";
        }
        if (unidade) unidade.textContent = opcao.dataset.unidade;
        if (blocoValidade) {
          var perecivel = opcao.dataset.perecivel === "sim";
          blocoValidade.classList.toggle("d-none", !perecivel);
          if (campoValidade) campoValidade.required = perecivel;
        }
        passoBusca.classList.add("d-none");
        escolhido.classList.remove("d-none");
        var quantidade = formulario ? formulario.querySelector("[data-campo-quantidade]") : null;
        if (quantidade) quantidade.focus();
      });
    });

    var trocar = seletor.querySelector("[data-trocar-produto]");
    if (trocar) {
      trocar.addEventListener("click", function () {
        campoId.value = "";
        escolhido.classList.add("d-none");
        passoBusca.classList.remove("d-none");
        if (blocoValidade) blocoValidade.classList.add("d-none");
        if (campoValidade) campoValidade.required = false;
        if (busca) { busca.value = ""; busca.dispatchEvent(new Event("input")); busca.focus(); }
      });
    }

    if (formulario) {
      formulario.addEventListener("submit", function (evento) {
        if (!campoId.value) {
          evento.preventDefault();
          alert("Escolha o produto primeiro.");
          if (busca) busca.focus();
        }
      });
    }
  });

  /* ---------- botoes + e - da quantidade ---------- */
  document.querySelectorAll("[data-passo]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      var campo = botao.closest(".input-group").querySelector("[data-campo-quantidade]");
      if (!campo) return;
      var atual = parseFloat((campo.value || "0").replace(",", ".")) || 0;
      var novo = atual + parseFloat(botao.dataset.passo);
      campo.value = novo < 0 ? 0 : String(Math.round(novo * 100) / 100).replace(".", ",");
    });
  });

  /* ---------- baixa rapida (-1) direto no painel ---------- */
  document.querySelectorAll(".botao-saida-rapida").forEach(function (botao) {
    botao.addEventListener("click", function () {
      var id = botao.dataset.produto;
      botao.disabled = true;
      var meta = document.querySelector('meta[name="csrf-token"]');
      fetch("/api/saida-rapida", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": meta ? meta.content : ""
        },
        body: JSON.stringify({ produto_id: Number(id), quantidade: 1 })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, dados: d }; }); })
        .then(function (resposta) {
          if (!resposta.ok || !resposta.dados.ok) {
            alert(resposta.dados.erro || "Não consegui dar baixa.");
            return;
          }
          var linha = botao.closest(".item-estoque");
          var quantidade = linha.querySelector('[data-estoque="' + id + '"]');
          if (quantidade) quantidade.textContent = resposta.dados.estoque;
          linha.classList.remove("borda-success", "borda-warning", "borda-danger");
          linha.classList.add("borda-" + resposta.dados.cor);
          var bolinha = linha.querySelector(".bolinha");
          if (bolinha) bolinha.className = "bolinha bg-" + resposta.dados.cor;
          if (resposta.dados.estoque === "0") botao.remove();
        })
        .catch(function () { alert("Sem conexão agora. Tente de novo."); })
        .finally(function () { botao.disabled = false; });
    });
  });
})();
