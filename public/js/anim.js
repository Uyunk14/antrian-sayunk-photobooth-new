/* Animasi Sayunk — smooth scroll (Lenis) + reveal (GSAP ScrollTrigger).
   Progressive enhancement: kalau library gagal / prefers-reduced-motion,
   konten tetap tampil normal (tidak ada yang tersembunyi permanen). */
(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGSAP = !!(window.gsap && window.ScrollTrigger);
  if (hasGSAP) gsap.registerPlugin(ScrollTrigger);

  // ---------- Smooth scroll ----------
  var lenis = null;
  if (!reduce && window.Lenis) {
    try {
      lenis = new Lenis({ duration: 1.05, smoothWheel: true, wheelMultiplier: 1, touchMultiplier: 1.6 });
      var raf = function (t) { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
      if (hasGSAP) { lenis.on('scroll', ScrollTrigger.update); }
      // Klik anchor internal → scroll halus
      document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a[href^="#"]');
        if (a && a.getAttribute('href').length > 1) {
          var el = document.querySelector(a.getAttribute('href'));
          if (el) { e.preventDefault(); lenis.scrollTo(el, { offset: -20 }); }
        }
      });
    } catch (e) {}
  }

  if (reduce || !hasGSAP) return; // konten sudah terlihat via CSS

  var EASE = 'power3.out';

  // ---------- Intro (saat halaman dibuka) ----------
  var intro = document.querySelectorAll('[data-anim="intro"]');
  if (intro.length) {
    gsap.from(intro, { y: 26, opacity: 0, duration: 0.85, ease: EASE, stagger: 0.09, delay: 0.05 });
  }

  // ---------- Reveal saat scroll ----------
  document.querySelectorAll('[data-reveal]').forEach(function (el) {
    gsap.from(el, {
      y: 44, opacity: 0, duration: 0.85, ease: EASE,
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });

  // ---------- Parallax lembut ----------
  document.querySelectorAll('[data-parallax]').forEach(function (el) {
    var amt = parseFloat(el.getAttribute('data-parallax')) || 20;
    gsap.to(el, {
      yPercent: amt, ease: 'none',
      scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 0.6 },
    });
  });

  // ---------- Float (visual hero mengambang), pertahankan rotasi CSS ----------
  document.querySelectorAll('[data-float]').forEach(function (el, i) {
    var rot = 0;
    var m = getComputedStyle(el).transform;
    if (m && m !== 'none') {
      var v = m.match(/matrix\(([^)]+)\)/);
      if (v) { var p = v[1].split(','); rot = Math.round(Math.atan2(parseFloat(p[1]), parseFloat(p[0])) * 180 / Math.PI); }
    }
    gsap.set(el, { rotation: rot });
    gsap.to(el, { y: '+=14', duration: 2.8 + i * 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: i * 0.3 });
  });

  // ---------- Item dinamis (paket & template di halaman pelanggan) ----------
  var pending = [], flush = null;
  function queueReveal(el) {
    gsap.set(el, { opacity: 0, y: 30 });
    pending.push(el);
    if (flush) clearTimeout(flush);
    flush = setTimeout(function () {
      gsap.to(pending, { opacity: 1, y: 0, duration: 0.7, ease: EASE, stagger: 0.06 });
      pending = [];
      ScrollTrigger.refresh();
    }, 60);
  }
  var mo = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      for (var i = 0; i < m.addedNodes.length; i++) {
        var n = m.addedNodes[i];
        if (n.nodeType === 1 && n.matches && n.matches('.pkg, .tbox')) queueReveal(n);
      }
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // ---------- Reveal antar-tab di panel admin ----------
  function revealActivePage() {
    var page = document.querySelector('.page.active');
    if (page) gsap.from(page.children, { y: 18, opacity: 0, duration: 0.5, ease: 'power2.out', stagger: 0.05 });
  }
  if (document.querySelector('.nav-item')) {
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.nav-item')) setTimeout(revealActivePage, 20);
    });
  }

  window.addEventListener('load', function () { ScrollTrigger.refresh(); });

  // ---------- Failsafe ----------
  // Kalau requestAnimationFrame tak pernah jalan (lingkungan aneh), jangan
  // biarkan konten tersembunyi: matikan animasi & tampilkan semuanya.
  setTimeout(function () {
    if (gsap.ticker.frame === 0) {
      try { gsap.globalTimeline.clear(); } catch (e) {}
      document.querySelectorAll('[data-anim="intro"], [data-reveal], .pkg, .tbox').forEach(function (el) {
        el.style.opacity = ''; el.style.transform = '';
      });
    }
  }, 4000);
})();
