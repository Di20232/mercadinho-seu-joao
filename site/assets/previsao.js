// Simulador da previsão de compra: a mesma conta descrita nos quatro passos da página.
(function () {
  var PRESET = {
    leite: { est: 30, vend: 210, prazo: 2, cob: 7, val: 45 },
    arroz: { est: 18, vend: 90, prazo: 3, cob: 14, val: 300 },
    iogurte: { est: 40, vend: 120, prazo: 1, cob: 5, val: 10 }
  };
  var CAMPOS = ['est', 'vend', 'prazo', 'cob', 'val'];

  function $(id) { return document.getElementById(id); }
  if (!$('simulador')) return;

  function fmt(n) { return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }
  function unidades(n) { return n === 1 ? '1 unidade' : fmt(n) + ' unidades'; }

  // Campo vazio ou inválido vale o mínimo; número negativo não faz sentido em nenhum campo.
  function num(id, min) {
    var v = Number($(id).value);
    return isFinite(v) ? Math.max(min, v) : min;
  }

  function mostrarDias(texto, sufixo) {
    var el = $('dias');
    el.textContent = texto;
    if (sufixo) {
      var s = document.createElement('small');
      s.textContent = ' ' + sufixo;
      el.appendChild(s);
    }
  }

  function mostrarStatus(cls, titulo, msg) {
    $('pill').className = 'pill ' + cls;
    $('pill').textContent = titulo;
    $('msg').textContent = msg;
  }

  function calcular() {
    var est = num('est', 0);
    var vend = num('vend', 0);
    var prazo = num('prazo', 0);
    var cob = num('cob', 1);
    var val = num('val', 0);

    // Passo 1: média por dia.
    var media = vend / 30;
    $('media').textContent = fmt(media) + ' por dia';

    if (media === 0) {
      mostrarDias('sem vendas');
      mostrarStatus('warn', 'SEM HISTÓRICO', 'Sem vendas registradas não dá para prever. Registre o fechamento do dia.');
      $('acaba').textContent = '-';
      $('qtd').textContent = '-';
      return;
    }

    // Passo 2: dias de estoque.
    var dias = est / media;
    // Passo 4: quanto comprar, sem cobrir mais dias do que a validade permite.
    var cobertura = Math.min(cob, val);
    var qtd = Math.max(0, Math.ceil(media * cobertura - est));

    mostrarDias(fmt(dias), 'dias de estoque');
    var fim = new Date();
    fim.setDate(fim.getDate() + Math.floor(dias));
    $('acaba').textContent = fim.toLocaleDateString('pt-BR');
    $('qtd').textContent = qtd + ' un.';

    if (dias > val) {
      mostrarStatus('bad', 'VAI VENCER ANTES DE VENDER',
        'O estoque dura mais que a validade. Sobram cerca de ' + unidades(Math.ceil(est - media * val)) +
        '. Não compre mais e pense em fazer promoção.');
      return;
    }

    // Passo 3: hora de comprar, com folga de 3 dias além do prazo do fornecedor.
    var cls, titulo, msg;
    if (dias <= prazo) {
      cls = 'bad'; titulo = 'COMPRAR JÁ';
      msg = 'O estoque acaba antes ou junto com a entrega do fornecedor. Peça agora ' + unidades(qtd) + '.';
    } else if (dias <= prazo + 3) {
      cls = 'warn'; titulo = 'COMPRAR ESTA SEMANA';
      msg = 'Peça ' + unidades(qtd) + ' para não faltar.';
    } else {
      mostrarStatus('ok', 'ESTOQUE BOM', 'Não precisa comprar agora.');
      return;
    }

    if (qtd === 0) {
      msg = 'Está na hora de pedir, mas o estoque atual já cobre ' + (cobertura === 1 ? 'o 1 dia' : 'os ' + fmt(cobertura) + ' dias') +
        ' que você quer cobrir. Aumente os dias de cobertura para calcular o pedido.';
    } else if (cob > val) {
      msg += ' A quantidade foi limitada pela validade (' + val + ' dias).';
    }
    mostrarStatus(cls, titulo, msg);
  }

  $('simulador').addEventListener('submit', function (e) { e.preventDefault(); });
  $('prod').addEventListener('change', function (e) {
    var p = PRESET[e.target.value];
    CAMPOS.forEach(function (id) { $(id).value = p[id]; });
    calcular();
  });
  CAMPOS.forEach(function (id) { $(id).addEventListener('input', calcular); });
  calcular();
})();
