// Comportamento comum a todas as páginas: menu do celular e tema claro/escuro.
(function () {
  var root = document.documentElement;
  var header = document.querySelector('.site-header');
  var menuBtn = document.querySelector('.menu-btn');

  function setMenu(open) {
    header.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  }

  if (header && menuBtn) {
    menuBtn.addEventListener('click', function () {
      setMenu(!header.classList.contains('open'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && header.classList.contains('open')) {
        setMenu(false);
        menuBtn.focus();
      }
    });
  }

  var themeBtn = document.querySelector('.theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var current = root.getAttribute('data-theme');
      var dark = current ? current === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = dark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('tema', next); } catch (e) { /* sem armazenamento: vale só nesta visita */ }
    });
  }
})();
