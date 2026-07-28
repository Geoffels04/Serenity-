/* =============================================================================
   tezseract flight engine
   -----------------------------------------------------------------------------
   Scroll drives a camera. The page holds a chain of pre-rendered clips and maps
   scroll position onto each clip's currentTime, so the flight scrubs forward and
   backward under the visitor's thumb.

   Vanilla JS, zero dependencies. It builds its own DOM and injects its own CSS
   (namespaced, inside @layer tezseract) into a container you hand it, so it drops
   into static HTML, Next.js (from a ref effect), Vue (onMounted), Astro, or a
   server-rendered template.

   USAGE
     const flight = mountFlight(document.getElementById('flight'), {
       brand:  { name: 'Pearl & Co.', href: '#top' },
       cta:    { label: 'Order', href: '/order' },   // top bar, optional
       hint:   'scroll to fly in',
       nav:    true,        // top scene nav
       rail:   true,        // right-hand route rail
       sky:    true,        // gradient backdrop + drifting motes
       sceneScroll: 1.3,    // viewport-heights of scroll per scene clip
       linkScroll:  0.9,    // ...per link clip
       crossfade:   0.12,   // seam dissolve width, in viewport-heights
       smoothing:   0.18,   // 0..1 lerp toward the scroll target. Lower = looser
       scenes: [{
         id, label,
         poster, posterMobile,      // still images; posterMobile pairs with a 9:16 clip
         clip,   clipMobile,        // the rendered flight
         accent,                    // per-scene accent colour
         scroll,                    // override sceneScroll for this scene
         dwell,                     // 0..1, camera settles mid-scene. Keep <= 0.6
         eyebrow, title, body, tags: [],
         cta: { primary: {label, href}, secondary: {label, href} }   // last scene
       }, ...],
       links:       [url|null, ...],   // length = scenes.length - 1
       linksMobile: [url|null, ...],   // same length, mobile opt-in only
     });
     // later: flight.destroy()

   A null entry in `links` is legal: the engine crossfades that seam directly, so
   the page still completes when one link clip could not be generated.

   THE ASSETS IT EXPECTS
     - clips encoded at native resolution, crf ~20, -g 8, +faststart, no audio
     - each clip's first frame == the previous clip's last frame (the seam law)
     - optionally 720-wide, -g 4 mobile encodes

   Clips are fetched as Blobs and played from object URLs, because a Blob is always
   fully seekable. That is what makes this work on hosts that do not serve HTTP byte
   ranges, where `video.seekable` would otherwise be [0,0] and every seek would clamp
   to frame 0.

   THEME (CSS custom properties, set on the container or :root)
     --tz-bg  --tz-ink  --tz-ink-soft  --tz-accent
     --tz-font-display  --tz-font-body
   The engine's own rules live in @layer tezseract, so unlayered page rules always
   win without specificity hacks.
   ========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.mountFlight = api.mountFlight;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STYLE_ID = 'tz-flight-css';

  /* ---------- small helpers ---------- */
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function num(v, fallback) { return (typeof v === 'number' && isFinite(v)) ? v : fallback; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smoothstep(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* Monotone remap of scroll to clip time. d = 0 is linear. Higher d makes the
     camera settle in the middle of the scene, exactly where the copy peaks, and
     move quicker near the edges. f(0) = 0 and f(1) = 1 always, so the seam frames
     are never touched. */
  function dwellMap(x, d) {
    var c = x - 0.5;
    return (1 - d) * x + d * (4 * c * c * c + 0.5);
  }

  /* =========================================================================== */

  function mountFlight(host, cfg) {
    cfg = cfg || {};
    var scenes = cfg.scenes || [];
    var N = scenes.length;
    if (!host || !N) return null;

    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    /* Pointer type does not change mid-session, so it is read once. The width
       query is read live, so a desktop resize or a DevTools device toggle swaps
       sources and seek behaviour without a reload. */
    var touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    var narrow = window.matchMedia('(max-width: 860px)');
    function onPhone() { return touch || narrow.matches; }

    var links = cfg.links || [];
    var linksM = cfg.linksMobile || [];
    var SCENE_W = num(cfg.sceneScroll, 1.3);
    var LINK_W = num(cfg.linkScroll, 0.9);
    var FADE = num(cfg.crossfade, 0.12);
    var EASE = clamp(num(cfg.smoothing, 0.18), 0.02, 1);

    injectCSS();
    host.classList.add('tz');

    /* ---- the interleaved chain: scene0, link0, scene1, link1, ... sceneN-1 ---- */
    var chain = [];
    for (var i = 0; i < N; i++) {
      var s = scenes[i];
      var leg = {
        kind: 'scene', si: i,
        clip: s.clip, clipM: s.clipMobile,
        poster: s.poster, posterM: s.posterMobile,
        accent: s.accent,
        span: num(s.scroll, SCENE_W),
        dwell: clamp(num(s.dwell, 0), 0, 1),
        at: 0, want: 0, lit: false, ready: false, painted: false, pending: false
      };
      chain.push(leg);
      s._leg = leg;
      if (i < N - 1 && links[i]) {
        chain.push({
          kind: 'link', si: i,
          clip: links[i], clipM: linksM[i],
          poster: scenes[i + 1].poster, posterM: scenes[i + 1].posterMobile,
          accent: scenes[i + 1].accent,
          span: LINK_W, dwell: 0,
          at: 0, want: 0, lit: false, ready: false, painted: false, pending: false
        });
      }
    }
    var M = chain.length;

    /* ---- DOM ---- */
    var sky = h('div', 'tz-sky');
    var motes = null;
    if (cfg.sky !== false) {
      sky.appendChild(h('div', 'tz-sky__wash'));
      sky.appendChild(h('div', 'tz-sky__bloom'));
      motes = h('div', 'tz-motes');
      sky.appendChild(motes);
    }

    var progress = h('div', 'tz-progress');
    var progressFill = h('i');
    progress.appendChild(progressFill);

    var bar = h('header', 'tz-bar');
    if (cfg.brand && cfg.brand.name) {
      var brand = h('a', 'tz-brand');
      brand.href = cfg.brand.href || '#';
      brand.appendChild(h('span', 'tz-brand__mark'));
      brand.appendChild(h('span', 'tz-brand__name', cfg.brand.name));
      bar.appendChild(brand);
    }
    var nav = h('nav', 'tz-nav');
    if (cfg.nav !== false) bar.appendChild(nav);
    if (cfg.cta && cfg.cta.label) {
      var topCta = h('a', 'tz-bar__cta', cfg.cta.label);
      topCta.href = cfg.cta.href || '#';
      bar.appendChild(topCta);
    }

    var stage = h('div', 'tz-stage');
    var caps = h('div', 'tz-caps');
    var rail = h('nav', 'tz-rail');
    var cue = h('div', 'tz-cue');
    cue.appendChild(h('span', null, cfg.hint || 'scroll'));
    cue.appendChild(h('i'));
    var runway = h('div', 'tz-runway');

    var mounted = [sky, progress, bar, stage, caps];
    if (cfg.rail !== false) mounted.push(rail);
    mounted.push(cue, runway);
    for (var m = 0; m < mounted.length; m++) host.appendChild(mounted[m]);

    /* one node per leg */
    chain.forEach(function (l) {
      var node = h('div', 'tz-leg');
      if (l.accent) node.style.setProperty('--tz-accent', l.accent);
      var img = h('img', 'tz-leg__poster');
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      var src = (onPhone() && l.posterM) ? l.posterM : l.poster;
      if (src) img.src = src;
      node.appendChild(img);
      stage.appendChild(node);
      l.node = node;
      l.img = img;
      l.video = null;
      l.blobUrl = null;
    });

    /* captions, rail dots, nav items */
    var capNodes = [], dots = [], navItems = [];
    scenes.forEach(function (s, idx) {
      var art = h('article', 'tz-cap');
      if (s.accent) art.style.setProperty('--tz-accent', s.accent);
      art.appendChild(h('span', 'tz-cap__num', pad2(idx + 1) + ' / ' + pad2(N)));
      if (s.eyebrow) art.appendChild(h('span', 'tz-cap__eyebrow', s.eyebrow));
      if (s.title) art.appendChild(h('h2', 'tz-cap__title', s.title));
      if (s.body) art.appendChild(h('p', 'tz-cap__body', s.body));
      if (s.tags && s.tags.length) {
        var ul = h('ul', 'tz-cap__tags');
        s.tags.forEach(function (t) { ul.appendChild(h('li', null, t)); });
        art.appendChild(ul);
      }
      if (s.cta) {
        var box = h('div', 'tz-cap__cta');
        ['primary', 'secondary'].forEach(function (k) {
          var b = s.cta[k];
          if (!b || !b.label) return;
          var a = h('a', 'tz-btn tz-btn--' + k, b.label);
          a.href = b.href || '#';
          box.appendChild(a);
        });
        art.appendChild(box);
      }
      caps.appendChild(art);
      capNodes.push(art);

      var dot = h('button', 'tz-rail__dot');
      dot.type = 'button';
      dot.setAttribute('aria-label', s.label || ('Scene ' + (idx + 1)));
      if (s.accent) dot.style.setProperty('--tz-accent', s.accent);
      dot.appendChild(h('span', 'tz-rail__label', s.label || ''));
      dot.appendChild(h('i'));
      dot.addEventListener('click', function () { goTo(idx); });
      rail.appendChild(dot);
      dots.push(dot);

      if (cfg.nav !== false) {
        var item = h('button', 'tz-nav__item', s.label || '');
        item.type = 'button';
        item.addEventListener('click', function () { goTo(idx); });
        nav.appendChild(item);
        navItems.push(item);
      }
    });

    /* ---- layout and scroll mapping ---- */
    var vh = window.innerHeight;
    var laidW = window.innerWidth;
    var totalVH = 0;
    var active = -1;
    var queued = false;
    var rafId = 0;
    var dead = false;

    function layout() {
      vh = window.innerHeight;
      laidW = window.innerWidth;
      var off = 0;
      chain.forEach(function (l) {
        l.top = off * vh;
        off += l.span;
        l.bot = off * vh;
      });
      totalVH = off;
      /* one extra viewport so the final flight actually completes */
      runway.style.height = (totalVH * vh + vh) + 'px';
      sync();
    }

    function goTo(idx) {
      var leg = scenes[idx]._leg;
      window.scrollTo({
        top: leg.top + (leg.bot - leg.top) * 0.5,
        behavior: reduce ? 'auto' : 'smooth'
      });
    }

    function sync() {
      if (dead) return;
      var y = window.scrollY || window.pageYOffset || 0;
      var band = FADE * vh || 1;
      var front = 0, i, l;

      for (i = 0; i < M; i++) if (y >= chain[i].top) front = i;

      for (i = 0; i < M; i++) {
        l = chain[i];
        if (y > l.top - 1.6 * vh && y < l.bot + 1.6 * vh) load(l);

        var p = clamp((y - l.top) / (l.bot - l.top || 1), 0, 1);
        l.want = l.dwell ? dwellMap(p, l.dwell) : p;

        var out = y < l.top ? (l.top - y) : (y > l.bot ? (y - l.bot) : 0);
        var a = smoothstep(1 - out / band);
        l.node.style.opacity = a;
        l.lit = a > 0.001;
        l.node.style.zIndex = (i === front) ? '30' : String(10 + Math.round(a * 10));

        /* Until a clip has painted a real frame, the poster carries the scene and
           gets a slow push so the page never looks frozen. */
        if (!l.painted) {
          var k = reduce ? 1 : 1.03 + p * 0.14;
          l.img.style.transform = 'scale(' + k.toFixed(3) + ')';
        }
      }

      for (i = 0; i < N; i++) {
        var leg = scenes[i]._leg;
        var q = clamp((y - leg.top) / (leg.bot - leg.top || 1), 0, 1);
        var before = y < leg.top, after = y > leg.bot, op;
        if (i === 0) op = after ? 0 : smoothstep(1 - q / 0.62);        /* greets on landing */
        else if (i === N - 1) op = before ? 0 : smoothstep(q / 0.4);   /* holds the CTA */
        else op = (before || after) ? 0 : smoothstep(1 - Math.abs(q - 0.5) / 0.5);
        var c = capNodes[i];
        c.style.opacity = op;
        c.style.transform = reduce ? 'none' : 'translateY(' + ((0.5 - q) * 4).toFixed(2) + 'vh)';
        c.style.pointerEvents = op > 0.5 ? 'auto' : 'none';
      }

      var cur = chain[front];
      var near = cur.kind === 'scene'
        ? cur.si
        : (((y - cur.top) / (cur.bot - cur.top || 1)) > 0.5 ? cur.si + 1 : cur.si);
      near = clamp(near, 0, N - 1);
      if (near !== active) {
        active = near;
        for (i = 0; i < N; i++) {
          dots[i].classList.toggle('is-on', i === near);
          if (navItems[i]) navItems[i].classList.toggle('is-on', i === near);
        }
        if (scenes[near].accent) host.style.setProperty('--tz-accent', scenes[near].accent);
      }

      progressFill.style.transform = 'scaleX(' + clamp(y / (totalVH * vh || 1), 0, 1) + ')';
      cue.style.opacity = clamp(1 - y / (0.5 * vh), 0, 1);
      if (motes) motes.style.transform = 'translate3d(0,' + (-y * 0.05) + 'px,0)';
      queued = false;
    }

    /* ---- clip loading ---- */
    function load(l) {
      /* Under reduced motion no clip is ever fetched. The posters stay up and
         cross-dissolve, so there is no scrubbed motion and no decode cost. */
      if (reduce || l.pending || !l.clip) return;
      l.pending = true;
      var url = (onPhone() && l.clipM) ? l.clipM : l.clip;
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (blob) {
        if (dead) return;
        var v = document.createElement('video');
        v.className = 'tz-leg__clip';
        v.muted = true;
        v.defaultMuted = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.setAttribute('muted', '');
        v.setAttribute('playsinline', '');
        v.setAttribute('disablepictureinpicture', '');
        l.blobUrl = URL.createObjectURL(blob);
        v.src = l.blobUrl;
        v.addEventListener('loadedmetadata', function () { l.ready = true; sync(); });
        /* Reveal the clip only once a real frame has painted. On iOS a muted video
           that was never played stays blank after a seek, so hiding the poster on
           metadata alone would flash an empty scene. */
        v.addEventListener('seeked', function () {
          l.painted = true;
          l.node.classList.add('is-live');
        }, { once: true });
        v.addEventListener('loadeddata', function () {
          try { v.pause(); } catch (e) {}
          if (primed) prime(v);
        });
        l.node.appendChild(v);
        l.video = v;
      }).catch(function () {
        l.pending = false;   /* let a later scroll retry it */
      });
    }

    /* ---- the scrub loop ---- */
    function tick() {
      var eps = onPhone() ? 0.02 : 0.008;   /* coarser step on phones = fewer decodes */
      for (var i = 0; i < M; i++) {
        var l = chain[i], v = l.video;
        if (!v || !l.ready) continue;
        /* Never queue a seek while the decoder is still resolving the last one.
           On a phone a fast flick would otherwise pile seeks up and freeze the
           clip. `at` keeps lerping meanwhile, so it snaps to the newest target
           the moment the decoder frees up. */
        if (v.seeking) continue;
        if (!l.lit && Math.abs(l.at - l.want) < 0.002) continue;
        l.at += (l.want - l.at) * (reduce ? 1 : EASE);
        var t = clamp(l.at, 0, 0.999) * (v.duration || 1);
        if (Math.abs(v.currentTime - t) > eps) {
          try { v.currentTime = t; } catch (e) {}
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    /* ---- iOS priming ----
       iOS wants a user gesture before a muted video will decode and paint
       reliably. On the first touch every loaded clip is primed with a muted
       play then pause, so the first seek shows a frame instead of black. */
    var primed = false;
    function prime(v) {
      if (!onPhone() || !v) return;
      try {
        var p = v.play();
        if (p && p.then) p.then(function () { try { v.pause(); } catch (e) {} }).catch(function () {});
      } catch (e) {}
    }
    function onFirstTouch() {
      if (primed) return;
      primed = true;
      chain.forEach(function (l) { prime(l.video); });
    }

    /* ---- events ---- */
    function onScroll() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(sync);
    }
    /* Mobile browsers fire resize every time the URL bar slides in or out.
       Re-running layout there rebuilds the runway height and yanks the scroll
       position, so on touch only a real width change relayouts. Rotation still
       arrives via orientationchange. */
    function onResize() {
      if (touch && window.innerWidth === laidW) return;
      layout();
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', layout);
    window.addEventListener('load', layout);
    window.addEventListener('pointerdown', onFirstTouch, { once: true, passive: true });
    window.addEventListener('touchstart', onFirstTouch, { once: true, passive: true });

    if (motes) seedMotes(motes, reduce || touch);
    layout();
    rafId = requestAnimationFrame(tick);

    /* ---- public handle ---- */
    return {
      goTo: goTo,
      refresh: layout,
      destroy: function () {
        if (dead) return;
        dead = true;
        cancelAnimationFrame(rafId);
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', layout);
        window.removeEventListener('load', layout);
        window.removeEventListener('pointerdown', onFirstTouch);
        window.removeEventListener('touchstart', onFirstTouch);
        chain.forEach(function (l) {
          if (l.video) { try { l.video.pause(); } catch (e) {} l.video.removeAttribute('src'); }
          if (l.blobUrl) URL.revokeObjectURL(l.blobUrl);
        });
        while (host.firstChild) host.removeChild(host.firstChild);
        host.classList.remove('tz');
      }
    };
  }

  /* ---------- ambient motes ---------- */
  function seedMotes(hostEl, skip) {
    if (skip) return;
    /* Fixed seeds rather than Math.random, so the backdrop is identical on every
       load and across SSR hydration. */
    var seeds = [7, 23, 41, 58, 71, 88, 12, 34, 52, 66, 83, 95, 18, 29, 47, 63, 77, 91];
    for (var k = 0; k < 18; k++) {
      var s = document.createElement('span');
      s.className = 'tz-mote' + (k % 3 === 2 ? ' tz-mote--ring' : '');
      s.style.left = seeds[k % seeds.length] + 'vw';
      s.style.top = ((seeds[(k * 3) % seeds.length] * 1.3) % 100) + 'vh';
      s.style.setProperty('--tz-mote-s', (0.5 + ((seeds[(k * 5) % seeds.length] % 60) / 60) * 1.1).toFixed(2));
      var dur = 14 + (seeds[(k * 7) % seeds.length] % 22);
      s.style.animationDuration = dur + 's';
      s.style.animationDelay = (-(seeds[(k * 2) % seeds.length] % dur)) + 's';
      hostEl.appendChild(s);
    }
  }

  /* ---------- styles ---------- */
  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '.tz{--tz-bg:#F5EDE0;--tz-ink:#241d2b;--tz-ink-soft:#6a6072;--tz-accent:#8a7bb5;',
      '--tz-font-display:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif;',
      '--tz-font-body:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;',
      'color:var(--tz-ink);font-family:var(--tz-font-body);}',
      'html,body{margin:0;overflow-x:hidden;background:var(--tz-bg,#F5EDE0);}',

      '.tz-sky{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--tz-bg);}',
      '.tz-sky__wash{position:absolute;inset:-10%;background:linear-gradient(178deg,color-mix(in srgb,var(--tz-accent) 12%,var(--tz-bg)) 0%,var(--tz-bg) 55%,color-mix(in srgb,var(--tz-accent) 6%,var(--tz-bg)) 100%);}',
      '.tz-sky__bloom{position:absolute;inset:0;background:radial-gradient(60% 42% at 74% 16%,color-mix(in srgb,var(--tz-accent) 20%,transparent),transparent 70%),radial-gradient(46% 34% at 50% 50%,color-mix(in srgb,#fff 42%,transparent),transparent 70%);}',
      '.tz-motes{position:absolute;inset:-6% -2%;will-change:transform;}',
      '.tz-mote{position:absolute;width:12px;height:12px;border-radius:50%;opacity:0;transform:scale(var(--tz-mote-s,1));animation:tz-drift linear infinite;background:radial-gradient(circle at 34% 30%,color-mix(in srgb,var(--tz-accent) 55%,#000),#000 82%);}',
      '.tz-mote--ring{background:none;border:2px solid color-mix(in srgb,var(--tz-accent) 50%,transparent);}',
      '@keyframes tz-drift{0%{opacity:0;transform:scale(var(--tz-mote-s)) translate(0,12vh)}14%{opacity:.45}86%{opacity:.4}100%{opacity:0;transform:scale(var(--tz-mote-s)) translate(4vw,-22vh)}}',

      '.tz-progress{position:fixed;top:0;left:0;right:0;height:3px;z-index:60;background:color-mix(in srgb,var(--tz-accent) 14%,transparent);}',
      '.tz-progress i{display:block;height:100%;width:100%;transform:scaleX(0);transform-origin:0 50%;background:var(--tz-accent);}',

      '.tz-bar{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:clamp(14px,2.4vw,26px) clamp(18px,5vw,64px);}',
      '.tz-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--tz-ink);}',
      '.tz-brand__mark{width:22px;height:26px;border-radius:7px 7px 10px 10px;background:linear-gradient(160deg,var(--tz-accent),color-mix(in srgb,var(--tz-accent) 55%,#000));box-shadow:0 6px 14px color-mix(in srgb,var(--tz-accent) 38%,transparent);}',
      '.tz-brand__name{font-family:var(--tz-font-display);font-weight:700;font-size:1.08rem;}',
      '.tz-nav{display:flex;gap:4px;padding:5px;border-radius:999px;background:color-mix(in srgb,#fff 52%,transparent);backdrop-filter:blur(10px);border:1px solid color-mix(in srgb,var(--tz-accent) 16%,transparent);}',
      '.tz-nav__item{font:inherit;font-size:.82rem;color:var(--tz-ink-soft);border:0;background:transparent;cursor:pointer;padding:7px 14px;border-radius:999px;transition:color .25s,background .25s;}',
      '.tz-nav__item:hover{color:var(--tz-ink);}',
      '.tz-nav__item.is-on{color:#fff;background:var(--tz-accent);}',
      '.tz-bar__cta{text-decoration:none;font-weight:600;font-size:.9rem;color:#fff;background:var(--tz-ink);padding:10px 20px;border-radius:999px;white-space:nowrap;}',

      '.tz-stage{position:fixed;inset:0;z-index:10;pointer-events:none;}',
      '.tz-leg{position:absolute;inset:0;opacity:0;overflow:hidden;will-change:opacity;}',
      '.tz-leg__poster,.tz-leg__clip{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 42%;}',
      '.tz-leg__poster{will-change:transform;transition:opacity .35s;}',
      '.tz-leg__clip{z-index:1;}',
      '.tz-leg.is-live .tz-leg__poster{opacity:0;}',

      '.tz-caps{position:fixed;inset:0;z-index:20;pointer-events:none;}',
      '.tz-caps::before{content:"";position:absolute;inset:0;width:min(58vw,780px);background:linear-gradient(90deg,var(--tz-bg) 0%,color-mix(in srgb,var(--tz-bg) 80%,transparent) 34%,color-mix(in srgb,var(--tz-bg) 38%,transparent) 62%,transparent 100%);}',
      '.tz-cap{position:absolute;left:clamp(18px,5vw,64px);top:50%;transform:translateY(-50%);width:min(42vw,460px);opacity:0;will-change:opacity,transform;}',
      '.tz-cap__num{font-family:ui-monospace,Menlo,monospace;font-size:.74rem;letter-spacing:.12em;color:var(--tz-ink-soft);}',
      '.tz-cap__eyebrow{display:block;margin-top:18px;font-family:var(--tz-font-display);font-weight:700;font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;color:var(--tz-accent);}',
      '.tz-cap__title{font-family:var(--tz-font-display);font-weight:700;font-size:clamp(2rem,4.4vw,3.5rem);line-height:1.03;letter-spacing:-.01em;margin:12px 0 0;color:var(--tz-ink);text-shadow:0 2px 20px color-mix(in srgb,var(--tz-bg) 70%,transparent);}',
      '.tz-cap__body{margin-top:18px;font-size:clamp(1rem,1.25vw,1.14rem);line-height:1.55;max-width:40ch;color:color-mix(in srgb,var(--tz-ink) 78%,var(--tz-ink-soft));text-shadow:0 1px 12px color-mix(in srgb,var(--tz-bg) 90%,transparent);}',
      '.tz-cap__tags{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 0;padding:0;}',
      '.tz-cap__tags li{font-size:.82rem;font-weight:600;padding:7px 14px;border-radius:999px;color:color-mix(in srgb,var(--tz-accent) 70%,#000);background:color-mix(in srgb,var(--tz-accent) 14%,#fff);border:1px solid color-mix(in srgb,var(--tz-accent) 28%,transparent);}',
      '.tz-cap__cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;pointer-events:auto;}',
      '.tz-btn{text-decoration:none;font-weight:600;font-size:.95rem;padding:13px 24px;border-radius:999px;transition:transform .2s;}',
      '.tz-btn--primary{color:#fff;background:var(--tz-ink);}',
      '.tz-btn--secondary{color:var(--tz-ink);border:1.5px solid color-mix(in srgb,var(--tz-ink) 25%,transparent);}',
      '.tz-btn:hover{transform:translateY(-2px);}',

      '.tz-rail{position:fixed;right:clamp(14px,2.4vw,30px);top:50%;transform:translateY(-50%);z-index:40;display:flex;flex-direction:column;gap:22px;padding:18px 10px;}',
      '.tz-rail::before{content:"";position:absolute;left:50%;top:22px;bottom:22px;width:2px;transform:translateX(-50%);background:var(--tz-accent);opacity:.26;}',
      '.tz-rail__dot{position:relative;border:0;background:transparent;cursor:pointer;width:14px;height:14px;display:grid;place-items:center;padding:0;}',
      '.tz-rail__dot i{width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,var(--tz-accent) 40%,transparent);transition:transform .3s,background .3s,box-shadow .3s;}',
      '.tz-rail__dot:hover i{transform:scale(1.25);background:var(--tz-accent);}',
      '.tz-rail__dot.is-on i{background:var(--tz-accent);transform:scale(1.4);box-shadow:0 0 0 5px color-mix(in srgb,var(--tz-accent) 20%,transparent);}',
      '.tz-rail__label{position:absolute;right:24px;top:50%;transform:translateY(-50%) translateX(6px);white-space:nowrap;font-size:.78rem;font-weight:600;color:var(--tz-ink);background:color-mix(in srgb,#fff 85%,transparent);backdrop-filter:blur(6px);padding:5px 11px;border-radius:999px;border:1px solid color-mix(in srgb,var(--tz-accent) 14%,transparent);opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;}',
      '.tz-rail__dot:hover .tz-rail__label,.tz-rail__dot.is-on .tz-rail__label{opacity:1;transform:translateY(-50%) translateX(0);}',

      '.tz-cue{position:fixed;left:50%;bottom:26px;z-index:30;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;color:var(--tz-ink-soft);transition:opacity .3s;}',
      '.tz-cue i{position:relative;width:22px;height:34px;border-radius:12px;border:2px solid color-mix(in srgb,var(--tz-ink) 26%,transparent);}',
      '.tz-cue i::after{content:"";position:absolute;left:50%;top:7px;width:4px;height:7px;border-radius:2px;background:var(--tz-accent);transform:translateX(-50%);animation:tz-wheel 1.7s ease-in-out infinite;}',
      '@keyframes tz-wheel{0%{opacity:0;top:6px}40%{opacity:1}100%{opacity:0;top:17px}}',

      '.tz-runway{position:relative;z-index:1;width:100%;pointer-events:none;}',

      '@media (max-width:860px){',
      '.tz-nav{display:none;}',
      '.tz-caps::before{width:100%;height:60%;top:auto;bottom:0;background:linear-gradient(0deg,var(--tz-bg) 8%,color-mix(in srgb,var(--tz-bg) 68%,transparent) 46%,transparent 100%);}',
      '.tz-cap{left:clamp(18px,5vw,64px);right:clamp(18px,5vw,64px);top:auto;bottom:clamp(64px,14vh,120px);transform:none;width:auto;max-width:560px;}',
      '.tz-cap{bottom:calc(clamp(56px,12dvh,110px) + env(safe-area-inset-bottom));}',
      '.tz-cap__title{font-size:clamp(1.9rem,7.5vw,2.7rem);}',
      '.tz-cap__body{max-width:none;font-size:clamp(.98rem,3.6vw,1.1rem);}',
      '.tz-leg__poster,.tz-leg__clip{object-position:center 46%;}',
      '.tz-cue{bottom:calc(20px + env(safe-area-inset-bottom));}',
      '.tz-rail{gap:16px;right:6px;}.tz-rail__label{display:none;}',
      '}',
      '@media (max-width:860px) and (orientation:portrait){',
      '.tz-leg__poster,.tz-leg__clip{object-position:center 44%;}}',
      '@media (hover:none) and (pointer:coarse){',
      '.tz-rail{padding:14px 6px;}.tz-rail__dot{width:28px;height:28px;}.tz-btn{padding:15px 26px;}}',
      '@media (prefers-reduced-motion:reduce){.tz-cue i::after{animation:none;}.tz-mote{display:none;}}'
    ].join('');

    var style = document.createElement('style');
    style.id = STYLE_ID;
    /* A cascade layer, so the page's own tokens (unlayered :root or .tz rules)
       always beat these defaults regardless of injection order. That is what
       makes a clean dark theme possible without specificity fights. */
    style.textContent = '@layer tezseract {' + css + '}';
    document.head.appendChild(style);
  }

  return { mountFlight: mountFlight };
}));
