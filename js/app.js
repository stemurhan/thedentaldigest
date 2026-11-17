/* Analiz365 — uygulama */
(function () {
  'use strict';
  const D = window.AHAL_DATA || { leagues: [], teams: {}, tables: {}, matches: [], results: [], updated: null };
  const BB = D.bb || { teams: {}, matches: [], results: [], table: [] };
  const TZ = 'Asia/Ashgabat', CUR = 'TMT';
  const MIN_STAKE = 20, MAX_STAKE = 5000, MAX_SEL = 20, MAX_WIN = 500000, START_BAL = 1000, TIP_N = 10;
  const GROUPS = ['tr', 'ru', 'eu', 'nat', 'en', 'es', 'de', 'it', 'fr', 'nl', 'pt', 'ot'];
  const GBADGE = { tr: 'TR', ru: 'RU', eu: 'UEFA', nat: 'INT', en: 'ENG', es: 'ESP', de: 'GER', it: 'ITA', fr: 'FRA', nl: 'NED', pt: 'POR', ot: 'EUR' };

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('ahal_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ahal_' + k, JSON.stringify(v)); } catch (e) { /* ozel mod */ } }
  };

  // ---------- durum ----------
  let lang = LS.get('lang', 'tr');
  if (!I18N[lang]) lang = 'tr';
  let slip = LS.get('slip', []);          // [{m, k}]
  let stake = LS.get('stake', MIN_STAKE);
  // sunucu (Supabase) ayarliysa gercek uyelik; degilse demo (bu cihazda)
  const CFG = window.AHAL_CFG || {};
  const SB = CFG.supabaseUrl && CFG.supabaseKey && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;
  const EMAIL_DOMAIN = 'uye.thedentaldigest.org';     // kullanici adi -> giris kimligi (e-posta gonderilmez)
  let users = LS.get('users', {});
  let user = SB ? null : LS.get('user', null);
  if (!SB && user && !users[user]) user = null;
  let coupons = [], saved = [], balance = 0, authErr = { login: '', reg: '' }, profile = null, busy = false;
  const ukey = k => k + '_' + user;
  function loadUser() { if (SB) return; coupons = user ? LS.get(ukey('coupons'), []) : []; saved = user ? LS.get(ukey('saved'), []) : []; balance = user ? LS.get(ukey('balance'), START_BAL) : 0; }
  const saveUser = () => { if (!SB && user) { LS.set(ukey('coupons'), coupons); LS.set(ukey('saved'), saved); LS.set(ukey('balance'), balance); } };
  loadUser();
  const uinfo = () => (SB ? (profile ? { name: profile.display_name, phone: profile.phone, since: Date.parse(profile.created_at) } : null) : users[user]);
  const sbEmail = u => u.trim().toLowerCase() + '@' + EMAIL_DOMAIN;
  const mapCoupon = r => ({ id: r.id, ts: Date.parse(r.created_at), stake: +r.stake, odds: +r.odds, win: +r.win, status: r.status, sels: r.sels || [] });
  function sbErr(e) {
    const m = String((e && (e.message || e.error_description)) || e || '').toLowerCase();
    if (/already|registered|exists/.test(m)) return t('e_taken');
    if (/invalid login|invalid credentials|email not confirmed/.test(m)) return t(/confirm/.test(m) ? 'e_confirm' : 'e_login');
    if (/balance/.test(m)) return t('no_balance');
    if (/started/.test(m)) return t('started');
    if (/stake/.test(m)) return t('min_stake');
    if (/password/.test(m)) return t('e_pass');
    if (/fetch|network|failed/.test(m)) return t('e_net');
    return t('e_server');
  }
  async function sbLoad() {
    const { data } = await SB.auth.getSession();
    const ses = data && data.session;
    if (!ses) { user = null; profile = null; coupons = []; saved = []; balance = 0; return; }
    const [pr, cp, sv] = await Promise.all([
      SB.from('profiles').select('*').eq('id', ses.user.id).single(),
      SB.from('coupons').select('*').order('created_at', { ascending: false }).limit(100),
      SB.from('saved_coupons').select('*').order('created_at', { ascending: false }).limit(100)
    ]);
    if (pr.error || !pr.data) { user = null; profile = null; return; }
    profile = pr.data; user = profile.username; balance = +profile.balance;
    coupons = (cp.data || []).map(mapCoupon);
    saved = (sv.data || []).map(r => ({ id: r.id, ts: Date.parse(r.created_at), name: r.name, sels: r.sels || [] }));
    const srv = Array.isArray(profile.favs) ? profile.favs : [];
    const merged = new Set(srv.concat([...FAV]));
    if (merged.size !== srv.length) SB.from('profiles').update({ favs: [...merged] }).eq('id', profile.id).then(() => { });
    FAV = merged; LS.set('fav', [...FAV]);
  }
  const flt = { lg: 'all', day: 'all', q: '', alim: 24, lvall: false, blim: 3, rlim: 2 };
  let FAV = new Set(LS.get('fav', []));
  const isFavM = m => FAV.has(m.h) || FAV.has(m.a);
  const lgOk = m => flt.lg === 'all' || (flt.lg === 'fav' ? isFavM(m) : m.lg === flt.lg);
  let dtab = 'pred', ttab = 'all', slipErr = '', navDepth = 0;

  const $ = id => document.getElementById(id);
  const t = k => (I18N[lang][k] !== undefined ? I18N[lang][k] : (I18N.tr[k] !== undefined ? I18N.tr[k] : k));
  const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = p => Math.round(p * 100);
  const money = n => n.toLocaleString(lang === 'tr' ? 'tr-TR' : 'ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + CUR;

  // ---------- veri yardimcilari ----------
  Object.assign(D.teams, BB.teams);
  // mac detayi (form, karne, kadro, oyuncular) ayri lig dosyalarinda durur; mac acilinca yuklenir
  const ST0 = () => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cs: 0, btts: 0, o25: 0 });
  const detFill = m => { if (!m.pl) m.pl = { h: [], a: [] }; if (!m.sq) m.sq = { h: null, a: null }; if (!m.f) m.f = { h: [], a: [] }; if (!m.h2h) m.h2h = []; if (!m.st) m.st = { h: ST0(), a: ST0() }; };
  const MATCH = {}; D.matches.concat(BB.matches).forEach(m => { MATCH[m.id] = m; m._d = m.sport === 'bb' || !D.split || !!m.st; detFill(m); });
  const DET = {};
  function loadDet(m) {
    if (DET[m.lg]) return;
    DET[m.lg] = 1;
    const done = d => {
      D.matches.forEach(x => { if (x.lg === m.lg) { if (d && d[x.id]) Object.assign(x, d[x.id]); x._d = true; detFill(x); } });
      if (!d) { DET[m.lg] = 0; toast(t('e_net')); }
      if (/^#\/mac\//.test(location.hash)) { const y = scrollY; render(); scrollTo(0, y); }
    };
    fetch('data/detail/' + m.lg + '.json?u=' + encodeURIComponent(D.updated || '')).then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(done).catch(() => done(null));
  }
  const LG = {}; D.leagues.forEach(l => { LG[l.id] = l; });
  const RES = {}; D.results.concat(BB.results).forEach(r => { RES[r.id] = r; });
  const team = id => D.teams[id] || { n: '?', s: '?', l: '' };
  const tn = id => { const x = team(id); return x[lang] || x.n; };      // tam ad (dile gore)
  const ts = id => { const x = team(id); return x[lang] || x.s || x.n; }; // kisa ad
  const ln = id => { const l = LG[id]; return l ? (typeof l.n === 'string' ? l.n : (l.n[lang] || l.n.tr)) : (id === 'nba' ? 'NBA' : ''); };
  const future = m => new Date(m.d).getTime() > Date.now();
  const upcoming = () => D.matches.filter(future);
  const byDate = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0);

  const dayKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  const timeOf = d => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
  const keyParts = key => { const [y, m, d] = key.split('-').map(Number); return { d, m, wd: new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() }; };
  function relDay(key) {
    if (key === dayKey(Date.now())) return t('today');
    if (key === dayKey(Date.now() + 864e5)) return t('tomorrow');
    return '';
  }
  function dayLabel(key) {   // "Bugün · 14 Kasım Cumartesi"
    const p = keyParts(key), rel = relDay(key);
    return (rel ? rel + ' · ' : '') + p.d + ' ' + t('mo_l')[p.m - 1] + ' ' + t('wd_l')[p.wd];
  }
  const dayShort = key => { const p = keyParts(key); return p.d + ' ' + t('mo')[p.m - 1]; };
  const shortDate = d => { const k = dayKey(d).split('-'); return k[2] + '.' + k[1]; };

  function logo(id, cls) {
    const tm = team(id), ini = esc((tm.s || tm.n).replace(/[^A-Za-zÀ-ÿА-я]/g, '').slice(0, 2).toUpperCase());
    const c = 'logo' + (cls ? ' ' + cls : '');
    return tm.l
      ? `<img class="${c}" src="${esc(tm.l)}" alt="" loading="${cls === 'sm' ? 'eager' : 'lazy'}" decoding="async" data-ini="${ini}">`
      : `<span class="${c} ph">${ini}</span>`;
  }
  const pair = (h, a, hn, an) => `<span class="pair" title="${esc(hn)} – ${esc(an)}"><span class="ts">${logo(h, 'sm')}<span class="nm">${esc(hn)}</span></span><span class="sep">–</span><span class="ts">${logo(a, 'sm')}<span class="nm">${esc(an)}</span></span></span>`;
  const favMark = id => (FAV.has(id) ? '<i class="favm" aria-hidden="true">★</i>' : '');
  const favBtn = id => `<button type="button" class="fav ${FAV.has(id) ? 'on' : ''}" data-fav="${id}" aria-pressed="${FAV.has(id)}" title="${t(FAV.has(id) ? 'fav_rm' : 'fav_add')}" aria-label="${t(FAV.has(id) ? 'fav_rm' : 'fav_add')}">★</button>`;
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>';
  const shareBtn = (act, extra) => `<button type="button" class="shr" data-act="${act}" ${extra || ''} title="${t('share')}" aria-label="${t('share')}">${SHARE_ICON}</button>`;
  const badge = lg => `<span class="cc">${GBADGE[(LG[lg] || {}).g] || 'NBA'}</span>`;
  const srcName = s => (s === 'model' ? 'Analiz365' : s);
  const srcBadge = s => `<span class="srcb ${s === 'model' ? 'm' : ''}">${esc(srcName(s))}</span>`;

  const XK = ['hf', 'sk'];                       // devre ve skor kuponlari (ajanlarin ortak karari)
  const xLab = k => (/^HF/.test(k) ? t('xk_hf') + ': ' + k.slice(2) : /^IY/.test(k) ? t('xk_iy') + ': ' + k.slice(2) : /^2Y/.test(k) ? t('xk_y2') + ': ' + k.slice(2) : /^S\d/.test(k) ? t('xk_sk') + ': ' + k.slice(1) : null);
  function mkLabel(k, m, line) {
    if (xLab(k)) return xLab(k);
    const l = line != null ? line : (m || {}).line;
    if (k === 'BO' || k === 'BU') return t('bb_total') + ': ' + (k === 'BO' ? t('over') : t('under')) + ' ' + l;
    if (/^[OU]/.test(k)) return (k[0] === 'O' ? t('over') : t('under')) + ' ' + k.slice(1);
    if (k === 'KGV') return t('btts') + ': ' + t('yes');
    if (k === 'KGY') return t('btts') + ': ' + t('no');
    return (/^(1|X|2)$/.test(k) ? t('ms') : t('dc')) + ': ' + k;
  }
  function mkShort(k, m) {
    if (k === 'BO' || k === 'BU') return (k === 'BO' ? t('over') : t('under')) + ' ' + m.line;
    if (/^[OU]/.test(k)) return (k[0] === 'O' ? t('over') : t('under')) + ' ' + k.slice(1);
    if (k === 'KGV') return t('yes');
    if (k === 'KGY') return t('no');
    return k;
  }
  function wins(k, hs, as, line) {
    const tot = hs + as;
    if (/^S\d/.test(k)) { const [a, b] = k.slice(1).split('-').map(Number); return hs === a && as === b; }
    switch (k) {
      case '1': return hs > as; case 'X': return hs === as; case '2': return hs < as;
      case '1X': return hs >= as; case '12': return hs !== as; case 'X2': return hs <= as;
      case 'KGV': return hs > 0 && as > 0; case 'KGY': return !(hs > 0 && as > 0);
      case 'BO': return tot > line; case 'BU': return tot < line;
    }
    const n = parseFloat(k.slice(1));
    return k[0] === 'O' ? tot > n : tot < n;
  }
  function probOf(m, k) {
    const p = m.p;
    switch (k) {
      case '1': return p.p1; case 'X': return p.px; case '2': return p.p2;
      case '1X': return p.p1 + p.px; case '12': return p.p1 + p.p2; case 'X2': return p.px + p.p2;
      case 'O1.5': return p.o15; case 'U1.5': return 1 - p.o15; case 'O2.5': return p.o25; case 'U2.5': return 1 - p.o25;
      case 'O3.5': return p.o35; case 'U3.5': return 1 - p.o35; case 'KGV': return p.btts; case 'KGY': return 1 - p.btts;
    }
    return 0;
  }
  function tipOf(m) {
    if (m._tip) return m._tip;
    if (m.cons && m.o[m.cons.k]) {                 // Analiz365 tahmini: tahmini skorla tutarli, sunucuda hesaplanir
      const b = { k: m.cons.k, p: m.cons.p, o: m.o[m.cons.k] };
      b.stars = b.p >= .75 ? 5 : b.p >= .66 ? 4 : b.p >= .57 ? 3 : b.p >= .48 ? 2 : 1;
      return (m._tip = b);
    }
    if (m.sport === 'bb') {
      const k0 = m.p.p1 >= .5 ? '1' : '2', x = m.tip || { k: k0, p: Math.max(m.p.p1, m.p.p2), o: m.o[k0] };
      const b = { k: x.k, p: x.p, o: x.o || m.o[x.k] };
      b.stars = b.p >= .75 ? 5 : b.p >= .66 ? 4 : b.p >= .57 ? 3 : b.p >= .48 ? 2 : 1;
      return (m._tip = b);
    }
    const ks = ['1', 'X', '2', '1X', 'X2', 'O2.5', 'U2.5', 'KGV', 'KGY'];
    let c = ks.map(k => ({ k, p: probOf(m, k), o: m.o[k] })).filter(x => x.o);
    const fit = c.filter(x => wins(x.k, m.p.score[0], m.p.score[1]));   // oneri, tahmini skorla celismemeli
    if (fit.length) c = fit;
    const good = c.filter(x => x.o >= 1.3);
    if (good.length) c = good;
    c.sort((a, b) => b.p - a.p);
    const best = c[0];
    best.stars = best.p >= .75 ? 5 : best.p >= .66 ? 4 : best.p >= .57 ? 3 : best.p >= .48 ? 2 : 1;
    return (m._tip = best);
  }
  const stars = n => `<span class="stars" role="img" aria-label="${n}/5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;

  function ob(m, k, label) {
    const o = m.o[k];
    if (!o) return '<span class="ob off"><b>–</b></span>';
    const on = slip.some(s => s.m === m.id && s.k === k);
    return `<button type="button" class="ob${on ? ' on' : ''}" data-m="${m.id}" data-k="${k}" aria-pressed="${on}"><small>${esc(label || mkShort(k, m))}</small><b>${o.toFixed(2)}</b></button>`;
  }
  const RL = () => ({ W: t('th_w'), D: t('th_d'), L: t('th_l') });
  const formDots = arr => { const L = RL(); return arr.map(r => `<span class="f ${r}">${esc(L[r].slice(0, 1))}</span>`).join(''); };

  // ---------- serit (yatay kaydirilan ciplar) ----------
  const strip = (inner, cls) => `<div class="strip ${cls || ''}"><button type="button" class="sarrow l" data-scroll="-1" aria-label="‹">‹</button><div class="chips">${inner}</div><button type="button" class="sarrow r" data-scroll="1" aria-label="›">›</button></div>`;
  function syncStrips() {
    document.querySelectorAll('.strip').forEach(s => {
      const c = s.querySelector('.chips'), on = c.querySelector('.on');
      if (on && !s.dataset.ready) c.scrollLeft = Math.max(0, on.offsetLeft - c.offsetLeft - (c.clientWidth - on.offsetWidth) / 2);
      s.dataset.ready = '1';
      const upd = () => {
        s.querySelector('.sarrow.l').hidden = c.scrollLeft < 4;
        s.querySelector('.sarrow.r').hidden = c.scrollLeft + c.clientWidth > c.scrollWidth - 4;
      };
      c.onscroll = upd; upd();
    });
  }
  // gun seridi kaldirildi: sayfalar tum gunleri gun basliklariyla alt alta gosterir
  const dayStrip = () => '';
  function pickDay(list) {
    flt.day = 'all';
    return [...new Set(list.map(m => dayKey(m.d)))].sort();
  }

  // ---------- kabuk ----------
  const ICON = {
    bulletin: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 5h-5L8 10z"/>',
    basketball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18 M12 3v18 M5.6 5.6c3 3 3 9.8 0 12.8 M18.4 5.6c-3 3-3 9.8 0 12.8"/>',
    analysis: '<path d="M4 19V5 M4 19h16 M8 15l3-4 3 2 4-6"/>',
    tables: '<path d="M5 4h14v4a7 7 0 0 1-14 0z M9 20h6 M12 15v5"/>',
    results: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    mycoupons: '<path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2z M9 9h6 M9 13h6"/>'
  };
  const NAV = [['bulletin', '#/'], ['basketball', '#/basketbol'], ['analysis', '#/analiz'], ['tables', '#/puan'], ['results', '#/sonuclar'], ['mycoupons', '#/kuponlarim']];

  function renderChrome() {
    const h = location.hash || '#/';
    const bbm = /^#\/mac\/b/.test(h);
    const act = k => (k === 'bulletin' ? (h === '#/' || h === '#' || (h.startsWith('#/mac') && !bbm)) : (h.startsWith(NAV.find(n => n[0] === k)[1]) || (k === 'basketball' && bbm)));
    $('nav').innerHTML = NAV.map(([k, u]) => `<a href="${u}" class="${act(k) ? 'on' : ''}" ${act(k) ? 'aria-current="page"' : ''}>${t(k)}${k === 'bulletin' || k === 'basketball' ? `<span class="lvn" data-sport="${k === 'bulletin' ? 'fb' : 'bb'}" hidden></span>` : ''}</a>`).join('')
      + `<a href="#/mollamyrat" class="mm ${h.startsWith('#/mollamyrat') ? 'on' : ''}">★ ${t('tipc_title')}</a>`;
    $('tabs').innerHTML = NAV.map(([k, u]) => `<a href="${u}" class="${act(k) ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg><span>${t(k + '_s') !== k + '_s' ? t(k + '_s') : t(k)}</span></a>`).join('')
      + `<a href="#/mollamyrat" class="mm ${h.startsWith('#/mollamyrat') ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg><span>${t('molla_s')}</span></a>`;
    $('bal').innerHTML = user
      ? `<span class="av">${esc(user.slice(0, 1).toUpperCase())}</span><span class="bt"><small>${esc(user)}</small><b>${money(balance)}</b></span>`
      : `<span class="av">👤</span><span class="bt"><b class="lg lg-l">${t('login_or')}</b><b class="lg lg-s">${t('login')}</b></span>`;
    $('bal').setAttribute('aria-label', t('profile'));
    const up = D.updated ? `${shortDate(D.updated)}.${dayKey(D.updated).slice(0, 4)} ${timeOf(D.updated)}` : '-';
    $('foot').innerHTML = `
      <div class="fl"><span class="age">18+</span><span>${t('foot_18')}</span></div>
      <div class="fl"><span>${t('foot_disc')}</span></div>
      <div class="fl"><a href="#/kurallar">${t('rules')}</a><span>${t('updated')}: ${up}</span><span>${t('tznote')}</span><span>© ${new Date().getFullYear()} Analiz365</span></div>`;
    document.documentElement.lang = lang;
    $('lang').value = lang;
    $('slip').setAttribute('aria-label', t('coupon'));
  }

  function renderSide() {
    const up = upcoming();
    const cnt = {}; up.forEach(m => { cnt[m.lg] = (cnt[m.lg] || 0) + 1; });
    let html = '<div class="card">';
    GROUPS.forEach(g => {
      const ls = D.leagues.filter(l => l.g === g && cnt[l.id]);
      if (!ls.length) return;
      html += `<h3>${t('g_' + g)}</h3>` + ls.map(l => `<button class="lgbtn ${flt.lg === l.id ? 'on' : ''}" data-lg="${l.id}">${badge(l.id)}<span class="ln">${esc(ln(l.id))}</span><span class="cnt">${cnt[l.id]}</span></button>`).join('');
    });
    $('side').innerHTML = html + '</div>';
  }
  function lgChips(ids, always) {
    return strip((FAV.size ? `<button class="chip favc ${flt.lg === 'fav' ? 'on' : ''}" data-lg="fav">★ ${t('fav')}</button>` : '') + D.leagues.filter(l => ids.has(l.id)).map(l => `<button class="chip ${flt.lg === l.id ? 'on' : ''}" data-lg="${l.id}">${esc(ln(l.id))}</button>`).join(''), always ? '' : 'lgchips');
  }

  // ---------- MollaMyrat'in kuponu (veri betigi uretir, haftalik takip edilir) ----------
  const MOLLA = D.molla || { today: '', coupons: [] };
  const pkName = (pk, side) => (D.teams[pk[side]] ? ts(pk[side]) : pk[side + 'n']);
  // sonuc: veri betiginin isledigi ya da canli akistan gelen mac sonucu
  function pkOk(pk, score) {
    if (pk.ok !== undefined) return pk.ok;
    if (/^(IY|2Y|HF)/.test(pk.k || '')) return null;          // devre sonucu canli akistan bilinmez
    const r = RES[pk.id];
    if (!r) return null;
    return score ? (r.hs === pk.sc[0] && r.as === pk.sc[1]) : wins(pk.k, r.hs, r.as);
  }
  const pkRes = pk => pk.res || (RES[pk.id] ? [RES[pk.id].hs, RES[pk.id].as] : null);
  const pkIcon = (pk, score) => { const ok = pkOk(pk, score); if (ok === null && pk.res && pk.ok === null) return `<span class="mst wait" title="${esc(t('xk_void'))}">–</span>`; return ok === true ? '<span class="mst ok" title="✓">✓</span>' : ok === false ? '<span class="mst no" title="✗">✗</span>' : '<span class="mst wait" title="…">•</span>'; };
  const cDay = c => c.date.slice(0, 10);               // ayni gun ikinci kupon: 2026-11-17b
  const cRange = c => (c.nx ? t('m_next_sub') : c.until && c.until !== cDay(c) ? dayShort(cDay(c)) + ' – ' + dayShort(c.until) : dayLabel(cDay(c)));
  // guncel banko kupon kaybettiyse yerine hemen yedek kupon (veri betigi bir sonraki guncellemede resmilestirir)
  const nextC = () => {
    const c0 = MOLLA.coupons[0], nx = MOLLA.next;
    if (!c0 || !nx || !(nx.picks || []).length || !c0.picks.some(pk => pkOk(pk) === false)) return null;
    if (!nx.picks.every(pk => MATCH[pk.id] && future(MATCH[pk.id]))) return null;
    return { date: 'next', nx: 1, picks: nx.picks };
  };
  const cByDate = d => (d === 'next' ? nextC() : MOLLA.coupons.find(x => x.date === d));
  const pkLive = pk => MATCH[pk.id] && future(MATCH[pk.id]) && MATCH[pk.id].o[pk.k];
  function weekRange(off) {
    const k = dayKey(Date.now()), p = keyParts(k), [y, m, d] = k.split('-').map(Number);
    const base = Date.UTC(y, m - 1, d, 12) - ((p.wd + 6) % 7) * 864e5 + off * 7 * 864e5;
    const f = ms => new Date(ms).toISOString().slice(0, 10);
    return [f(base), f(base + 6 * 864e5)];
  }
  function weekStats(off, kind, own) {
    const [a, b] = weekRange(off), cs = MOLLA.coupons.filter(c => cDay(c) >= a && cDay(c) <= b);
    const r = { a, b, cs, ok: 0, no: 0, wait: 0, sok: 0, sno: 0, swait: 0 };
    cs.forEach(c => {
      kPicks(c, kind, own).forEach(x => { const ok = pkOk(x); if (ok === true) r.ok++; else if (ok === false) r.no++; else r.wait++; });
      (c.scores || []).forEach(x => { const ok = pkOk(x, true); if (ok === true) r.sok++; else if (ok === false) r.sno++; else r.swait++; });
    });
    return r;
  }
  // ---- ek kuponlar: yuksek oranli (toplam oran 20+) ve sistem kuponu ----
  const hiOf = c => (c && c.hi && c.hi.picks && c.hi.picks.length ? c.hi : null);
  const sysOf = c => (c && c.sys && c.sys.picks && c.sys.picks.length ? c.sys : null);
  const prodO = pk => pk.reduce((p, x) => p * x.o, 1);
  function combos(arr, k) {
    const out = [], go = (i, cur) => { if (cur.length === k) return out.push(cur); for (let j = i; j < arr.length; j++) go(j + 1, cur.concat([arr[j]])); };
    go(0, []); return out;
  }
  function sysInfo(s) {
    const N = s.picks.length, k = s.k, cs = combos(s.picks, k), per = Math.round(MIN_STAKE / cs.length * 100) / 100;
    const ok = s.picks.filter(x => pkOk(x) === true).length, no = s.picks.filter(x => pkOk(x) === false).length;
    const wcs = cs.filter(c => c.every(x => pkOk(x) === true));
    return { N, k, cols: cs.length, per, ok, no, wcols: wcs.length, max: cs.reduce((a, c) => a + prodO(c) * per, 0), win: wcs.reduce((a, c) => a + prodO(c) * per, 0),
      st: no > N - k ? 'lost' : ok >= k ? 'won' : 'pending' };
  }
  // own: 'all' (ortak kupon) ya da bir analizcinin kimligi (kendi kuponu)
  const kPicks = (c, kind, own) => {
    if (XK.includes(kind)) return own && own !== 'all' ? [] : ((c || {})[kind] || {}).picks || [];
    if (own && own !== 'all') { const o = (c.ac || {})[own] || {}; return (kind === 'sys' ? (o.sys || {}).picks : o[kind === 'hi' ? 'hi' : 'main']) || []; }
    return (kind === 'hi' ? (hiOf(c) || {}).picks : kind === 'sys' ? (sysOf(c) || {}).picks : c.picks) || [];
  };
  const sysK = (c, own) => (own && own !== 'all' ? (((c.ac || {})[own] || {}).sys || {}).k : (c.sys || {}).k) || 3;
  function molRow(pk, score) {
    const lg = LG[pk.lg] ? esc(ln(pk.lg)) : '';
    const tag = MATCH[pk.id] ? 'a' : 'div', href = MATCH[pk.id] ? ` href="#/mac/${pk.id}"` : '';
    const right = score
      ? `<span class="to num">${pk.sc[0]} - ${pk.sc[1]}<small>${pct(pk.sp)}%</small></span>`
      : `<span class="to num">${pk.o.toFixed(2)}</span>`;
    const sub = score ? `${shortDate(pk.d)} ${timeOf(pk.d)} · ${lg}` : `${shortDate(pk.d)} ${timeOf(pk.d)} · ${esc(mkLabel(pk.k))} · ${t('m_pred')} ${pk.sc[0]}-${pk.sc[1]}`;
    const res = pkRes(pk);
    return `<${tag} class="tipc-r"${href}><span class="tt">${pair(pk.h, pk.a, pkName(pk, 'h'), pkName(pk, 'a'))}<small>${sub}${res ? ' · <b class="res">' + res[0] + '-' + res[1] + '</b>' : `<span data-lv="${pk.id}" data-lk="${esc(pk.k)}"></span>`}</small>${score ? '' : agChips(pk)}</span>${right}${pkIcon(pk, score)}</${tag}>`;
  }
  function tipCoupon() {
    const c = nextC() || MOLLA.coupons[0];
    if (!c) return '';
    const tot = c.picks.reduce((p, x) => p * x.o, 1), w = weekStats(0);
    return `<div class="card tipc"><div class="tipc-h">${shareBtn('share-molla', `data-cdate="${c.date}"`)}<b>${c.nx ? '🔄 ' + t('m_next_title') : '★ ' + t('tipc_title')}</b><small>${fmt(t('tipc_sub'), { n: c.picks.length })} · ${cRange(c)}</small></div>
      ${c.picks.map(x => molRow(x)).join('')}
      <div class="tipc-f"><div class="sum"><span>${t('total_odds')}</span><b class="num">${tot.toFixed(2)}</b></div>
      <div class="sum"><span>${fmt(t('tipc_min'), { s: MIN_STAKE })}</span><b class="num" style="color:var(--pri)">${money(Math.min(MIN_STAKE * tot, MAX_WIN))}</b></div>
      <div class="sum"><span>${t('m_week')}</span><b class="num"><span style="color:var(--pri)">${w.ok} ✓</span> · <span style="color:var(--red)">${w.no} ✗</span> · ${w.wait} •</b></div>
      ${c.picks.some(pkLive) ? `<button class="btn" data-act="tipadd" data-cdate="${c.date}">${t('tipc_add')}</button>` : ''}
      ${hiOf(c) ? `<button type="button" class="tipx" data-mk="hi" data-mgo="1"><span>🔥 ${t('m_k_hi')} · ${hiOf(c).picks.length} ${t('selections')}</span><b class="num">${prodO(hiOf(c).picks).toFixed(2)}</b></button>` : ''}
      ${sysOf(c) ? `<button type="button" class="tipx" data-mk="sys" data-mgo="1"><span>🎯 ${t('m_k_sys')}</span><b class="num">${sysOf(c).k}/${sysOf(c).picks.length}</b></button>` : ''}
      ${[['hf', '🧩'], ['sk', '🔢']].map(([x, ic]) => { const pk = kPicks(c, x); return pk.length ? `<button type="button" class="tipx" data-mk="main" data-mgo="1"><span>${ic} ${t('m_k_' + x)} · ${pk.length} ${t('selections')}</span><b class="num">${prodO(pk).toFixed(2)}</b></button>` : ''; }).join('')}
      <a class="btn ghost" href="#/mollamyrat">${t('m_track')} →</a></div></div>`;
  }
  // ---------- Analiz Kuponlari: ortak kupon + bes analizcinin kendi kuponlari (yalnizca kuponlar) ----------
  const cpnState = pk => { const ok = pk.filter(x => pkOk(x) === true).length, no = pk.filter(x => pkOk(x) === false).length; return { ok, no, st: no ? 'lost' : ok === pk.length ? 'won' : 'pending' }; };
  const agAv = (a, bb, ic) => (bb ? `<i class="av emo">${ic}</i>` : a === 'all' ? '<i class="av a-all">★</i>' : `<i class="av a-${a}">${esc(t('ag_' + a).slice(0, 1))}</i>`);
  function akRow(pk, joint) {
    const res = pkRes(pk), tag = MATCH[pk.id] ? 'a' : 'div';
    return `<${tag} class="akr"${MATCH[pk.id] ? ` href="#/mac/${pk.id}"` : ''}><span class="akt">${pair(pk.h, pk.a, pkName(pk, 'h'), pkName(pk, 'a'))}<small><b>${esc(mkLabel(pk.k))}</b> · ${shortDate(pk.d)} ${timeOf(pk.d)}${pk.hr ? ' · ' + t(/^(IY|HF)/.test(pk.k) ? 'xk_iy_s' : 'xk_y2_s') + ' <b class="res">' + pk.hr[0] + '-' + pk.hr[1] + '</b>' : ''}${res ? ' · <b class="res">' + res[0] + '-' + res[1] + '</b>' : `<span data-lv="${pk.id}" data-lk="${esc(pk.k)}"></span>`}${pk.os === 'model' && /^(IY|2Y|HF|S\d)/.test(pk.k) ? ' · <span class="srcb m">Analiz365</span>' : ''}</small></span>${joint && pk.v != null ? `<span class="akv num" title="${esc(fmt(t('ag_votes'), { v: pk.v }))}">${pk.v}/5</span>` : ''}<span class="ako num">${pk.o.toFixed(2)}</span>${pkIcon(pk)}</${tag}>`;
  }
  function akCard(c, mk, own, ttl) {
    const pk = kPicks(c, mk, own), joint = own === 'all', r = joint ? null : (D.agacc || {})[own];
    const who = `${agAv(own)}<div class="akw"><b>${joint ? ttl || t('ac_joint') : t('ag_' + own)}</b><small>${t(joint ? 'ak_joint_s' : 'ag_' + own + '_r')}${r && r[0] ? ` · <span class="num">${pct(r[1] / r[0])}%</span>` : ''}</small></div>`;
    if (!pk.length) return `<div class="card akc none"><div class="akh">${who}</div><div class="akn">${t('ak_none')}</div></div>`;
    const at = `data-cdate="${c.date}" data-ck="${mk}" data-own="${own}"`, tot = prodO(pk), sy = mk === 'sys' ? sysInfo({ k: sysK(c, own), picks: pk }) : null;
    const st = sy ? sy.st : cpnState(pk).st;
    const foot = sy
      ? `<div><small>${sy.k}/${sy.N} · ${sy.cols} ${t('sys_cols')}</small><b class="num">${money(MIN_STAKE)}</b></div><div><small>${t(sy.ok + sy.no ? 'sys_wcols' : 'max_win')}</small><b class="num win">${sy.ok + sy.no ? sy.wcols + '/' + sy.cols + ' · ' + money(Math.min(sy.win, MAX_WIN)) : money(Math.min(sy.max, MAX_WIN))}</b></div>`
      : `<div><small>${t('total_odds')}</small><b class="num od">${tot.toFixed(2)}</b></div><div><small>${fmt(t('tipc_min'), { s: MIN_STAKE })}</small><b class="num win">${money(Math.min(MIN_STAKE * tot, MAX_WIN))}</b></div>`;
    return `<div class="card akc ${st}${joint ? ' joint' : ''}"><div class="akh">${who}<span class="st ${st}">${t(st)}</span>${shareBtn('share-molla', at)}</div>
      ${pk.map(x => akRow(x, joint)).join('')}<div class="akf">${foot}</div>${!sy && pk.some(pkLive) ? `<button class="btn akb" data-act="tipadd" ${at}>${t('tipc_add')}</button>` : ''}</div>`;
  }
  function viewMolla() {
    const per = MOLLA.coupons.filter(x => x.ac), c = per.find(x => x.date === flt.mp) || per[0] || MOLLA.coupons[0];
    if (!c) return `<div class="pagehead"><h1>${t('tipc_title')}</h1></div><div class="card empty">${t('m_none')}</div>`;
    const mk = ['main', 'hi', 'sys'].includes(flt.mk) ? flt.mk : 'main', owners = ['all'].concat(AGENTS.map(x => x[0]));
    const TAB = [['main', '★', 'ak_h_main'], ['hi', '🔥', 'ak_h_hi'], ['sys', '🎯', 'ak_h_sys']];
    const xs = mk === 'main' ? XK.filter(x => kPicks(c, x).length) : [];
    return `<div class="pagehead"><h1>${t('tipc_title')}</h1><small class="num">${cRange(c)}</small></div>
      <div class="aktabs" role="tablist">${TAB.map(([k, ic, h]) => `<button role="tab" aria-selected="${mk === k}" class="${mk === k ? 'on' : ''}" data-mk="${k}"><i>${ic}</i><b>${t(h)}</b></button>`).join('')}</div>
      ${per.length > 1 ? `<div class="chips akper">${per.map((x, i) => { const dup = per.slice(0, i).some(y => cRange(y) === cRange(x));
        return `<button class="chip ${x === c ? 'on' : ''}" data-mp="${x.date}">${cRange(x)}${dup ? ` · ${t('ak_prev')}` : ''}</button>`; }).join('')}</div>` : ''}
      ${mk === 'main' && c === MOLLA.coupons[0] && nextC() ? `<div class="akg aknx">${akCard(nextC(), 'main', 'all', '🔄 ' + t('m_next_title'))}</div><p class="note akxn">${t('m_next_note')}</p>` : ''}
      <div class="akg">${owners.map(o => akCard(c, mk, o)).join('')}</div>
      ${xs.length ? `<h2 class="dayhead akxh">🧩 ${t('xk_title')}</h2><p class="note akxn">${t('xk_note')}</p>
      <div class="akg">${xs.map(x => akCard(c, x, 'all', t('m_k_' + x))).join('')}</div>` : ''}`;
  }

  // ---------- favori karti, bildirimler ----------
  function favCard() {
    const ids = [...FAV].filter(id => D.teams[id]);
    return `<div class="card sec"><h2>★ ${t('fav_title')}</h2>${ids.length ? `<div class="favl">${ids.map(id => `<span class="favi">${logo(id, 'sm')}<span>${esc(tn(id))}</span><button type="button" data-fav="${id}" aria-label="${t('fav_rm')}" title="${t('fav_rm')}">×</button></span>`).join('')}</div>` : `<p class="mut" style="margin:0">${t('fav_none')}</p>`}</div>`;
  }
  const notifSup = () => 'Notification' in window;
  const notifOn = () => LS.get('notif', false) && notifSup() && Notification.permission === 'granted';
  function notifCard() {
    const sup = notifSup(), on = notifOn(), denied = sup && Notification.permission === 'denied';
    return `<div class="card sec"><h2>🔔 ${t('notif_title')}</h2><p class="mut" style="margin:0 0 10px">${t('notif_desc')}</p>
      ${!sup ? `<p class="note">${t('notif_unsup')}</p>` : denied ? `<p class="note">${t('notif_denied')}</p>` : `<button type="button" class="btn ${on ? 'ghost' : ''}" data-act="notif">${on ? t('notif_off') : t('notif_on')}</button>`}</div>`;
  }
  function notify(title, body, tag) {
    if (!document.hidden) toast(title + ' · ' + body);
    if (!notifOn()) return;
    const opt = { body, icon: 'img/icon.svg', badge: 'img/icon.svg', tag: tag || title, renotify: true };
    const plain = () => { try { new Notification(title, opt); } catch (e) { /* desteklenmiyor */ } };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(r => r.showNotification(title, opt)).catch(plain);
    else plain();
  }
  async function toggleNotif() {
    if (notifOn()) { LS.set('notif', false); return render(); }
    if (!notifSup()) return;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') { LS.set('notif', true); notify('🔔 ' + t('notif_enabled'), 'Analiz365', 'notif'); }
    render();
  }

  // ---------- kuponu paylas: resim + baglanti ----------
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function fitText(g, str, w) { if (g.measureText(str).width <= w) return str; while (str.length > 1 && g.measureText(str + '…').width > w) str = str.slice(0, -1); return str + '…'; }
  function couponCanvas(title, sub, rows, foot) {
    const W = 1080, RH = 112, top = 236, H = top + rows.length * RH + 300;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), F = (w, z) => `${w} ${z}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, W, 200); gr.addColorStop(0, '#143326'); gr.addColorStop(1, '#121b2e');
    g.fillStyle = gr; g.fillRect(0, 0, W, 200);
    g.fillStyle = '#12c48b'; rrect(g, 60, 52, 96, 96, 24); g.fill();
    g.fillStyle = '#fff'; g.font = F(800, 64); g.textAlign = 'center'; g.fillText('A', 108, 124);
    g.textAlign = 'left'; g.font = F(800, 56); g.fillStyle = '#e9eefb'; g.fillText('Analiz', 182, 108);
    const aw = g.measureText('Analiz').width; g.fillStyle = '#f5b301'; g.fillText('365', 182 + aw, 108);
    g.font = F(700, 32); g.fillStyle = '#e9eefb'; g.fillText(fitText(g, title, W - 250), 182, 154);
    g.font = F(500, 26); g.fillStyle = '#8c9bbb'; g.fillText(fitText(g, sub, W - 250), 182, 188);
    rows.forEach((r, i) => {
      const y = top + i * RH, right = W - 70 - (r.mark ? 64 : 0);
      g.fillStyle = i % 2 ? '#121b2e' : '#18233b'; rrect(g, 40, y, W - 80, RH - 14, 20); g.fill();
      g.font = F(700, 34); g.fillStyle = '#e9eefb'; g.fillText(fitText(g, r.teams, right - 230), 72, y + 46);
      g.font = F(500, 26); g.fillStyle = '#8c9bbb'; g.fillText(fitText(g, r.sub, right - 230), 72, y + 82);
      g.font = F(800, 42); g.fillStyle = '#f5b301'; g.textAlign = 'right'; g.fillText(r.o, right, y + 62); g.textAlign = 'left';
      if (r.mark) {
        g.fillStyle = r.mark === 'ok' ? '#0d3b2c' : r.mark === 'no' ? '#3f1717' : '#1f2d4a';
        g.beginPath(); g.arc(W - 92, y + 49, 24, 0, 7); g.fill();
        g.fillStyle = r.mark === 'ok' ? '#12c48b' : r.mark === 'no' ? '#ff8a80' : '#8c9bbb';
        g.font = F(800, 28); g.textAlign = 'center'; g.fillText(r.mark === 'ok' ? '✓' : r.mark === 'no' ? '✗' : '•', W - 92, y + 59); g.textAlign = 'left';
      }
    });
    let y = top + rows.length * RH + 30;
    g.fillStyle = '#121b2e'; rrect(g, 40, y, W - 80, 180, 24); g.fill();
    const line = (label, val, yy, big) => { g.font = F(500, 30); g.fillStyle = '#8c9bbb'; g.fillText(label, 76, yy); g.font = F(800, big ? 46 : 34); g.fillStyle = big ? '#12c48b' : '#e9eefb'; g.textAlign = 'right'; g.fillText(val, W - 76, yy); g.textAlign = 'left'; };
    line(t('total_odds'), foot.tot, y + 54);
    if (foot.stake) line(t('stake'), foot.stake, y + 104);
    line(t('max_win'), foot.win, y + 156, true);
    g.font = F(600, 26); g.fillStyle = '#8c9bbb'; g.fillText('thedentaldigest.org', 60, H - 34);
    g.textAlign = 'right'; g.fillStyle = '#ef5350'; g.fillText('18+', W - 60, H - 34); g.textAlign = 'left';
    return cv;
  }
  async function shareCoupon(title, sub, rows, foot, sels) {
    const live = (sels || []).filter(x => MATCH[x.m] && future(MATCH[x.m]));
    const url = location.origin + location.pathname + (live.length ? '#/k/' + encodeURIComponent(live.map(x => x.m + ':' + x.k).join(',')) : '');
    const cv = couponCanvas(title, sub, rows, foot);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const file = new File([blob], 'analiz365-kupon.png', { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Analiz365', text: title + '\n' + url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    try { await navigator.clipboard.writeText(url); toast(t('share_done') + ' · ' + t('link_copied')); } catch (e) { toast(t('share_done')); }
  }
  const mark = ok => (ok === true ? 'ok' : ok === false ? 'no' : 'wait');
  function shareSlip() {
    if (!slip.length) return;
    const st = parseFloat(stake) || MIN_STAKE, tot = totalOdds();
    shareCoupon(t('coupon') + ' · ' + slip.length + ' ' + t('selections'), dayLabel(dayKey(Date.now())),
      slip.map(x => { const m = MATCH[x.m]; return { teams: tn(m.h) + ' – ' + tn(m.a), sub: mkLabel(x.k, m) + ' · ' + shortDate(m.d) + ' ' + timeOf(m.d), o: m.o[x.k].toFixed(2) }; }),
      { tot: tot.toFixed(2), stake: money(st), win: money(Math.min(st * tot, MAX_WIN)) }, slip);
  }
  function shareMolla(date, kind, own) {
    const c0 = cByDate(date) || MOLLA.coupons[0]; if (!c0) return;
    const mk = ['hi', 'sys'].concat(XK).includes(kind) ? kind : 'main', pk = kPicks(c0, mk, own); if (!pk.length) return;
    const who = own && own !== 'all' ? t('ag_' + own) : t('ac_joint');
    const rows = x => ({ teams: pkName(x, 'h') + ' – ' + pkName(x, 'a'), sub: mkLabel(x.k) + ' · ' + shortDate(x.d) + ' ' + timeOf(x.d), o: x.o.toFixed(2), mark: mark(pkOk(x)) });
    const sels = pk.map(x => ({ m: x.id, k: x.k })), head = '★ ' + t('tipc_title') + ' · ' + who;
    if (mk === 'sys') {
      const S = sysInfo({ k: sysK(c0, own), picks: pk });
      return shareCoupon(head + ' · ' + t('m_k_sys') + ' ' + S.k + '/' + S.N, cRange(c0) + ' · ' + fmt(t('sys_rule'), { k: S.k, n: S.N }), pk.map(rows),
        { tot: S.k + '/' + S.N + ' · ' + S.cols + ' ' + t('sys_cols'), stake: money(MIN_STAKE), win: money(Math.min(S.max, MAX_WIN)) }, sels);
    }
    const tot = prodO(pk);
    shareCoupon(head + ' · ' + t('m_k_' + mk), cRange(c0) + ' · ' + pk.length + ' ' + t('selections'), pk.map(rows),
      { tot: tot.toFixed(2), stake: money(MIN_STAKE), win: money(Math.min(MIN_STAKE * tot, MAX_WIN)) }, sels);
  }
  function shareUserCoupon(cid) {
    const c = coupons.find(x => x.id === cid); if (!c) return;
    const nm = (x, side) => { const id = x[side + 'i']; return id && D.teams[id] ? tn(id) : x[side]; };
    shareCoupon(t('coupon_no') + ' ' + c.id, t(c.status) + ' · ' + shortDate(c.ts) + ' ' + timeOf(c.ts),
      c.sels.map(x => ({ teams: nm(x, 'h') + ' – ' + nm(x, 'a'), sub: mkLabel(x.k, null, x.ln) + ' · ' + shortDate(x.d) + ' ' + timeOf(x.d), o: x.o.toFixed(2), mark: mark(x.ok) })),
      { tot: c.odds.toFixed(2), stake: money(c.stake), win: money(c.win) }, c.sels.map(x => ({ m: x.m, k: x.k })));
  }
  function loadShared(code) {
    const want = code.split(',').map(x => { const i = x.lastIndexOf(':'); return { m: x.slice(0, i), k: x.slice(i + 1) }; });
    const ok = want.filter(x => MATCH[x.m] && future(MATCH[x.m]) && MATCH[x.m].o[x.k]).slice(0, MAX_SEL);
    if (!ok.length) { toast(t('share_none')); return; }
    slip = ok; LS.set('slip', slip); slipErr = '';
    toast(fmt(t('share_loaded'), { n: ok.length }));
    if (matchMedia('(max-width:860px)').matches) setTimeout(() => document.body.classList.add('slipopen'), 300);
  }

  // ---------- MollaMyrat: analiz ajanlari (veri betigi hesaplar; kuponlar ajanlarin ortak karariyla kurulur) ----------
  const AGENTS = [['fn', '🧮'], ['st', '📊'], ['mk', '💹'], ['fm', '📈'], ['vr', '⚖️']];
  const BB_AGENTS = [['pw', '🏀'], ['mk', '💹'], ['fm', '📈'], ['rs', '🛌'], ['in', '🩺']];
  const agList = bb => (bb ? BB_AGENTS : AGENTS);
  const agName = (a, bb) => t((bb ? 'agb_' : 'ag_') + a);
  const agVal = (a, v) => (a === 'vr' ? (v >= 0 ? '+' : '') + Math.round(v * 100) + '%' : pct(v) + '%');
  function agChips(pk, bb) {
    if (!pk || !pk.ag) return '';
    return `<span class="agv">${agList(bb).map(([a, ic], i) => { const x = pk.ag[i];
      return `<i class="${!x ? 'na' : x[1] ? 'y' : 'n'}" title="${esc(agName(a, bb))}: ${x ? agVal(a, x[0]) : t('ag_na')}">${ic}</i>`; }).join('')}<b>${fmt(t('ag_votes'), { v: pk.v })}</b></span>`;
  }
  function agentSection(c, mk) {
    const picks = kPicks(c, mk), P = c.panel || {}, rp = P.rep || {};
    let html = `<h2 class="dayhead">🤖 ${t('ag_title')} · ${t('m_t_' + mk)} <small class="mut">${fmt(t('ag_sub'), { n: P.n || 0 })}</small></h2>`;
    if (picks.length && picks[0].ag) {
      html += `<div class="card sec agm" style="margin-top:0"><h2>🤝 ${t('ag_cons')}</h2><p class="note" style="margin:0 0 10px">${t('ag_r_' + mk)}</p>
        <div class="tblwrap"><table class="tbl agt"><thead><tr><th class="tn">${t('ag_match')}</th>${AGENTS.map(([a, ic]) => `<th title="${esc(t('ag_' + a))}">${ic}</th>`).join('')}<th>${t('ag_ok')}</th></tr></thead><tbody>
        ${picks.map(pk => `<tr><td class="tn"><span class="agn"><b>${esc(pkName(pk, 'h'))} – ${esc(pkName(pk, 'a'))}</b><small class="mut">${esc(mkLabel(pk.k))} · ${pk.o.toFixed(2)}</small></span></td>${AGENTS.map(([a], i) => { const x = (pk.ag || [])[i];
          return `<td class="${!x ? 'na' : x[1] ? 'y' : 'n'}">${x ? agVal(a, x[0]) : '–'}</td>`; }).join('')}<td class="pts">${pk.v}/5</td></tr>`).join('')}
        </tbody></table></div>
        <div class="agleg">${AGENTS.map(([a, ic]) => `<span>${ic} ${t('ag_' + a)}</span>`).join('')}</div>
        <p class="note" style="margin:8px 0 0">${t('ag_cons_d')}</p></div>`;
    }
    html += `<h2 class="dayhead">${t('ag_reports')} <small class="mut">${t('ag_rep_d')}</small></h2>`;
    AGENTS.forEach(([a, ic]) => {
      const rows = rp[a] || [];
      html += `<details class="aic"><summary>${ic} ${t('ag_' + a)}<small>${rows.length} ${t('selections')}</small></summary>
        <div class="aib"><p class="note">${t('ag_' + a + '_d')}</p>${rows.length ? rows.map(r => { const tag = MATCH[r.id] ? 'a' : 'div';
          return `<${tag} class="tipc-r"${MATCH[r.id] ? ` href="#/mac/${r.id}"` : ''}><span class="tt">${pair(r.h, r.a, pkName(r, 'h'), pkName(r, 'a'))}<small><b>${esc(mkLabel(r.k))}</b> · ${shortDate(r.d)} ${timeOf(r.d)} · ${a === 'vr' ? t('ag_ev') : t('confidence')} ${agVal(a, r.p)}</small></span><span class="to num">${r.o.toFixed(2)}</span></${tag}>`; }).join('')
          : `<div class="empty">${t('ag_na')}</div>`}</div></details>`;
    });
    return html + `<p class="note" style="margin:2px 2px 12px">${t('ag_about')}</p>`;
  }
  function agentMatchBlock(m) {
    const bb = m.sport === 'bb', rows = agList(bb).filter(([a]) => m.ag[a] && m.o[m.ag[a][0]]);
    if (!rows.length) return '';
    const n = {}; rows.forEach(([a]) => { n[m.ag[a][0]] = (n[m.ag[a][0]] || 0) + 1; });
    const top = Object.keys(n).sort((x, y) => n[y] - n[x])[0], x = m.agx;
    const rd = v => (v == null ? '–' : v === 0 ? t('agb_b2b') : fmt(t('agb_rest_n'), { n: v }));
    return `<div class="card sec"><h2>🤖 ${t('ag_title')} <small class="mut">${t('ag_here')}</small></h2>
      <div class="aimgrid">${rows.map(([a, ic]) => `<div class="aim"><div class="ain">${agAv(a, bb, ic)} ${agName(a, bb)}</div>${ob(m, m.ag[a][0], mkLabel(m.ag[a][0], m))}<small class="mut">${a === 'vr' ? t('ag_ev') : t('confidence')} ${agVal(a, m.ag[a][1])}</small></div>`).join('')}</div>
      ${bb && m.tip && m.tip.ag ? `<p class="note" style="margin:10px 0 0">🤝 ${t('ag_cons')}: <b style="color:var(--tx)">${esc(mkLabel(m.tip.k, m))}</b> · ${fmt(t('ag_votes'), { v: m.tip.v })} · ${t('confidence')} ${pct(m.tip.p)}%</p>`
        : n[top] >= 2 ? `<p class="note" style="margin:10px 0 0">🤝 ${t('ag_cons')}: <b style="color:var(--tx)">${esc(mkLabel(top, m))}</b> · ${fmt(t('ag_votes'), { v: n[top] })}</p>` : ''}
      ${bb && x ? `<ul class="cmt" style="margin-top:10px"><li>🛌 ${t('agb_rest')}: ${esc(ts(m.h))} ${rd(x.rest[0])} · ${esc(ts(m.a))} ${rd(x.rest[1])}</li><li>🩺 ${t('agb_out')}: ${esc(ts(m.h))} ${x.out[0]} (−${x.pen[0]}) · ${esc(ts(m.a))} ${x.out[1]} (−${x.pen[1]})</li></ul>
        <details class="aic" style="margin-top:10px"><summary>${t('agb_how')}</summary><div class="aib">${BB_AGENTS.map(([a, ic]) => `<p class="note"><b style="color:var(--tx)">${ic} ${agName(a, true)}:</b> ${t('agb_' + a + '_d')}</p>`).join('')}<p class="note">${t('ag_about')}</p></div></details>` : ''}</div>`;
  }

  // ---------- MollaMyrat: yapay zeka analizleri ----------
  // Ayni model verisini farkli yontemlerle yorumlayan dort analizci; tamamen tarayicida hesaplanir.
  const AI_DEFS = [
    ['mdl', '🧠', 'ai_mdl', 'ai_mdl_d'],
    ['poi', '📊', 'ai_poi', 'ai_poi_d'],
    ['val', '💰', 'ai_val', 'ai_val_d'],
    ['frm', '📈', 'ai_frm', 'ai_frm_d']
  ];
  const formStr = (f, n) => { const L = RL(); return (f || []).slice(0, n || 5).map(x => L[x.r] ? L[x.r].slice(0, 1) : '').reverse().join(''); };
  const formPts = f => (f || []).slice(0, 5).reduce((s, x) => s + (x.r === 'W' ? 3 : x.r === 'D' ? 1 : 0), 0);
  const AI_RANGE = { main: [1.18, 99], hi: [1.5, 4.5], sys: [1.5, 2.8] };
  const AI_GOAL = ['O1.5', 'U1.5', 'O2.5', 'U2.5', 'O3.5', 'U3.5', 'KGV', 'KGY'];
  const AI_FAV = { h: ['1', '1X', '12'], a: ['2', 'X2', '12'], d: ['X', '1X', 'X2'] };
  function aiPick(kind, m, pk, mk) {
    if (kind === 'mdl') return pk.k;
    const [lo, hi] = AI_RANGE[mk] || AI_RANGE.main, P = k => probOf(m, k);
    const ks = Object.keys(m.o || {}).filter(k => m.o[k] >= lo && m.o[k] <= hi && P(k) > 0);
    if (kind === 'poi') return ks.filter(k => AI_GOAL.includes(k)).sort((a, b) => P(b) - P(a))[0] || null;
    if (kind === 'val') return ks.filter(k => P(k) >= .3).sort((a, b) => P(b) * m.o[b] - P(a) * m.o[a])[0] || null;
    if (!m.f || !m.f.h || !m.f.a) return null;
    const df = formPts(m.f.h) - formPts(m.f.a), set = AI_FAV[df >= 2 ? 'h' : df <= -2 ? 'a' : 'd'];
    return ks.filter(k => set.includes(k)).sort((a, b) => P(b) - P(a))[0] || null;
  }
  function aiWhy(kind, m, pk, k) {
    const p = probOf(m, k), o = m.o[k] || pk.o;
    if (kind === 'mdl') return fmt(t('ai_r_mdl'), { s: pk.sc[0] + '-' + pk.sc[1], p: pct(p) });
    if (kind === 'poi') return m.p.lh != null ? fmt(t('ai_r_poi'), { x: m.p.lh.toFixed(2) + ' – ' + m.p.la.toFixed(2), b: pct(m.p.btts) }) : fmt(t('ai_r_base'), { p: pct(p) });
    if (kind === 'val') { const e = Math.round((p * o - 1) * 100); return fmt(t('ai_r_val'), { o: o.toFixed(2), e: (e >= 0 ? '+' : '') + e }); }
    return fmt(t('ai_r_frm'), { h: ts(m.h), f: formStr(m.f.h) || '–', a: ts(m.a), g: formStr(m.f.a) || '–' });
  }
  function mollaAI(mk) {
    if (MOLLA.coupons[0] && MOLLA.coupons[0].panel) return agentSection(MOLLA.coupons[0], mk);
    const c = MOLLA.coupons[0], picks = c ? kPicks(c, mk) : [];
    if (picks.length < 3) return '';
    const res = picks.map(pk => {
      const m = MATCH[pk.id], by = {};
      AI_DEFS.forEach(d => { by[d[0]] = m && m.p ? aiPick(d[0], m, pk, mk) : (d[0] === 'mdl' ? pk.k : null); });
      return { pk, m, by };
    });
    const aiRow = (r, k, why) => {
      const o = r.m && r.m.o && r.m.o[k] ? r.m.o[k] : r.pk.o, pk = r.pk;
      return `<a class="tipc-r" href="#/mac/${pk.id}"><span class="tt">${pair(pk.h, pk.a, pkName(pk, 'h'), pkName(pk, 'a'))}<small><b>${esc(mkLabel(k, r.m))}</b> · ${shortDate(pk.d)} ${timeOf(pk.d)}${why ? ' · ' + esc(why) : ''}</small></span><span class="to num">${o.toFixed(2)}</span></a>`;
    };
    const cons = res.map(r => {
      const n = {}; Object.values(r.by).forEach(k => { if (k) n[k] = (n[k] || 0) + 1; });
      const top = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
      return top && n[top] >= 2 ? { r, k: top, n: n[top] } : null;
    }).filter(Boolean).sort((a, b) => b.n - a.n);
    const strong = cons.filter(x => x.n >= 3), shown = strong.length ? strong : cons.slice(0, 4);
    let html = `<h2 class="dayhead">🤖 ${t('ai_title')} · ${t('m_t_' + mk)} <small class="mut">${t('ai_sub')}</small></h2>`;
    html += `<div class="card tipc mc"><div class="tipc-h"><b>🤝 ${t('ai_cons')}</b><small>${t(strong.length ? 'ai_cons_s' : 'ai_cons_s2')}</small></div>
      ${shown.length ? shown.map(x => aiRow(x.r, x.k, AI_DEFS.filter(d => x.r.by[d[0]] === x.k).map(d => d[1]).join('') + ' ' + fmt(t('ai_votes'), { v: x.n }))).join('') : `<div class="empty">${t('ai_none')}</div>`}</div>`;
    AI_DEFS.forEach(d => {
      const [kd, ic, nm, ds] = d, rows = res.filter(r => r.by[kd]);
      html += `<details class="aic" open><summary>${ic} ${t(nm)}<small>${rows.length}/${res.length} ${t('ai_matches')}</small></summary>
        <div class="aib"><p class="note">${t(ds)}</p>${res.map(r => r.by[kd] ? aiRow(r, r.by[kd], r.m && r.m.p ? aiWhy(kd, r.m, r.pk, r.by[kd]) : '') : `<div class="airow"><small class="aiwhy">${esc(pkName(r.pk, 'h'))} – ${esc(pkName(r.pk, 'a'))}: ${t('ai_nopick')}</small></div>`).join('')}</div></details>`;
    });
    return html + `<p class="note" style="margin:2px 2px 12px">${t('ai_about')}</p>`;
  }
  // mac detay sayfasi: dort analizcinun bu mac icin onerisi (oran butonuna dokunup kupona eklenebilir)
  function aiMatchBlock(m) {
    if (m.ag && Object.keys(m.ag).length) return agentMatchBlock(m);
    const prb = (m, k) => k === 'BO' ? (m.p.po != null ? m.p.po : 0) : k === 'BU' ? (m.p.po != null ? 1 - m.p.po : 0) : probOf(m, k);
    const ks = (isBB(m) ? ['1', '2', 'BU', 'BO']
      : ['1', 'X', '2', '1X', 'X2', '12', 'O1.5', 'U1.5', 'O2.5', 'U2.5', 'O3.5', 'U3.5', 'KGV', 'KGY'])
      .filter(k => (m.o || {})[k] && prb(m, k) > 0);
    const tp = tipOf(m), rows = [];
    rows.push({ ic: '🧠', nm: t('ai_mdl'), k: tp.k, why: fmt(t('ai_r_mdl'), { s: m.p.score[0] + '-' + m.p.score[1], p: pct(tp.p) }) });
    const poi = ks.slice().sort((a, b) => prb(m, b) - prb(m, a))[0];
    if (poi) rows.push({ ic: '📊', nm: t('ai_poi'), k: poi, why: m.p.lh != null
      ? fmt(t('ai_r_poi'), { x: m.p.lh.toFixed(2) + ' – ' + m.p.la.toFixed(2), b: pct(m.p.btts) })
      : fmt(t('ai_r_base'), { p: pct(prb(m, poi)) }) });
    const val = ks.filter(k => prb(m, k) >= 0.35).sort((a, b) => prb(m, b) * m.o[b] - prb(m, a) * m.o[a])[0];
    if (val) { const ev = Math.round((prb(m, val) * m.o[val] - 1) * 100); rows.push({ ic: '💰', nm: t('ai_val'), k: val, why: fmt(t('ai_r_val'), { o: m.o[val].toFixed(2), e: (ev >= 0 ? '+' : '') + ev }) }); }
    if (m.f && m.f.h && m.f.a) {
      const df = formPts(m.f.h) - formPts(m.f.a);
      const k = df >= 3 ? '1' : df <= -3 ? '2' : df >= 2 ? '1X' : df <= -2 ? 'X2' : 'X';
      if (m.o[k]) rows.push({ ic: '📈', nm: t('ai_frm'), k, why: fmt(t('ai_r_frm'), { h: ts(m.h), f: formStr(m.f.h) || '–', a: ts(m.a), g: formStr(m.f.a) || '–' }) });
    }
    return `<div class="card sec"><h2>🤖 ${t('ai_title')} <small class="mut">${t('ai_sub')}</small></h2>
      <div class="aimgrid">${rows.map(r => `<div class="aim"><div class="ain">${r.ic} ${esc(r.nm)}</div>${ob(m, r.k)}<small class="mut">${esc(r.why)}</small></div>`).join('')}</div></div>`;
  }

  // ---------- MollaMyrat arsivi ----------
  function mollaArchive() {
    const cs = MOLLA.coupons, A = D.acc || { n: 0, lg: {} };
    const rate = (o, n) => (o + n ? pct(o / (o + n)) + '%' : '–');
    let html = `<h2 class="dayhead">📚 ${t('m_archive')}</h2>`;
    if (cs.length) {
      const months = {}, lgs = {};
      cs.forEach(c => {
        const k = c.date.slice(0, 7), M = months[k] = months[k] || { c: 0, ok: 0, no: 0, full: 0 };
        let o = 0, n = 0;
        c.picks.forEach(x => {
          const r = pkOk(x), L = lgs[x.lg] = lgs[x.lg] || { ok: 0, no: 0 };
          if (r === true) { o++; L.ok++; } else if (r === false) { n++; L.no++; }
        });
        M.c++; M.ok += o; M.no += n; if (o === c.picks.length) M.full++;
      });
      const mname = k => { const [y, m] = k.split('-').map(Number); return t('mo_n')[m - 1] + ' ' + y; };
      html += `<div class="grid2" style="margin-top:0">
        <div class="card sec"><h2>${t('m_month')}</h2><div class="tblwrap"><table class="tbl"><thead><tr><th class="tn">${t('m_month')}</th><th>${t('m_cpns')}</th><th>✓</th><th>✗</th><th>${t('m_rate')}</th><th>${t('m_full')}</th></tr></thead><tbody>
          ${Object.keys(months).sort().reverse().map(k => { const M = months[k]; return `<tr><td class="tn">${mname(k)}</td><td>${M.c}</td><td style="color:var(--pri)">${M.ok}</td><td style="color:var(--red)">${M.no}</td><td class="pts">${rate(M.ok, M.no)}</td><td>${M.full}</td></tr>`; }).join('')}</tbody></table></div></div>
        <div class="card sec"><h2>${t('m_bylg')}</h2><div class="tblwrap"><table class="tbl"><thead><tr><th class="tn">${t('m_lg')}</th><th>✓</th><th>✗</th><th>${t('m_rate')}</th></tr></thead><tbody>
          ${Object.keys(lgs).sort((a, b) => (lgs[b].ok + lgs[b].no) - (lgs[a].ok + lgs[a].no)).map(k => `<tr><td class="tn">${badge(k)}<span>${esc(ln(k))}</span></td><td style="color:var(--pri)">${lgs[k].ok}</td><td style="color:var(--red)">${lgs[k].no}</td><td class="pts">${rate(lgs[k].ok, lgs[k].no)}</td></tr>`).join('')}</tbody></table></div></div>
      </div>`;
      html += `<p class="note">${fmt(t('m_since'), { d: dayShort(cDay(cs[cs.length - 1])) })}</p>`;
    }
    if (A.n) {
      const lgRows = Object.keys(A.lg).sort((a, b) => A.lg[b][0] - A.lg[a][0]).slice(0, 10);
      html += `<div class="card sec"><h2>${t('m_site')}${D.since ? ` <small class="mut">${fmt(t('fin_since'), { d: dayShort(D.since.length > 10 ? dayKey(D.since) : D.since) })}</small>` : ''}</h2><div class="kpis">
        <div class="kpi"><small>${t('m_n')}</small><b>${A.n}</b></div>
        <div class="kpi"><small>${t('f_tip')}</small><b style="color:var(--pri)">${pct(A.tip / A.n)}%</b></div>
        <div class="kpi"><small>${t('f_res')}</small><b>${pct(A.res / A.n)}%</b></div>
        <div class="kpi"><small>${t('f_sc')}</small><b style="color:var(--gold)">${pct(A.sc / A.n)}%</b></div></div>
        <div class="tblwrap" style="margin-top:12px"><table class="tbl"><thead><tr><th class="tn">${t('m_lg')}</th><th>${t('m_n')}</th><th>${t('f_tip')}</th></tr></thead><tbody>
        ${lgRows.map(k => `<tr><td class="tn">${badge(k)}<span>${esc(ln(k))}</span></td><td>${A.lg[k][0]}</td><td class="pts">${pct(A.lg[k][1] / A.lg[k][0])}%</td></tr>`).join('')}</tbody></table></div>
        <p class="note">${t('fin_note')}</p></div>`;
    }
    return html;
  }

  // ---------- profil / uyelik (demo: bu cihazda saklanir) ----------
  async function sha(txt) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) >>> 0;
    return 'x' + h.toString(16);
  }
  async function doRegister(f) {
    const u = f.username.value.trim(), pw = f.password.value;
    let e = '';
    if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) e = t('e_user');
    else if (!SB && users[u.toLowerCase()]) e = t('e_taken');
    else if (pw.length < 6) e = t('e_pass');
    else if (pw !== f.password2.value) e = t('e_match');
    else if (!f.age.checked) e = t('e_age');
    if (e) { authErr.reg = e; return render(); }
    if (SB) {
      if (busy) return; busy = true;
      const { data, error } = await SB.auth.signUp({ email: sbEmail(u), password: pw, options: { data: { username: u.toLowerCase(), display_name: u, phone: f.phone.value.trim() } } });
      busy = false;
      if (error) { authErr.reg = sbErr(error); return render(); }
      if (!data.session) { authErr.reg = t('e_confirm'); return render(); }
      await sbLoad(); authErr = { login: '', reg: '' }; settle(); toast(fmt(t('welcome'), { n: u })); return render();
    }
    const salt = Math.random().toString(36).slice(2);
    users[u.toLowerCase()] = { name: u, phone: f.phone.value.trim(), salt, hash: await sha(salt + pw), since: Date.now() };
    LS.set('users', users); user = u.toLowerCase(); LS.set('user', user); authErr = { login: '', reg: '' };
    loadUser(); saveUser(); toast(fmt(t('welcome'), { n: u })); render();
  }
  async function doLogin(f) {
    if (SB) {
      if (busy) return; busy = true;
      const { error } = await SB.auth.signInWithPassword({ email: sbEmail(f.username.value), password: f.password.value });
      busy = false;
      if (error) { authErr.login = sbErr(error); return render(); }
      await sbLoad(); authErr = { login: '', reg: '' }; settle();
      toast(fmt(t('welcome'), { n: profile ? profile.display_name : '' })); return render();
    }
    const u = users[f.username.value.trim().toLowerCase()];
    if (!u || u.hash !== await sha(u.salt + f.password.value)) { authErr.login = t('e_login'); return render(); }
    user = f.username.value.trim().toLowerCase(); LS.set('user', user); authErr = { login: '', reg: '' };
    loadUser(); settle(); toast(fmt(t('welcome'), { n: u.name })); render();
  }
  function viewProfile() {
    if (!user) {
      return `<div class="pagehead"><h1>${t('profile')}</h1></div><div class="grid2" style="margin-top:0">
        <form class="card sec auth" data-form="login" novalidate><h2>${t('login')}</h2>
          <label>${t('username')}<input name="username" autocomplete="username" required></label>
          <label>${t('password')}<input name="password" type="password" autocomplete="current-password" required></label>
          <div class="err" role="alert">${esc(authErr.login)}</div><button class="btn" type="submit">${t('login')}</button></form>
        <form class="card sec auth" data-form="reg" novalidate><h2>${t('register')}</h2>
          <label>${t('username')}<input name="username" autocomplete="username" maxlength="20" required></label>
          <label>${t('phone')}<input name="phone" type="tel" autocomplete="tel" placeholder="+993"></label>
          <label>${t('password')}<input name="password" type="password" autocomplete="new-password" required></label>
          <label>${t('password2')}<input name="password2" type="password" autocomplete="new-password" required></label>
          <label class="chk"><input name="age" type="checkbox"> <span>${t('age_ok')}</span></label>
          <div class="err" role="alert">${esc(authErr.reg)}</div><button class="btn" type="submit">${t('register')}</button></form>
      </div>${favCard()}${notifCard()}<p class="note">${t(SB ? 'srv_acc' : 'demo_acc')}</p>`;
    }
    const u = uinfo() || { name: user, since: Date.now() }, n = k => coupons.filter(c => dispStatus(c) === k || (k === 'won' && dispStatus(c) === 'won_wait')).length;
    return `<div class="pagehead"><h1>${t('profile')}</h1></div>
      <div class="card sec" style="margin-top:0"><div class="prof"><span class="av big">${esc(u.name.slice(0, 1).toUpperCase())}</span>
        <div><b>${esc(u.name)}</b><small class="mut">${u.phone ? esc(u.phone) + ' · ' : ''}${t('member_since')}: ${shortDate(u.since)}.${new Date(u.since).getFullYear()}</small></div>
        <button class="chip" style="margin-left:auto" data-act="logout">${t('logout')}</button></div>
        <div class="kpis m5" style="margin-top:14px">
          <div class="kpi"><small>${t('demo_balance')}</small><b style="color:var(--pri)">${money(balance)}</b></div>
          <div class="kpi"><small>${t('st_total')}</small><b>${coupons.length}</b></div>
          <div class="kpi"><small>${t('won')}</small><b style="color:var(--pri)">${n('won')}</b></div>
          <div class="kpi"><small>${t('lost')}</small><b style="color:var(--red)">${n('lost')}</b></div>
          <div class="kpi"><small>${t('pending')}</small><b>${n('pending')}</b></div></div>
        <div class="prof-a"><a class="btn" href="#/kuponlarim">${t('mycoupons')}</a><button class="btn ghost" data-act="resetbal">${t('reset_balance')}</button></div>
      </div>${favCard()}${notifCard()}<p class="note">${t(SB ? 'srv_acc' : 'demo_acc')}</p>`;
  }

  // ---------- bulten ----------
  function viewBulletin() {
    const up = upcoming();
    const inLg = up.filter(lgOk);
    const days = pickDay(inLg);
    return `<div class="pagehead"><h1>${t('bulletin')}</h1></div>
      ${dayStrip(days)}${lgChips(new Set(up.map(m => m.lg)))}
      <div class="searchrow"><input id="q" type="search" placeholder="${t('search')}" value="${esc(flt.q)}" autocomplete="off" aria-label="${t('search')}"></div>
      <div id="favbox">${favBox()}</div>
      <div id="livebox" data-sport="fb">${liveBox('fb')}</div>
      <div id="blist">${bulletinList()}</div>`;
  }
  function favBox() {
    if (!FAV.size || flt.lg !== 'all' || (flt.q || '').trim()) return '';
    const ms = upcoming().filter(isFavM).sort(byDate).slice(0, 5);
    if (!ms.length) return '';
    return `<h2 class="dayhead favhead">★ ${t('fav_next')}</h2><section class="card lgblock favb">${ms.map(m => row(m, true)).join('')}</section>`;
  }
  function bulletinList() {
    const q = flt.q.trim().toLocaleLowerCase();
    const hit = id => { const x = team(id); return (x.n + ' ' + (x[lang] || '')).toLocaleLowerCase().includes(q); };
    const list = upcoming().filter(m => lgOk(m)
      && (q ? (hit(m.h) || hit(m.a)) : (flt.day === 'all' || dayKey(m.d) === flt.day)));
    if (!list.length) return `<div class="card empty">${t('nomatch')}</div>`;
    let html = '';
    const order = {}; D.leagues.forEach((l, i) => { order[l.id] = i; });
    const dks = [...new Set(list.map(m => dayKey(m.d)))].sort(), lim = q || flt.lg !== 'all' ? dks.length : flt.blim;
    dks.slice(0, lim).forEach(dk => {
      const ms = list.filter(m => dayKey(m.d) === dk).sort((a, b) => byDate(a, b) || order[a.lg] - order[b.lg]);
      html += `<h2 class="dayhead">${dayLabel(dk)} <small>${ms.length} ${t('selections')}</small></h2><section class="card lgblock">
        <div class="mkhead"><span></span><span>${t('ms')}</span><span>${t('ou')} 2.5</span><span>${t('btts')}</span><span></span></div>
        ${ms.map(row).join('')}</section>`;
    });
    const rest = dks.slice(lim).reduce((n, dk) => n + list.filter(m => dayKey(m.d) === dk).length, 0);
    if (rest) html += `<button class="btn ghost more" data-act="bmore">${fmt(t('show_more'), { n: rest })}</button>`;
    return html;
  }
  function row(m, wd) {
    const c = m.ag ? agCons(m) : null, p = m.p || {}, x2 = v => v.toFixed(2);
    return `<div class="mrow">
      <a class="minfo" href="#/mac/${m.id}">
        <div class="mtime num">${wd === true ? `<span class="md">${shortDate(m.d)}</span>` : ''}${timeOf(m.d)}</div>
        <div class="mteams"><div class="mlg">${badge(m.lg)}<span>${esc(ln(m.lg))}</span></div><div class="tm">${logo(m.h)}<span>${esc(tn(m.h))}</span>${favMark(m.h)}</div><div class="tm">${logo(m.a)}<span>${esc(tn(m.a))}</span>${favMark(m.a)}</div>
          ${p.lh != null ? `<div class="xgr num" title="${esc(t('xg_tip'))}">xG <b>${x2(p.lh)}–${x2(p.la)}</b></div>` : ''}
          ${c && (c.srv || c.n >= 2) ? `<div class="xgr agh">${t('ag_cons')}: <b>${esc(mkLabel(c.k, m))}</b> · ${m.o[c.k].toFixed(2)} · ${c.n}/5</div>` : ''}</div>
      </a>
      <div class="og c3 ms">${ob(m, '1')}${ob(m, 'X')}${ob(m, '2')}</div>
      <div class="og c2 ou">${ob(m, 'U2.5', t('under'))}${ob(m, 'O2.5', t('over'))}</div>
      <div class="og c2 kg">${ob(m, 'KGV')}${ob(m, 'KGY')}</div>
      <button type="button" class="morebtn" data-mx="${m.id}" aria-expanded="false" title="${t('more')}" aria-label="${t('more')}: ${esc(tn(m.h))} – ${esc(tn(m.a))}">+${Object.keys(m.o).length - 3 + (m.xo ? 12 : 0)}</button>
    </div>`;
  }
  // ilk yari sonucu ve IY/MS: analiz amacli gosterilir (kupona eklenmez)
  const HF_L = ['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'];
  const xob = (label, o) => `<span class="ob info"><small>${label}</small><b>${o ? (+o).toFixed(2) : '–'}</b></span>`;
  function xoGroups(m, card) {
    const x = m.xo; if (!x) return '';
    const g = (title, src, cols, inner) => (card ? `<div class="card sec"><h2>${title} ${srcBadge(src)}</h2><div class="og c${cols}">${inner}</div></div>`
      : `<div class="mxg"><h4>${title} ${srcBadge(src)}</h4><div class="og c${cols}">${inner}</div></div>`);
    return g(t('iy_res'), x.s[0], 3, ['1', 'X', '2'].map((l, i) => xob(l, x.iy[i])).join(''))
      + g(t('iy_ms'), x.s[1], 3, HF_L.map((l, i) => xob(l, x.hf[i])).join(''));
  }
  function mxPanel(m) {
    const g = (title, ks, cols) => `<div class="mxg"><h4>${title}</h4><div class="og c${cols}">${ks.map(k => ob(m, k)).join('')}</div></div>`;
    return `<div class="mxp" data-mxp="${m.id}">${xoGroups(m)}${g(t('dc'), ['1X', '12', 'X2'], 3)}${g(t('ou'), ['U1.5', 'O1.5', 'U3.5', 'O3.5'], 4)}
      <div class="mxf"><small>${t('x_info')}</small><a class="btn ghost" href="#/mac/${m.id}">${t('mx_more')} →</a></div></div>`;
  }

  // ---------- analiz listesi ----------
  const pbar = p => `<div class="pbar num"><div class="p1" style="flex:${p.p1}">${pct(p.p1)}%</div>${p.px != null ? `<div class="px" style="flex:${p.px}">${pct(p.px)}%</div>` : ''}<div class="p2" style="flex:${p.p2}">${pct(p.p2)}%</div></div>`;
  const spSeg = () => `<div class="seg" role="tablist">${['fb', 'bb'].map(k => `<button class="${(flt.sp === 'bb' ? 'bb' : 'fb') === k ? 'on' : ''}" data-sp="${k}">${t('sp_' + k)}</button>`).join('')}</div>`;
  // ortak karar: analizcilerin en cok birlestigi secim
  function agCons(m) {
    if (m.sport === 'bb') return m.tip && m.tip.ag && m.o[m.tip.k] ? { k: m.tip.k, n: m.tip.v } : null;
    if (m.cons && m.o[m.cons.k]) return { k: m.cons.k, n: m.cons.v, srv: 1 };   // sunucunun tutarli karari
    const n = {}; AGENTS.forEach(([a]) => { const x = (m.ag || {})[a]; if (x && m.o[x[0]]) n[x[0]] = (n[x[0]] || 0) + 1; });
    const top = Object.keys(n).sort((x, y) => n[y] - n[x])[0];
    return top ? { k: top, n: n[top] } : null;
  }
  function shortLab(k, m) {
    if (k === 'BO' || k === 'BU') return (k === 'BO' ? t('over') : t('under')) + ' ' + (m || {}).line;
    if (/^[OU]/.test(k)) return (k[0] === 'O' ? t('over') : t('under')) + ' ' + k.slice(1);
    if (k === 'KGV' || k === 'KGY') return t('kg_s') + ' ' + (k === 'KGV' ? t('yes') : t('no'));
    return /^(1|X|2)$/.test(k) ? t('ms_s') + ' ' + k : k;
  }
  // bes analizcinin bu mactaki secimi: yan yana bes kutu
  function agTiles(m) {
    const bb = m.sport === 'bb', c = agCons(m);
    return `<div class="agt5">${agList(bb).map(([a, ic]) => {
      const x = (m.ag || {})[a], nm = bb ? t('agb_' + a + '_s') : t('ag_' + a);
      if (!x || !m.o[x[0]]) return `<div class="agtile na" title="${esc(agName(a, bb))}: ${esc(t('ag_na'))}">${agAv(a, bb, ic)}<span class="nm">${esc(nm)}</span><b>–</b><small>&nbsp;</small></div>`;
      const v = x[1], lv = a === 'vr' ? (v >= .03 ? 'hi' : v >= -.03 ? 'mid' : 'lo') : (v >= .65 ? 'hi' : v >= .55 ? 'mid' : 'lo');
      return `<div class="agtile ${lv}${c && (c.srv || c.n >= 2) && c.k === x[0] ? ' agr' : ''}" title="${esc(agName(a, bb))}: ${esc(mkLabel(x[0], m))}">${agAv(a, bb, ic)}<span class="nm">${esc(nm)}</span><b>${esc(shortLab(x[0], m))}</b><small class="num">${agVal(a, v)}</small></div>`;
    }).join('')}</div>`;
  }
  function agScoreStrip(bb) {
    const A = (bb ? D.agaccbb : D.agacc) || {}, B = bb ? {} : (D.agbt || {});
    const live = agList(bb).some(([a]) => (A[a] || [0])[0]);
    if (!live && !Object.keys(B).length) return '';
    return `<div class="agks">${agList(bb).map(([a, ic]) => { const r = A[a] || [0, 0], bt = B[a];
      const val = r[0] ? `<b>${pct(r[1] / r[0])}%</b><small>${r[1]}/${r[0]}</small>` : bt && bt.n ? `<b>${pct(bt.hit / bt.n)}%</b><small>${t('bt_s')} · ${bt.n}</small>` : '<b>–</b><small>&nbsp;</small>';
      return `<div class="agk1" title="${esc(t(r[0] ? 'an_karne_d' : 'bt_d'))}">${agAv(a, bb, ic)}<div><b>${esc(bb ? t('agb_' + a + '_s') : t('ag_' + a))}</b><small>${esc(bb ? '' : t('ag_' + a + '_r'))}</small></div><span class="num">${val}</span></div>`; }).join('')}</div>
      ${!live && !bb ? `<p class="note" style="margin:-6px 2px 12px">${t('bt_d')}</p>` : ''}`;
  }
  function anCard(m) {
    const bb = m.sport === 'bb', p = m.p, c = agCons(m);
    const stat = (l, v) => `<div class="ans"><small>${l}</small><b class="num">${v}</b></div>`;
    const stats = bb
      ? stat(t('bb_exp_total'), p.total) + stat(t('bb_margin'), p.margin != null ? (p.margin >= 0 ? '+' : '') + p.margin.toFixed(1) : '–') + stat(t('over') + ' ' + m.line, p.po != null ? pct(p.po) + '%' : '–')
      : stat('xG', p.lh.toFixed(2) + ' – ' + p.la.toFixed(2)) + stat(t('over') + ' 2.5', pct(p.o25) + '%') + stat(t('btts'), pct(p.btts) + '%');
    return `<a class="card anc" href="#/mac/${m.id}${bb ? '' : '/analiz'}">
      <div class="anh"><span>${badge(bb ? 'nba' : m.lg)} ${esc(bb ? 'NBA' : ln(m.lg))}</span><span class="num">${timeOf(m.d)}</span></div>
      <div class="ant"><div class="tm">${logo(m.h)}<span>${esc(ts(m.h))}</span></div><div class="sc"><small>${t('pred_score')}</small><b class="num">${p.score[0]} - ${p.score[1]}</b></div><div class="tm r"><span>${esc(ts(m.a))}</span>${logo(m.a)}</div></div>
      <div>${pbar(p)}<div class="anl3"><span>1</span>${bb ? '' : '<span>X</span>'}<span>2</span></div></div>
      <div class="anst">${stats}</div>
      ${agTiles(m)}
      ${c && (c.srv || c.n >= 2) ? `<div class="anf"><span class="pill">${t('ag_cons')}</span><b>${esc(mkLabel(c.k, m))}</b><span class="num od">${m.o[c.k].toFixed(2)}</span><span class="num vt">${c.n}/5</span></div>` : ''}
    </a>`;
  }
  function viewAnalysis() {
    const bb = flt.sp === 'bb', up = bb ? BB.matches.filter(future) : upcoming();
    const list = (bb ? up : up.filter(lgOk)).slice().sort(byDate), shown = list.slice(0, flt.alim), more = list.length - shown.length;
    let html = `<div class="pagehead"><h1>${t('analysis')}</h1></div>${spSeg()}
      ${bb ? '' : lgChips(new Set(up.map(m => m.lg)), true)}${agScoreStrip(bb)}`;
    if (!list.length) return html + `<div class="card empty">${t(bb ? 'bb_none' : 'nomatch')}</div>`;
    [...new Set(shown.map(m => dayKey(m.d)))].forEach(dk => {
      const ms = shown.filter(m => dayKey(m.d) === dk);
      html += `<h2 class="dayhead">${dayLabel(dk)} <small>${ms.length} ${t('selections')}</small></h2><div class="ancs">${ms.map(anCard).join('')}</div>`;
    });
    return html + (more > 0 ? `<button class="btn ghost more" data-act="amore">${fmt(t('show_more'), { n: more })}</button>` : '');
  }

  // ---------- mac detay: Analiz sekmesi — her ajan hangi veriyle, nasil hesapladi ----------
  // Ajanlarin olasiliklari tarayicida, veri betigiyle (scripts/update.py) ayni formullerle yeniden hesaplanir;
  // boylece her tahminin hangi veriden ve hangi adimlarla geldigi sayfada acikca gosterilir.
  const AX_KEYS = ['1', 'X', '2', '1X', '12', 'X2', 'O1.5', 'U1.5', 'O2.5', 'U2.5', 'O3.5', 'U3.5', 'KGV', 'KGY'];
  const AX_VOTE = ['fn', 'st', 'mk', 'fm'];
  const AX_IC = { fn: '🧮', st: '📊', mk: '💹', fm: '📈', vr: '⚖️' };
  const f2 = v => (v == null || isNaN(v) ? '–' : (+v).toFixed(2));
  const p1d = v => (v * 100).toFixed(1);
  const axPois = l => { const r = []; let f = 1; for (let k = 0; k <= 8; k++) { if (k) f *= k; r.push(Math.exp(-l) * Math.pow(l, k) / f); } return r; };
  function axPredict(lh, la) {                       // Poisson + Dixon-Coles (rho -0.10), update.py predict()
    const ph = axPois(lh), pa = axPois(la), rho = -0.10, M = [];
    let tot = 0;
    for (let i = 0; i <= 8; i++) {
      M.push([]);
      for (let j = 0; j <= 8; j++) {
        let v = ph[i] * pa[j];
        if (i === 0 && j === 0) v *= 1 - lh * la * rho; else if (i === 1 && j === 0) v *= 1 + la * rho;
        else if (i === 0 && j === 1) v *= 1 + lh * rho; else if (i === 1 && j === 1) v *= 1 - rho;
        M[i].push(v); tot += v;
      }
    }
    let p1 = 0, px = 0, o15 = 0, o25 = 0, o35 = 0, btts = 0; const sc = [];
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      const v = M[i][j] / tot;
      if (i > j) p1 += v; else if (i === j) px += v;
      if (i + j > 1) o15 += v; if (i + j > 2) o25 += v; if (i + j > 3) o35 += v;
      if (i && j) btts += v;
      if (i < 6 && j < 6) sc.push([i, j, v]);
    }
    sc.sort((a, b) => b[2] - a[2]);
    return { lh, la, p1, px, p2: 1 - p1 - px, o15, o25, o35, btts, top: sc.slice(0, 3) };
  }
  const axVec = p => ({ '1': p.p1, X: p.px, '2': p.p2, '1X': p.p1 + p.px, '12': p.p1 + p.p2, X2: p.px + p.p2,
    'O1.5': p.o15, 'U1.5': 1 - p.o15, 'O2.5': p.o25, 'U2.5': 1 - p.o25, 'O3.5': p.o35, 'U3.5': 1 - p.o35, KGV: p.btts, KGY: 1 - p.btts });
  let AX_GRID = null;
  function axMarketLam(q1, qx, q2) {                 // 1-X-2 olasiliklarina en iyi uyan gol beklentisi (market_lambdas)
    if (!AX_GRID) {
      const G = [], P = [];
      for (let a = 0; a < 72; a++) { G.push(Math.round((0.15 + 0.05 * a) * 100) / 100); P.push(axPois(G[a])); }
      AX_GRID = [];
      for (let a = 0; a < 72; a++) for (let b = 0; b < 72; b++) {
        let w = 0, d = 0, l = 0;
        for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const v = P[a][i] * P[b][j]; if (i > j) w += v; else if (i === j) d += v; else l += v; }
        const s = w + d + l; AX_GRID.push([G[a], G[b], w / s, d / s, l / s]);
      }
    }
    let best = null, be = 9;
    AX_GRID.forEach(([a, b, w, d, l]) => { const e = (w - q1) ** 2 + (d - qx) ** 2 + (l - q2) ** 2; if (e < be) { be = e; best = [a, b]; } });
    return best;
  }
  const axW = (l, k) => { let s = 0, w = 0; l.forEach((x, i) => { const q = Math.pow(0.8, i); s += q * x[k]; w += q; }); return w ? s / w : 0; };
  const axClamp = v => Math.min(Math.max(v, 0.2), 3.6);
  const axPts = f => (f || []).slice(0, 5).reduce((s, x) => s + (x.r === 'W' ? 3 : x.r === 'D' ? 1 : 0), 0);
  const axFs = f => { const L = RL(); return (f || []).slice(0, 6).map(x => L[x.r] ? L[x.r].slice(0, 1) : '').reverse().join('-'); };

  function axModel(m) {
    const ag = m.ag || {}, o = m.o || {}, ss = m.ss || {}, A = {};
    A.st = ag.st && ag.st[2] != null ? { lam: [ag.st[2], ag.st[3]], p: axPredict(ag.st[2], ag.st[3]) }
      : { lam: [m.p.lh, m.p.la], p: Object.assign({}, m.p, { top: (m.p.top || []).slice(0, 3) }) };
    if (ag.fn && ag.fn[2] != null) A.fn = { lam: [ag.fn[2], ag.fn[3]], p: axPredict(ag.fn[2], ag.fn[3]) };
    const real = !!(m.src && m.src !== 'model' && o['1'] && o.X && o['2']);
    if (real) {
      const inv = [1 / o['1'], 1 / o.X, 1 / o['2']], s = inv[0] + inv[1] + inv[2], q = inv.map(x => x / s);
      const raw = axMarketLam(q[0], q[1], q[2]), lam = ag.mk && ag.mk[2] != null ? [ag.mk[2], ag.mk[3]] : raw;
      const p = axPredict(lam[0], lam[1]), v = axVec(p), grp = [];
      Object.assign(v, { '1': q[0], X: q[1], '2': q[2], '1X': q[0] + q[1], '12': q[0] + q[2], X2: q[1] + q[2] });
      [['ou15', 'O1.5', 'U1.5'], ['ou25', 'O2.5', 'U2.5'], ['ou35', 'O3.5', 'U3.5'], ['kg', 'KGV', 'KGY']].forEach(([g, a, b]) => {
        if ((ss[g] || 'model') !== 'model' && o[a] && o[b]) { const ia = 1 / o[a], ib = 1 / o[b]; v[a] = ia / (ia + ib); v[b] = ib / (ia + ib); grp.push({ g, a, b, src: ss[g] }); }
      });
      A.mk = { lam, raw, p, v, q, inv, sum: s, grp };
    }
    const fh = (m.f || {}).h || [], fa = (m.f || {}).a || [];
    if (fh.length >= 3 && fa.length >= 3) {
      const w = { hgf: axW(fh, 'gf'), hga: axW(fh, 'ga'), agf: axW(fa, 'gf'), aga: axW(fa, 'ga') };
      const lh = axClamp(0.5 * (w.hgf + w.aga) * 1.10), la = axClamp(0.5 * (w.agf + w.hga) * 0.92);
      A.fm = { lam: [lh, la], p: axPredict(lh, la), w };
    }
    Object.keys(A).forEach(a => { if (!A[a].v) A[a].v = axVec(A[a].p); });
    const ks = AX_KEYS.filter(k => o[k] && o[k] >= 1.3), voters = AX_VOTE.filter(a => A[a]);
    const agw = D.agw || {}, wt = a => agw[a] || 1, twt = voters.reduce((s, a) => s + wt(a), 0) || 1;
    const cons = k => voters.reduce((s, a) => s + wt(a) * A[a].v[k], 0) / twt;   // sunucudaki heyet agirliklariyla
    voters.forEach(a => { const x = A[a]; x.k = ag[a] && o[ag[a][0]] ? ag[a][0] : ks.slice().sort((p, q) => x.v[q] - x.v[p])[0]; });
    let vr = null;
    const risky = { src: m.src === 'model', fr: m.lg === 'fifa.friendly', few: voters.length < 3 };
    if (voters.length >= 3 && m.src !== 'model' && ks.length) {
      const rows = ks.map(k => ({ k, c: cons(k), o: o[k], ev: cons(k) * o[k] - 1 })).sort((a, b) => b.ev - a.ev);
      const ok = rows.filter(r => r.c >= 0.4), k = ag.vr && o[ag.vr[0]] ? ag.vr[0] : (ok[0] || {}).k;
      if (k) vr = { rows: ok, k, r: rows.find(r => r.k === k) };
    }
    return { A, voters, cons, ks, vr, real, risky };
  }

  const axKType = k => (/^[OU]/.test(k) ? 'ou' : /^KG/.test(k) ? 'kg' : 'ms');
  function axConc(m, x, k) {                          // her ajanin yorumunun ortak sonuc kismi
    const H = ts(m.h), Aw = ts(m.a), p = x.v[k], tot = x.lam[0] + x.lam[1];
    let s = fmt(t('ax_conc'), { h: H, x: f2(x.lam[0]), a: Aw, y: f2(x.lam[1]) }) + ' ';
    const ty = axKType(k);
    if (ty === 'ou') s += fmt(t('ax_k_ou'), { s: f2(tot), k: mkLabel(k, m), p: pct(p) });
    else if (ty === 'kg') s += fmt(t('ax_k_kg'), { b: pct(x.v.KGV), k: mkLabel(k, m), p: pct(p) });
    else s += fmt(t('ax_k_ms'), { k: mkLabel(k, m), p: pct(p), a: pct(x.v['1']), b: pct(x.v.X), c: pct(x.v['2']) });
    if (p < .55) s += ' ' + t('ax_low');
    return s;
  }
  const axRec = r => (r && r.p ? `${r.p} ${t('ax_mp')} · ${r.w}-${r.d}-${r.l} · ${r.gf}:${r.ga} <small class="mut">(${t('ax_pg')} ${f2(r.gf / r.p)} / ${f2(r.ga / r.p)})</small>` : '–');
  function axCard(m, a, x, o) {
    const pk = o.pk, H = ts(m.h), Aw = ts(m.a);
    const res = x && x.p ? `<div class="axres"><div class="axr1"><small>${t('ax_res')}</small><b>${esc(mkLabel(pk, m))}</b><span class="mut">${t('xg')} ${f2(x.lam[0])} – ${f2(x.lam[1])} · ${t('ax_likely')} ${x.p.top[0][0]}-${x.p.top[0][1]} (%${p1d(x.p.top[0][2])})</span></div>${ob(m, pk)}</div>
      <div class="axbar">${pbar(x.p)}<div class="plabels"><span>1 · ${esc(H)}</span><span>X</span><span>2 · ${esc(Aw)}</span></div></div>`
      : o.res || '';
    const bb = !!o.bb, av = agAv(a, bb, bb ? BBX_IC[a] : AX_IC[a]);
    return `<div class="card sec axag" id="ax-${a}">
      <div class="axh">${av}<div class="axn"><b>${esc(agName(a, bb))} <span class="mut">· ${esc(t(bb ? 'agb_' + a + '_s' : 'ag_' + a + '_r'))}</span></b><small>${esc(t((bb ? 'axb_m_' : 'ax_m_') + a))}</small></div>
        ${pk ? `<span class="axpk"><small>${t('ax_pick')}</small><b>${esc(shortLab(pk, m))}</b><i class="num">${o.pv}</i></span>` : `<span class="axpk na"><b>–</b><i>${t('ag_na')}</i></span>`}</div>
      <h3 class="axs">🗂 ${t('ax_data')}</h3>
      <dl class="axdl">${o.data.map(r => `<div><dt>${r[0]}</dt><dd>${r[1]}${r[2] ? ` <span class="srcb${r[2] === 'Analiz365' ? ' m' : ''}">${esc(r[2])}</span>` : ''}</dd></div>`).join('')}</dl>
      ${o.extra || ''}
      <h3 class="axs">🧮 ${t('ax_calc')}</h3>
      <ol class="axol">${o.steps.map(s => `<li>${s}</li>`).join('')}</ol>
      <h3 class="axs">💬 ${t('ax_say')}</h3>
      <blockquote class="axq">${av}<p>${esc(o.say)}</p></blockquote>
      ${res}
    </div>`;
  }
  function axVerdict(m, X) {
    const A = X.A, out = [], H = ts(m.h), Aw = ts(m.a), c = agCons(m), nm = a => t('ag_' + a);
    const q = ['1', 'X', '2'].map(k => X.cons(k));
    if (Math.abs(q[0] - q[2]) >= .12) out.push(fmt(t('ax_v_fav'), { t: q[0] > q[2] ? H : Aw, a: pct(q[0]), b: pct(q[1]), c: pct(q[2]) }));
    else out.push(fmt(t('ax_v_even'), { a: pct(q[0]), b: pct(q[1]), c: pct(q[2]) }));
    const tots = X.voters.map(a => A[a].lam[0] + A[a].lam[1]), avg = tots.reduce((s, v) => s + v, 0) / tots.length;
    const o25 = X.cons('O2.5');
    out.push(fmt(t(o25 >= .5 ? 'ax_v_goal_hi' : 'ax_v_goal_lo'), { lo: f2(Math.min(...tots)), hi: f2(Math.max(...tots)), x: f2(avg), p: pct(o25 >= .5 ? o25 : 1 - o25), b: pct(X.cons('KGV')) }));
    if (c) {
      const agree = X.voters.filter(a => A[a].k === c.k), diff = X.voters.filter(a => A[a].k && A[a].k !== c.k);
      if (agree.length >= 2) out.push(fmt(t('ax_v_agree'), { n: agree.map(nm).join(', '), k: mkLabel(c.k, m), p: pct(X.cons(c.k)) }));
      diff.forEach(a => out.push(fmt(t('ax_v_diff'), { n: nm(a), k: mkLabel(A[a].k, m), p: pct(A[a].v[A[a].k]), w: t('ax_why_' + a) })));
    }
    if (X.vr) { const r = X.vr.r; out.push(fmt(t(r.ev >= 0 ? 'ax_v_val_p' : 'ax_v_val_n'), { n: nm('vr'), k: mkLabel(r.k, m), c: pct(r.c), o: r.o.toFixed(2), e: (r.ev >= 0 ? '+' : '') + Math.round(r.ev * 100) })); }
    else out.push(fmt(t('ax_v_val_x'), { n: nm('vr') }));
    return out;
  }

  function tabAnalysis(m) {
    const X = axModel(m), A = X.A, H = ts(m.h), Aw = ts(m.a), o = m.o, ag = m.ag || {};
    if (!X.voters.length) return `<div class="card empty">${t('ax_none')}</div>`;
    const sh = m.st.h || {}, sa = m.st.a || {}, fh = m.f.h || [], fa = m.f.a || [], x0 = m.agx || {};
    const outN = [(m.sq.h && m.sq.h.out) || [], (m.sq.a && m.sq.a.out) || []];
    const nOut = x0.out || [outN[0].length, outN[1].length];
    const rest = x0.rest || [null, null];
    const tb = (D.tables || {})[m.lg], rk = id => (tb ? tb.all.findIndex(r => r.t === id) + 1 : 0), all = id => (tb ? tb.all.find(r => r.t === id) : null);
    const lgo = LG[m.lg] || {}, dataSrc = lgo.tsdb ? 'TheSportsDB' : 'ESPN', c = agCons(m);
    const upd = D.updated ? shortDate(D.updated) + ' ' + timeOf(D.updated) : '–';
    const pv = a => (A[a] && A[a].k ? '%' + pct(A[a].v[A[a].k]) : '');

    // 1) ozet karar
    let html = `<div class="card sec axv"><h2>🔎 ${t('ax_title')}</h2><p class="note" style="margin:-6px 0 12px">${t('ax_intro')}</p>
      ${c ? `<div class="axverd"><i class="av a-all">★</i><div><small>${t('ag_cons')}</small><b>${esc(mkLabel(c.k, m))}</b><span class="mut">${fmt(t('ag_votes'), { v: c.n })} · ${t('ax_avgp')} %${pct(X.cons(c.k))}</span></div>${ob(m, c.k)}</div>` : ''}
      <ul class="cmt axcmt">${axVerdict(m, X).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      <div class="axsrc">
        <span>📊 ${t('ax_s_odds')}: <b>${esc(srcName(m.src))}</b></span>
        <span>📅 ${t('ax_s_form')}: <b>${fh.length} + ${fa.length}</b></span>
        <span>🏟️ ${t('ax_s_season')}: <b>${sh.p || 0} + ${sa.p || 0}</b></span>
        <span>🩹 ${t('ax_s_out')}: <b>${nOut[0]} – ${nOut[1]}</b></span>
        ${rest[0] != null ? `<span>🛌 ${t('ax_s_rest')}: <b>${rest[0]} – ${rest[1] != null ? rest[1] : '–'} ${t('ax_days')}</b></span>` : ''}
        <span>🕒 ${t('ax_s_upd')}: <b>${upd}</b></span>
      </div></div>`;

    // 2) yan yana karsilastirma
    const row = a => { const x = A[a], v = x.v, mx = Math.max(v['1'], v.X, v['2']), cl = k => (v[k] === mx ? ' class="axhi"' : '');
      return `<tr><td class="tn"><button type="button" class="axj" data-axj="${a}">${agAv(a, false, AX_IC[a])}<span>${esc(t('ag_' + a))}</span></button></td><td class="num">${f2(x.lam[0])}–${f2(x.lam[1])}</td><td${cl('1')}>${pct(v['1'])}</td><td${cl('X')}>${pct(v.X)}</td><td${cl('2')}>${pct(v['2'])}</td><td>${pct(v['O2.5'])}</td><td>${pct(v.KGV)}</td><td class="tn axk${c && x.k === c.k ? ' agr' : ''}"><b>${esc(shortLab(x.k, m))}</b> <small class="mut">%${pct(v[x.k])}</small></td></tr>`; };
    const lamAvg = i => X.voters.reduce((s, a) => s + A[a].lam[i], 0) / X.voters.length;
    html += `<div class="card sec"><h2>⚖️ ${t('ax_cmp')}</h2><p class="note" style="margin:-6px 0 10px">${t('ax_cmp_d')}</p>
      <div class="tblwrap"><table class="tbl axt"><thead><tr><th class="tn">${t('an_analyst')}</th><th>${t('xg')}</th><th>1 %</th><th>X %</th><th>2 %</th><th>${t('over')} 2.5</th><th>${t('kg_s')} ${t('yes')}</th><th class="tn">${t('ax_pick')}</th></tr></thead><tbody>
      ${X.voters.map(row).join('')}
      <tr class="axavg"><td class="tn"><i class="av a-all">★</i><span>${t('ax_avg')}</span></td><td class="num">${f2(lamAvg(0))}–${f2(lamAvg(1))}</td><td>${pct(X.cons('1'))}</td><td>${pct(X.cons('X'))}</td><td>${pct(X.cons('2'))}</td><td>${pct(X.cons('O2.5'))}</td><td>${pct(X.cons('KGV'))}</td><td class="tn axk">${c ? `<b>${esc(shortLab(c.k, m))}</b> <small class="mut">${c.n}/5</small>` : '–'}</td></tr>
      </tbody></table></div>
      ${X.vr ? `<p class="note">${agAv('vr', false)} <b style="color:var(--tx)">${esc(t('ag_vr'))}:</b> ${esc(mkLabel(X.vr.k, m))} · ${t('ag_ev')} ${(X.vr.r.ev >= 0 ? '+' : '') + Math.round(X.vr.r.ev * 100)}%</p>` : ''}</div>`;

    html += `<h2 class="dayhead">🤖 ${t('ax_agents')} <small class="mut">${t('ax_agents_d')}</small></h2>`;

    // 3a) Fenasi
    if (A.fn) {
      const x = A.fn, st = [], rh = rest[0], ra = rest[1];
      st.push(t('ax_fn_1'), t('ax_fn_2'));
      if ((rh != null && rh < 4) || (ra != null && ra < 4)) st.push(fmt(t('ax_fn_rest_y'), { t: esc([rh != null && rh < 4 ? H : null, ra != null && ra < 4 ? Aw : null].filter(Boolean).join(', ')) }));
      else st.push(t('ax_fn_rest_n'));
      if (nOut[0] || nOut[1]) {
        const mh = Math.max(0.85, 1 - 0.04 * nOut[0]) * Math.min(1.08, 1 + 0.015 * nOut[1]), ma = Math.max(0.85, 1 - 0.04 * nOut[1]) * Math.min(1.08, 1 + 0.015 * nOut[0]);
        st.push(fmt(t('ax_fn_out_y'), { h: esc(H), n: nOut[0], a: esc(Aw), k: nOut[1], x: mh.toFixed(3), y: ma.toFixed(3) }));
      } else st.push(t('ax_fn_out_n'));
      st.push(fmt(t('ax_res_xg'), { h: esc(H), x: f2(x.lam[0]), a: esc(Aw), y: f2(x.lam[1]), s: f2(x.lam[0] + x.lam[1]) }));
      const names = l => (l.length ? ' <small class="mut">(' + l.slice(0, 4).map(p => esc(p.n)).join(', ') + (l.length > 4 ? '…' : '') + ')</small>' : '');
      const data = [
        [fmt(t('ax_d_home'), { t: esc(H) }), axRec(sh), t('ax_tag_season')],
        [fmt(t('ax_d_away'), { t: esc(Aw) }), axRec(sa), t('ax_tag_season')]];
      if (rk(m.h) && rk(m.a)) data.push([t('ax_d_rank'), `${esc(H)} <b>${rk(m.h)}.</b> · ${esc(Aw)} <b>${rk(m.a)}.</b>`, t('standings')]);
      if (rest[0] != null) data.push([t('ax_d_rest'), `${esc(H)} <b>${rest[0]}</b> · ${esc(Aw)} <b>${rest[1] != null ? rest[1] : '–'}</b> ${t('ax_days')}`, t('ax_tag_fix')]);
      data.push([t('ax_d_out'), `${esc(H)} <b>${nOut[0]}</b>${names(outN[0])} · ${esc(Aw)} <b>${nOut[1]}</b>${names(outN[1])}`, t('lineups')]);
      const say = (sh.p && sa.p ? fmt(t('ax_fn_say'), { h: H, hg: f2(sh.gf / sh.p), hc: f2(sh.ga / sh.p), a: Aw, ag: f2(sa.gf / sa.p), ac: f2(sa.ga / sa.p) }) + ' ' : '') + axConc(m, x, x.k);
      html += axCard(m, 'fn', x, { pk: x.k, pv: pv('fn'), data, steps: st, say });
    }

    // 3b) Behcet (istatistik modeli)
    if (A.st) {
      const x = A.st, frh = fh.length ? axPts(fh) / (3 * Math.min(5, fh.length)) : .5, fra = fa.length ? axPts(fa) / (3 * Math.min(5, fa.length)) : .5;
      const fmh = 1 + 0.12 * (frh - .5) - 0.06 * (fra - .5), fma = 1 + 0.12 * (fra - .5) - 0.06 * (frh - .5);
      const isB = m.src === 'bet365', w = !X.real ? 0 : isB ? (lgo.cup ? .75 : .5) : (lgo.cup ? .9 : .6);
      const st = [t('ax_st_1'), fmt(t('ax_st_2'), { h: esc(H), x: fmh.toFixed(3), a: esc(Aw), y: fma.toFixed(3) })];
      if (w && A.mk) {
        const mr = A.mk.raw, sx = (x.lam[0] - w * mr[0]) / (1 - w), sy = (x.lam[1] - w * mr[1]) / (1 - w);
        st.push(fmt(t('ax_st_3'), { x: f2(Math.max(.2, sx)), y: f2(Math.max(.2, sy)), s: esc(srcName(m.src)), mx: f2(mr[0]), my: f2(mr[1]), ws: Math.round((1 - w) * 100), wm: Math.round(w * 100) }));
      } else st.push(t('ax_st_3n'));
      st.push(fmt(t('ax_res_xg'), { h: esc(H), x: f2(x.lam[0]), a: esc(Aw), y: f2(x.lam[1]), s: f2(x.lam[0] + x.lam[1]) }));
      const ah = all(m.h), aa = all(m.a);
      const data = [
        [fmt(t('ax_d_home'), { t: esc(H) }), axRec(sh), t('ax_tag_season')],
        [fmt(t('ax_d_away'), { t: esc(Aw) }), axRec(sa), t('ax_tag_season')]];
      if (ah && aa) data.push([t('ax_d_all'), `${esc(H)} ${ah.w}-${ah.d}-${ah.l} (${ah.gf}:${ah.ga}) · ${esc(Aw)} ${aa.w}-${aa.d}-${aa.l} (${aa.gf}:${aa.ga})`, t('standings')]);
      data.push([t('ax_d_form5'), `${esc(H)} <b>${axPts(fh)}</b>/${3 * Math.min(5, fh.length)} · ${esc(Aw)} <b>${axPts(fa)}</b>/${3 * Math.min(5, fa.length)}`, t('ax_tag_form')]);
      if (w) data.push([t('ax_d_blend'), fmt(t('ax_d_blend_v'), { s: esc(srcName(m.src)), w: Math.round(w * 100) }), srcName(m.src)]);
      const say = fmt(t('ax_st_say'), { h: H, w: sh.w || 0, d: sh.d || 0, l: sh.l || 0, a: Aw, w2: sa.w || 0, d2: sa.d || 0, l2: sa.l || 0, p1: axPts(fh), p2: axPts(fa) }) + ' ' + axConc(m, x, x.k);
      html += axCard(m, 'st', x, { pk: x.k, pv: pv('st'), data, steps: st, say });
    }

    // 3c) Osman (piyasa)
    if (A.mk) {
      const x = A.mk, mg = x.sum - 1, grpL = { ou15: t('ou') + ' 1.5', ou25: t('ou') + ' 2.5', ou35: t('ou') + ' 3.5', kg: t('btts') };
      const data = [[t('ax_d_book'), `<b>${esc(srcName(m.src))}</b>`, srcName(m.src)],
        [t('ms'), `1 <b>${o['1'].toFixed(2)}</b> · X <b>${o.X.toFixed(2)}</b> · 2 <b>${o['2'].toFixed(2)}</b>`, srcName(m.src)]];
      x.grp.forEach(g => data.push([grpL[g.g], `${esc(mkShort(g.a, m))} <b>${o[g.a].toFixed(2)}</b> · ${esc(mkShort(g.b, m))} <b>${o[g.b].toFixed(2)}</b>`, srcName(g.src)]));
      const st = [
        fmt(t('ax_mk_1'), { o1: o['1'].toFixed(2), o2: o.X.toFixed(2), o3: o['2'].toFixed(2), a: p1d(x.inv[0]), b: p1d(x.inv[1]), c: p1d(x.inv[2]), s: p1d(x.sum) }),
        fmt(t('ax_mk_2'), { m: p1d(mg), a: p1d(x.q[0]), b: p1d(x.q[1]), c: p1d(x.q[2]) })];
      x.grp.forEach(g => st.push(fmt(t('ax_mk_3'), { g: grpL[g.g], a: esc(mkShort(g.a, m)), x: p1d(x.v[g.a]), b: esc(mkShort(g.b, m)), y: p1d(x.v[g.b]) })));
      if (!x.grp.length) st.push(t('ax_mk_3n'));
      st.push(fmt(t('ax_mk_4'), { h: esc(H), x: f2(x.lam[0]), a: esc(Aw), y: f2(x.lam[1]) }));
      const fav = x.q[0] >= x.q[2] ? H : Aw;
      const say = fmt(t('ax_mk_say'), { t: fav, p: pct(Math.max(x.q[0], x.q[2])), d: pct(x.q[1]), m: p1d(mg) }) + ' ' + axConc(m, x, x.k);
      html += axCard(m, 'mk', x, { pk: x.k, pv: pv('mk'), data, steps: st, say });
    } else html += axCard(m, 'mk', null, { data: [[t('ax_d_book'), t('ax_mk_none')]], steps: [t('ax_mk_none_d')], say: t('ax_mk_none_s') });

    // 3d) Coskun (form)
    if (A.fm) {
      const x = A.fm, w = x.w, W = [1, .8, .64, .51, .41, .33], L = RL();
      const glist = (id, f) => `<div class="axfl"><div class="axfh">${logo(id, 'sm')} <b>${esc(ts(id))}</b> <span class="frm">${formDots(f.slice(0, 6).map(g => g.r).reverse())}</span></div>
        <table class="axft num"><thead><tr><th></th><th class="tn">${t('ax_opp')}</th><th>${t('ax_score')}</th><th>${t('ax_wt')}</th></tr></thead><tbody>${f.slice(0, 6).map((g, i) => `<tr><td><span class="f ${g.r}">${esc(L[g.r].slice(0, 1))}</span></td><td class="tn">${g.ha === 'H' ? '' : '@ '}${esc(ts(g.o))} <small class="mut">${shortDate(g.d)}</small></td><td><b>${g.gf}-${g.ga}</b></td><td class="mut">${W[i] != null ? W[i].toFixed(2) : Math.pow(.8, i).toFixed(2)}</td></tr>`).join('')}</tbody></table></div>`;
      const sum = (f, k) => f.slice(0, 6).reduce((s, g) => s + g[k], 0);
      const data = [[esc(H), `${axFs(fh)} · ${sum(fh, 'gf')}:${sum(fh, 'ga')}`, t('ax_tag_form')], [esc(Aw), `${axFs(fa)} · ${sum(fa, 'gf')}:${sum(fa, 'ga')}`, t('ax_tag_form')]];
      const st = [t('ax_fm_1'),
        fmt(t('ax_fm_2'), { h: esc(H), a1: f2(w.hgf), a2: f2(w.hga), a: esc(Aw), b1: f2(w.agf), b2: f2(w.aga) }),
        fmt(t('ax_fm_3'), { h: esc(H), x: f2(w.hgf), y: f2(w.aga), r: f2(x.lam[0]) }),
        fmt(t('ax_fm_4'), { a: esc(Aw), x: f2(w.agf), y: f2(w.hga), r: f2(x.lam[1]) })];
      const say = fmt(t('ax_fm_say'), { h: H, f: axFs(fh), g1: sum(fh, 'gf'), c1: sum(fh, 'ga'), a: Aw, g: axFs(fa), g2: sum(fa, 'gf'), c2: sum(fa, 'ga') }) + ' ' + axConc(m, x, x.k);
      html += axCard(m, 'fm', x, { pk: x.k, pv: pv('fm'), data, steps: st, say, extra: `<div class="axfls">${glist(m.h, fh)}${glist(m.a, fa)}</div>` });
    } else html += axCard(m, 'fm', null, { data: [[t('ax_tag_form'), `${fh.length} + ${fa.length}`]], steps: [t('ax_fm_none')], say: t('ax_fm_none') });

    // 3e) Rifki (deger / risk)
    {
      const R = X.risky, ck = b => (b ? '✗' : '✓');
      const data = [[t('ax_d_vr_in'), X.voters.map(a => `${agAv(a, false, AX_IC[a])} ${esc(t('ag_' + a))}`).join(' ')],
        [t('ax_d_risk'), `${ck(R.src)} ${t('ax_r_src')} · ${ck(R.fr)} ${t('ax_r_fr')} · ${ck(R.few)} ${t('ax_r_few')}`]];
      const st = [t('ax_vr_1'), t('ax_vr_2'), t('ax_vr_3')];
      let extra = '', say, pk = null, pvs = '';
      if (X.vr) {
        const r = X.vr.r; pk = r.k; pvs = (r.ev >= 0 ? '+' : '') + Math.round(r.ev * 100) + '%';
        extra = `<div class="tblwrap"><table class="tbl axt axvt"><thead><tr><th class="tn">${t('ax_opt')}</th><th>${t('ax_cp')}</th><th>${t('ax_fair')}</th><th>${t('ax_site')}</th><th>${t('ag_ev')}</th></tr></thead><tbody>
          ${X.vr.rows.slice(0, 6).map(q => `<tr class="${q.k === r.k ? 'hl' : ''}"><td class="tn">${esc(mkLabel(q.k, m))}</td><td>%${pct(q.c)}</td><td class="num">${(1 / q.c).toFixed(2)}</td><td class="num"><b>${q.o.toFixed(2)}</b></td><td class="num ${q.ev >= 0 ? 'axpos' : 'axneg'}">${(q.ev >= 0 ? '+' : '') + Math.round(q.ev * 100)}%</td></tr>`).join('')}
          </tbody></table></div>`;
        say = fmt(t(r.ev >= 0 ? 'ax_vr_say_p' : 'ax_vr_say_n'), { k: mkLabel(r.k, m), c: pct(r.c), f: (1 / r.c).toFixed(2), o: r.o.toFixed(2), e: Math.abs(Math.round(r.ev * 100)) });
        if (R.fr || R.few) say += ' ' + t('ax_vr_risk');
      } else say = t('ax_vr_none');
      const res = pk ? `<div class="axres"><div class="axr1"><small>${t('ax_res')}</small><b>${esc(mkLabel(pk, m))}</b><span class="mut">${t('ax_cp')} %${pct(X.vr.r.c)} · ${t('ag_ev')} ${pvs}</span></div>${ob(m, pk)}</div>` : '';
      html += axCard(m, 'vr', null, { pk, pv: pvs, data, steps: st, say, extra, res });
    }

    // 4) veri kaynaklari
    const ss = m.ss || {}, sl = s => esc(srcName(s || 'model'));
    html += `<div class="card sec"><h2>📚 ${t('ax_srcs')}</h2><ul class="cmt">
      <li>${fmt(t('ax_src_1'), { s: dataSrc })}</li>
      <li>${t('ax_src_2')}: ${t('ms')} <b>${sl(ss.ms || m.src)}</b> · ${t('dc')} <b>${sl(ss.dc)}</b> · ${t('ou')} 1.5 <b>${sl(ss.ou15)}</b> · 2.5 <b>${sl(ss.ou25 || m.ou)}</b> · 3.5 <b>${sl(ss.ou35)}</b> · ${t('btts')} <b>${sl(ss.kg)}</b></li>
      <li>${t('ax_src_3')}</li>
      <li>${fmt(t('ax_src_4'), { d: upd })}</li></ul>
      <p class="note">${t('foot_disc')}</p></div>`;
    return html;
  }

  // ---------- basketbol: Analiz sekmesi (update.py basketball() formulleri) ----------
  const BBX_IC = { pw: '🏀', mk: '💹', fm: '📈', rs: '🛌', in: '🩺' };
  const axErf = x => { const s = x < 0 ? -1 : 1; x = Math.abs(x); const tt = 1 / (1 + 0.3275911 * x);
    return s * (1 - (((((1.061405429 * tt - 1.453152027) * tt) + 1.421413741) * tt - 0.284496736) * tt + 0.254829592) * tt * Math.exp(-x * x)); };
  const axPhi = x => 0.5 * (1 + axErf(x / Math.SQRT2));
  const f1 = v => (v == null || isNaN(v) ? '–' : (+v).toFixed(1));
  const sgn = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
  function bbxModel(m) {
    const x0 = m.agx || {}, st = m.st || {}, o = m.o, line = m.line, E = {}, info = {};
    const ha = st.ha || {}, aa = st.aa || {}, hs = st.h || {}, as = st.a || {}, K = 3;
    const mdl = (m.p && m.p.model) || null;
    // lig ortalamasi: veri dosyasinda varsa oradan, yoksa Guc ajaninin denkleminden geri cozulur
    let avg = x0.avg;
    if (avg == null && mdl && ha.p && aa.p) {
      const c = 3 / (ha.p + K) + 3 / (aa.p + K) - 1;
      avg = (mdl[0] - 1.6 - ha.pf / (ha.p + K) - aa.pa / (aa.p + K)) / c;
    }
    info.avg = avg;
    const rate = (v, p) => (v + K * avg) / (p + K);
    if (mdl) E.pw = [mdl[0] - mdl[1], mdl[0] + mdl[1]];
    const fh = m.f.h || [], fa = m.f.a || [];
    if (fh.length >= 3 && fa.length >= 3) {
      const av = (f, k) => f.reduce((s, g) => s + g[k], 0) / f.length;
      info.fm = { hgf: av(fh, 'gf'), hga: av(fh, 'ga'), agf: av(fa, 'gf'), aga: av(fa, 'ga') };
      const eh = (info.fm.hgf + info.fm.aga) / 2 + 1.6, ea = (info.fm.agf + info.fm.hga) / 2 - 1.6;
      info.fm.eh = eh; info.fm.ea = ea; E.fm = [eh - ea, eh + ea];
    }
    const rest = x0.rest || [null, null], fat = r => (r == null ? 0 : r === 0 ? -2.2 : r >= 3 ? 0.6 : 0);
    if (avg != null && hs.p >= 3 && as.p >= 3) {
      const eh = (rate(hs.pf, hs.p) + rate(as.pa, as.p)) / 2 + fat(rest[0]), ea = (rate(as.pf, as.p) + rate(hs.pa, hs.p)) / 2 + fat(rest[1]);
      info.rs = { eh, ea, fh: fat(rest[0]), fa: fat(rest[1]), ah: rate(hs.pf, hs.p), dh: rate(hs.pa, hs.p), aA: rate(as.pf, as.p), dA: rate(as.pa, as.p) }; E.rs = [eh - ea, eh + ea];
    }
    const pen = x0.pen || [0, 0];
    if (E.pw && m.ag && m.ag.in) E.in = [E.pw[0] - pen[0] + pen[1], E.pw[1] - 0.6 * (pen[0] + pen[1])];
    if (x0.est) Object.keys(x0.est).forEach(a => { E[a] = x0.est[a]; });
    const P = {};
    Object.keys(E).forEach(a => { const [mg, tot] = E[a], p1 = axPhi(mg / 12.5), po = 1 - axPhi((line - tot) / 18.5); P[a] = { '1': p1, '2': 1 - p1, BO: po, BU: 1 - po }; });
    if (m.src && m.src !== 'model' && o['1'] && o['2']) {
      const i1 = 1 / o['1'], i2 = 1 / o['2'], q1 = i1 / (i1 + i2), v = { '1': q1, '2': 1 - q1 };
      let lo = -40, hi = 40; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (axPhi(mid / 12.5) < q1) lo = mid; else hi = mid; }
      const real = x0.lsrc ? x0.lsrc !== 'model' : true;
      if (real && o.BO && o.BU) { const io = 1 / o.BO, iu = 1 / o.BU; v.BO = io / (io + iu); v.BU = iu / (io + iu); }
      P.mk = v; info.mk = { i1, i2, q1, mg: lo, real: real && !!(o.BO && o.BU) };
    }
    const ag = {}, ks = ['1', '2', 'BO', 'BU'].filter(k => o[k] && o[k] >= 1.3);
    Object.keys(P).forEach(a => { const g = (m.ag || {})[a]; ag[a] = g && o[g[0]] ? g[0] : ks.filter(k => P[a][k] != null).sort((p, q) => P[a][q] - P[a][p])[0]; });
    const voters = BB_AGENTS.map(x => x[0]).filter(a => P[a]);
    const cons = k => { const ps = voters.map(a => P[a][k]).filter(v => v != null); return ps.length ? ps.reduce((s, v) => s + v, 0) / ps.length : 0; };
    return { E, P, ag, voters, cons, info, rest, pen };
  }
  function tabAnalysisBB(m) {
    const X = bbxModel(m), E = X.E, P = X.P, I = X.info, H = ts(m.h), Aw = ts(m.a), o = m.o, st = m.st || {}, L = m.line;
    if (!X.voters.length) return `<div class="card empty">${t('ax_none')}</div>`;
    const nm = a => agName(a, true), pc = (a, k) => (P[a] && P[a][k] != null ? pct(P[a][k]) : '–');
    const tip = m.tip && o[m.tip.k] ? m.tip : null, upd = D.updated ? shortDate(D.updated) + ' ' + timeOf(D.updated) : '–';
    const inj = m.inj || { h: [], a: [] }, nOut = (X.rest && m.agx && m.agx.out) || [0, 0];
    const pick = a => X.ag[a];
    const res = (a, extra) => { const k = pick(a); if (!k) return ''; const e = E[a];
      return `<div class="axres"><div class="axr1"><small>${t('ax_res')}</small><b>${esc(mkLabel(k, m))}</b><span class="mut">${e ? `${t('axb_mg')} ${esc(e[0] >= 0 ? H : Aw)} +${Math.abs(e[0]).toFixed(1)} · ${t('bb_exp_total')} ${f1(e[1])}` : extra || ''}</span></div>${ob(m, k)}</div>
        <div class="axbar">${pbar({ p1: P[a]['1'], p2: P[a]['2'] })}<div class="plabels"><span>1 · ${esc(H)}</span><span>2 · ${esc(Aw)}</span></div></div>`; };
    const conc = a => { const k = pick(a), e = E[a], p = P[a][k]; let s = '';
      if (e) s += fmt(t('axb_conc'), { t: e[0] >= 0 ? H : Aw, x: Math.abs(e[0]).toFixed(1), y: f1(e[1]) }) + ' ';
      s += fmt(t(/^B/.test(k) ? 'axb_k_ou' : 'axb_k_ms'), { k: mkLabel(k, m), p: pct(p), l: L, a: pct(P[a]['1']), b: pct(P[a]['2']) });
      if (p < .55) s += ' ' + t('ax_low');
      return s; };
    const card = (a, o2) => axCard(m, a, null, Object.assign({ bb: true, pk: pick(a), pv: pick(a) ? '%' + pct(P[a][pick(a)]) : '' }, o2));
    const rec = r => (r && r.p ? `${r.p} ${t('ax_mp')} · ${r.w}-${r.l} · ${t('axb_ppg')} ${f1(r.pf / r.p)} / ${f1(r.pa / r.p)}` : '–');
    const probStep = a => fmt(t('axb_prob'), { m: f1(E[a][0]), p: pct(P[a]['1']), l: L, s: f1(E[a][1]), q: pct(P[a].BO) });

    // ozet
    const q1 = X.cons('1'), qo = X.cons('BO'), mgs = X.voters.filter(a => E[a]).map(a => E[a][0]), tots = X.voters.filter(a => E[a]).map(a => E[a][1]);
    const vs = [Math.abs(q1 - .5) >= .06 ? fmt(t('axb_v_fav'), { t: q1 >= .5 ? H : Aw, p: pct(Math.max(q1, 1 - q1)) }) : fmt(t('axb_v_even'), { a: pct(q1), b: pct(1 - q1) })];
    if (tots.length) vs.push(fmt(t(qo >= .5 ? 'axb_v_hi' : 'axb_v_lo'), { lo: f1(Math.min(...tots)), hi: f1(Math.max(...tots)), l: L, p: pct(qo >= .5 ? qo : 1 - qo) }));
    if (tip) {
      const ag = X.voters.filter(a => X.ag[a] === tip.k && P[a][tip.k] >= .55), df = X.voters.filter(a => X.ag[a] && X.ag[a] !== tip.k);
      if (ag.length) vs.push(fmt(t('ax_v_agree'), { n: ag.map(nm).join(', '), k: mkLabel(tip.k, m), p: pct(X.cons(tip.k)) }));
      df.forEach(a => vs.push(fmt(t('ax_v_diff'), { n: nm(a), k: mkLabel(X.ag[a], m), p: pct(P[a][X.ag[a]]), w: t('axb_why_' + a) })));
    }
    let html = `<div class="card sec axv"><h2>🔎 ${t('ax_title')}</h2><p class="note" style="margin:-6px 0 12px">${t('ax_intro')}</p>
      ${tip ? `<div class="axverd"><i class="av a-all">★</i><div><small>${t('ag_cons')}</small><b>${esc(mkLabel(tip.k, m))}</b><span class="mut">${fmt(t('ag_votes'), { v: tip.v })} · ${t('ax_avgp')} %${pct(tip.p)}</span></div>${ob(m, tip.k)}</div>` : ''}
      <ul class="cmt axcmt">${vs.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      <div class="axsrc"><span>📊 ${t('ax_s_odds')}: <b>${esc(srcName(m.src))}</b></span><span>📅 ${t('ax_s_form')}: <b>${(m.f.h || []).length} + ${(m.f.a || []).length}</b></span>
        <span>🏟️ ${t('ax_s_season')}: <b>${(st.ha || {}).p || 0} + ${(st.aa || {}).p || 0}</b></span><span>🩹 ${t('ax_s_out')}: <b>${nOut[0]} – ${nOut[1]}</b></span>
        <span>🛌 ${t('ax_s_rest')}: <b>${X.rest[0] == null ? '–' : X.rest[0]} – ${X.rest[1] == null ? '–' : X.rest[1]} ${t('ax_days')}</b></span><span>🕒 ${t('ax_s_upd')}: <b>${upd}</b></span></div></div>`;

    // yan yana
    html += `<div class="card sec"><h2>⚖️ ${t('ax_cmp')}</h2><p class="note" style="margin:-6px 0 10px">${t('axb_cmp_d')}</p>
      <div class="tblwrap"><table class="tbl axt"><thead><tr><th class="tn">${t('an_analyst')}</th><th>${t('axb_mg')}</th><th>${t('bb_exp_total')}</th><th>1 %</th><th>2 %</th><th>${t('over')} ${L}</th><th class="tn">${t('ax_pick')}</th></tr></thead><tbody>
      ${X.voters.map(a => { const e = E[a], v = P[a], hi = k => ((k === '1') === (v['1'] >= .5) ? ' class="axhi"' : '');
        return `<tr><td class="tn"><button type="button" class="axj" data-axj="${a}">${agAv(a, true, BBX_IC[a])}<span>${esc(nm(a))}</span></button></td><td class="num">${e ? sgn(e[0]) : '–'}</td><td class="num">${e ? f1(e[1]) : '–'}</td><td${hi('1')}>${pct(v['1'])}</td><td${hi('2')}>${pct(v['2'])}</td><td>${pc(a, 'BO')}</td><td class="tn axk${tip && X.ag[a] === tip.k ? ' agr' : ''}"><b>${esc(shortLab(X.ag[a], m))}</b> <small class="mut">%${pct(v[X.ag[a]])}</small></td></tr>`; }).join('')}
      <tr class="axavg"><td class="tn"><i class="av a-all">★</i><span>${t('ax_avg')}</span></td><td class="num">${mgs.length ? sgn(mgs.reduce((s, v) => s + v, 0) / mgs.length) : '–'}</td><td class="num">${tots.length ? f1(tots.reduce((s, v) => s + v, 0) / tots.length) : '–'}</td><td>${pct(q1)}</td><td>${pct(1 - q1)}</td><td>${pct(qo)}</td><td class="tn axk">${tip ? `<b>${esc(shortLab(tip.k, m))}</b> <small class="mut">${tip.v}/5</small>` : '–'}</td></tr>
      </tbody></table></div><p class="note">${t('axb_sign')}</p></div>`;
    html += `<h2 class="dayhead">🤖 ${t('ax_agents')} <small class="mut">${t('ax_agents_d')}</small></h2>`;

    // Guc
    if (E.pw) {
      const ha = st.ha || {}, aa = st.aa || {}, md = m.p.model;
      html += card('pw', { data: [[fmt(t('axb_d_all'), { t: esc(H) }), rec(ha), t('ax_tag_season')], [fmt(t('axb_d_all'), { t: esc(Aw) }), rec(aa), t('ax_tag_season')], [t('axb_d_avg'), I.avg != null ? `<b>${f1(I.avg)}</b> ${t('axb_pts')}` : '–', 'NBA']],
        steps: [fmt(t('axb_pw_1'), { a: f1(I.avg) }), fmt(t('axb_pw_2'), { h: esc(H), x: f1(md[0]), a: esc(Aw), y: f1(md[1]) }), probStep('pw')],
        say: fmt(t('axb_pw_say'), { h: H, w: ha.w || 0, l: ha.l || 0, x: f1(ha.pf / ha.p), a: Aw, w2: aa.w || 0, l2: aa.l || 0, y: f1(aa.pf / aa.p) }) + ' ' + conc('pw'), res: res('pw') });
    }
    // Piyasa
    if (P.mk) {
      const k = I.mk, data = [[t('ax_d_book'), `<b>${esc(srcName(m.src))}</b>`, srcName(m.src)], [t('ms'), `1 <b>${o['1'].toFixed(2)}</b> · 2 <b>${o['2'].toFixed(2)}</b>`, srcName(m.src)]];
      if (k.real) data.push([t('bb_total') + ' ' + L, `${t('over')} <b>${o.BO.toFixed(2)}</b> · ${t('under')} <b>${o.BU.toFixed(2)}</b>`, srcName(m.src)]);
      const steps = [fmt(t('axb_mk_1'), { o1: o['1'].toFixed(2), o2: o['2'].toFixed(2), a: p1d(k.i1), b: p1d(k.i2), s: p1d(k.i1 + k.i2), p: p1d(k.q1), q: p1d(1 - k.q1) }),
        fmt(t('axb_mk_2'), { t: esc(k.mg >= 0 ? H : Aw), x: Math.abs(k.mg).toFixed(1) })];
      steps.push(k.real ? fmt(t('axb_mk_3'), { l: L, x: p1d(P.mk.BO), y: p1d(P.mk.BU) }) : t('axb_mk_3n'));
      html += card('mk', { data, steps, say: fmt(t('axb_mk_say'), { t: k.q1 >= .5 ? H : Aw, p: pct(Math.max(k.q1, 1 - k.q1)) }) + ' ' + conc('mk'), res: res('mk', `1 %${pct(P.mk['1'])} · 2 %${pct(P.mk['2'])}`) });
    } else html += axCard(m, 'mk', null, { bb: true, data: [[t('ax_d_book'), t('ax_mk_none')]], steps: [t('ax_mk_none_d')], say: t('ax_mk_none_s') });
    // Form
    if (E.fm && I.fm) {
      const F = I.fm, Lr = RL(), fh = m.f.h, fa = m.f.a;
      const gl = (id, f) => `<div class="axfl"><div class="axfh">${logo(id, 'sm')} <b>${esc(ts(id))}</b> <span class="frm">${formDots(f.slice(0, 6).map(g => g.r).reverse())}</span></div>
        <table class="axft num"><thead><tr><th></th><th class="tn">${t('ax_opp')}</th><th>${t('ax_score')}</th></tr></thead><tbody>${f.slice(0, 6).map(g => `<tr><td><span class="f ${g.r}">${esc(Lr[g.r].slice(0, 1))}</span></td><td class="tn">${g.ha === 'H' ? '' : '@ '}${esc(ts(g.o))} <small class="mut">${shortDate(g.d)}</small></td><td><b>${g.gf}-${g.ga}</b></td></tr>`).join('')}</tbody></table></div>`;
      html += card('fm', { data: [[esc(H), `${fh.filter(g => g.r === 'W').length}-${fh.filter(g => g.r !== 'W').length} · ${t('axb_ppg')} ${f1(F.hgf)} / ${f1(F.hga)}`, t('ax_tag_form')], [esc(Aw), `${fa.filter(g => g.r === 'W').length}-${fa.filter(g => g.r !== 'W').length} · ${t('axb_ppg')} ${f1(F.agf)} / ${f1(F.aga)}`, t('ax_tag_form')]],
        extra: `<div class="axfls">${gl(m.h, fh)}${gl(m.a, fa)}</div>`,
        steps: [t('axb_fm_1'), fmt(t('axb_fm_2'), { h: esc(H), x: f1(F.hgf), y: f1(F.aga), r: f1(F.eh) }), fmt(t('axb_fm_3'), { a: esc(Aw), x: f1(F.agf), y: f1(F.hga), r: f1(F.ea) }), probStep('fm')],
        say: fmt(t('axb_fm_say'), { h: H, w: fh.filter(g => g.r === 'W').length, n: fh.length, a: Aw, w2: fa.filter(g => g.r === 'W').length, n2: fa.length }) + ' ' + conc('fm'), res: res('fm') });
    } else html += axCard(m, 'fm', null, { bb: true, data: [[t('ax_tag_form'), '–']], steps: [t('ax_fm_none')], say: t('ax_fm_none') });
    // Saha ve dinlenme
    if (E.rs) {
      const R = I.rs || {}, rd = r => (r == null ? '–' : r === 0 ? t('agb_b2b') : fmt(t('agb_rest_n'), { n: r }));
      const fx = v => (v ? sgn(v) : '0');
      const steps = I.rs ? [t('axb_rs_1'), fmt(t('axb_rs_2'), { h: esc(H), x: f1(R.ah), y: f1(R.dA), f: fx(R.fh), r: f1(R.eh) }), fmt(t('axb_rs_3'), { a: esc(Aw), x: f1(R.aA), y: f1(R.dh), f: fx(R.fa), r: f1(R.ea) }), probStep('rs')] : [t('axb_rs_1'), probStep('rs')];
      html += card('rs', { data: [[fmt(t('ax_d_home'), { t: esc(H) }), rec(st.h), t('ax_tag_season')], [fmt(t('ax_d_away'), { t: esc(Aw) }), rec(st.a), t('ax_tag_season')], [t('agb_rest'), `${esc(H)} <b>${rd(X.rest[0])}</b> · ${esc(Aw)} <b>${rd(X.rest[1])}</b>`, t('ax_tag_fix')]],
        steps, say: fmt(t('axb_rs_say'), { h: H, w: (st.h || {}).w || 0, l: (st.h || {}).l || 0, a: Aw, w2: (st.a || {}).w || 0, l2: (st.a || {}).l || 0, r1: rd(X.rest[0]), r2: rd(X.rest[1]) }) + ' ' + conc('rs'), res: res('rs') });
    }
    // Kadro
    if (E.in) {
      const il = l => (l && l.length ? l.slice(0, 5).map(x => `${esc(x.n)} <small class="mut">(${esc(x.s || '')})</small>`).join(', ') + (l.length > 5 ? '…' : '') : t('no_absent'));
      html += card('in', { data: [[esc(H), il(inj.h), 'ESPN'], [esc(Aw), il(inj.a), 'ESPN'], [t('agb_out'), `${esc(H)} <b>−${f1(X.pen[0])}</b> · ${esc(Aw)} <b>−${f1(X.pen[1])}</b> ${t('axb_pts')}`]],
        steps: [t('axb_in_1'), fmt(t('axb_in_2'), { h: esc(H), x: f1(X.pen[0]), a: esc(Aw), y: f1(X.pen[1]), m: sgn(E.in[0]), s: f1(E.in[1]) }), probStep('in')],
        say: fmt(t('axb_in_say'), { h: H, x: f1(X.pen[0]), a: Aw, y: f1(X.pen[1]) }) + ' ' + conc('in'), res: res('in') });
    } else html += axCard(m, 'in', null, { bb: true, data: [[t('bb_inj'), t('axb_in_none')]], steps: [t('axb_in_none')], say: t('axb_in_none') });

    html += `<div class="card sec"><h2>📚 ${t('ax_srcs')}</h2><ul class="cmt"><li>${fmt(t('ax_src_1'), { s: 'ESPN (NBA)' })}</li>
      <li>${t('ax_src_2')}: ${t('ms')} / ${t('bb_total')} <b>${esc(srcName(m.src))}</b></li><li>${t('axb_src')}</li><li>${fmt(t('ax_src_4'), { d: upd })}</li></ul><p class="note">${t('foot_disc')}</p></div>`;
    return html;
  }

  // ---------- mac detay ----------
  const backLink = href => `<a class="back" href="${href || '#/'}" data-back="1">← ${t('back')}</a>`;
  // baslamis mac bultenden cikar: canli skor, dakika ve goller (dakikada bir yenilenir)
  function viewLive(r) {
    const l = LIVE[r.id];
    return `${backLink()}<div class="card" style="overflow:hidden"><div class="hero"><div class="meta">${badge(r.lg)} ${esc(ln(r.lg))} · ${dayLabel(dayKey(r.d))} · ${timeOf(r.d)}</div>
      <div class="vs"><div class="side-t">${logo(r.h)}<span>${esc(tn(r.h))} ${favBtn(r.h)}</span></div>
        <div class="mid" data-lvh="${r.id}">${l ? '' : `${t('lv_started')}<small>${timeOf(r.d)}</small>`}</div>
        <div class="side-t">${logo(r.a)}<span>${esc(tn(r.a))} ${favBtn(r.a)}</span></div></div></div></div>
      <div class="card sec" hidden><h2>⚽ ${t('lv_goals')}</h2><div class="lvgl" data-lvg="${r.id}"></div></div>
      <p class="note">${t('lv_note')} <a href="#/sonuclar">${t('results')} →</a></p>`;
  }
  function viewMatch(id) {
    const m = MATCH[id];
    if (!m) { const r = RECENT.find(x => x.id === id); return r ? viewLive(r) : `${backLink(/^b/.test(id) ? '#/basketbol' : '')}<div class="card empty">${t('no_match_found')}</div>`; }
    if (m.sport === 'bb') return viewMatchBB(m);
    if (!m._d) {
      loadDet(m);
      return `${backLink()}<div class="card" style="overflow:hidden"><div class="hero"><div class="meta">${badge(m.lg)} ${esc(ln(m.lg))} · ${dayLabel(dayKey(m.d))} · ${timeOf(m.d)}</div>
        <div class="vs"><div class="side-t">${logo(m.h)}<span>${esc(tn(m.h))}</span></div><div class="mid">${timeOf(m.d)}<small>${shortDate(m.d)}</small></div><div class="side-t">${logo(m.a)}<span>${esc(tn(m.a))}</span></div></div></div></div>
        <div class="card empty"><span class="spin"></span> ${t('loading')}</div>`;
    }
    const TABS = [['an', '🔎 ' + t('ax_tab')], ['pred', t('pred')], ['odds', t('odds')], ['table', t('standings')], ['form', t('formh2h')], ['squad', t('lineups')], ['players', t('players')]];
    let body = '';
    if (dtab === 'pred') body = tabPred(m);
    else if (dtab === 'an') body = tabAnalysis(m);
    else if (dtab === 'odds') body = tabOdds(m);
    else if (dtab === 'table') body = `<div class="card sec">${tableHtml(m.lg, [m.h, m.a])}</div>`;
    else if (dtab === 'form') body = tabForm(m);
    else if (dtab === 'squad') body = tabSquad(m);
    else body = tabPlayers(m);
    return `${backLink()}
      <div class="card" style="overflow:hidden">
        <div class="hero">
          <div class="meta">${badge(m.lg)} ${esc(ln(m.lg))} · ${dayLabel(dayKey(m.d))} · ${timeOf(m.d)}${m.v ? ' · ' + esc(m.v) : ''}</div>
          <div class="vs">
            <div class="side-t">${logo(m.h)}<span>${esc(tn(m.h))} ${favBtn(m.h)}</span><span class="frm">${formDots(m.f.h.slice(0, 5).map(x => x.r).reverse())}</span></div>
            <div class="mid" data-lvh="${m.id}">${timeOf(m.d)}<small>${shortDate(m.d)}</small></div>
            <div class="side-t">${logo(m.a)}<span>${esc(tn(m.a))} ${favBtn(m.a)}</span><span class="frm">${formDots(m.f.a.slice(0, 5).map(x => x.r).reverse())}</span></div>
          </div>
        </div>
        <div class="dtabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${dtab === k}" class="${dtab === k ? 'on' : ''}" data-dtab="${k}">${l}</button>`).join('')}</div>
      </div>${body}`;
  }
  // ---------- basketbol: mac detayi ----------
  function bbTableHtml(hl) {
    const T = BB.tables || { all: BB.table }, rows = T[ttab] || T.all || [];
    if (!rows.length) return `<div class="empty">${t('no_table')}</div>`;
    return `${BB.tables ? `<div class="seg" role="tablist">${['all', 'home', 'away'].map(k => `<button class="${ttab === k ? 'on' : ''}" data-ttab="${k}">${t('t_' + k)}</button>`).join('')}</div>` : ''}
      <div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th class="tn">${t('th_team')}</th><th>${t('th_p')}</th><th>${t('th_w')}</th><th>${t('th_l')}</th><th title="${t('c_wpct')}">%</th><th>${t('th_pf')}</th><th>${t('th_pa')}</th><th>${t('th_gd')}</th><th>${t('th_form')}</th></tr></thead><tbody>
      ${rows.map((r, i) => { const df = r.pf - r.pa; return `<tr class="${hl && hl.includes(r.t) ? 'hl' : ''}"><td>${i + 1}</td><td class="tn">${favBtn(r.t)}${logo(r.t)}<span>${esc(tn(r.t))}</span></td><td>${r.p}</td><td class="pts">${r.w}</td><td>${r.l}</td><td>${pct(r.w / r.p)}</td><td>${r.pf.toFixed(1)}</td><td>${r.pa.toFixed(1)}</td><td>${df > 0 ? '+' : ''}${df.toFixed(1)}</td><td><span class="fr">${formDots(r.f)}</span></td></tr>`; }).join('')}
      </tbody></table></div>`;
  }
  function commentsBB(m) {
    const p = m.p, out = [], H = tn(m.h), A = tn(m.a), f1 = n => n.toFixed(1), L = RL();
    if (Math.abs(p.p1 - p.p2) >= .12) out.push(fmt(t('x_fav'), { t: p.p1 > p.p2 ? H : A, p: pct(Math.max(p.p1, p.p2)) }));
    else out.push(fmt(t('x_even'), { a: pct(p.p1), b: pct(p.p2) }));
    if (p.margin != null && Math.abs(p.margin) >= 1) out.push(fmt(t('bx_margin'), { t: p.margin > 0 ? H : A, x: f1(Math.abs(p.margin)) }));
    const rows = (BB.tables || { all: BB.table }).all || [], ra = rows.findIndex(r => r.t === m.h) + 1, rb = rows.findIndex(r => r.t === m.a) + 1;
    if (ra && rb) out.push(fmt(t('x_rank'), { a: H, ra, b: A, rb }));
    const st = m.st || {};
    if (st.h && st.h.p) out.push(fmt(t('bx_home'), { t: H, n: st.h.p, w: st.h.w, l: st.h.l, pf: f1(st.h.pf / st.h.p), pa: f1(st.h.pa / st.h.p) }));
    if (st.a && st.a.p) out.push(fmt(t('bx_away'), { t: A, n: st.a.p, w: st.a.w, l: st.a.l, pf: f1(st.a.pf / st.a.p), pa: f1(st.a.pa / st.a.p) }));
    [[H, m.f.h], [A, m.f.a]].forEach(([nm, f]) => {
      const l5 = f.slice(0, 5); if (!l5.length) return;
      out.push(fmt(t('bx_form'), { n: l5.length, t: nm, w: l5.filter(x => x.r === 'W').length, f: l5.map(x => L[x.r].slice(0, 1)).reverse().join('-') }));
    });
    if (p.po != null) out.push(fmt(t(p.po >= .5 ? 'bx_total_hi' : 'bx_total_lo'), { x: f1(p.total), l: m.line, p: pct(p.po >= .5 ? p.po : 1 - p.po) }));
    if (m.h2h.length) {
      let w = 0, l = 0;
      m.h2h.forEach(g => { const hg = g.h === m.h ? g.hs : g.as, ag = g.h === m.h ? g.as : g.hs; if (hg > ag) w++; else l++; });
      out.push(fmt(t('bx_h2h'), { n: m.h2h.length, a: H, w, b: A, l }));
    }
    [[H, m.pl.h], [A, m.pl.a]].forEach(([nm, pl]) => { const top = (pl || []).find(x => x.k === 'pts'); if (top) out.push(fmt(t('bx_lead'), { t: nm, p: top.n, v: top.v })); });
    [[H, (m.inj || {}).h], [A, (m.inj || {}).a]].forEach(([nm, inj]) => { if (inj && inj.length) out.push(fmt(t('bx_inj'), { t: nm, n: inj.length, names: inj.slice(0, 3).map(x => x.n).join(', ') + (inj.length > 3 ? '…' : '') })); });
    return out;
  }
  function tabPredBB(m) {
    const p = m.p, tp = tipOf(m), st = m.st || {}, ts_ = m.ts || { h: {}, a: {} };
    const z = { p: 0, w: 0, l: 0, pf: 0, pa: 0 }, sh = st.h || z, sa = st.a || z, ha = st.ha || z, aa = st.aa || z;
    const av = (v, n) => (n ? (v / n).toFixed(1) : '-');
    const cmpRow = (a, l, b) => (a == null && b == null ? '' : `<tr><td>${esc(a == null ? '-' : a)}</td><td>${l}</td><td>${esc(b == null ? '-' : b)}</td></tr>`);
    const tsRow = (k, l, suf) => cmpRow(ts_.h[k] != null ? ts_.h[k] + (suf || '') : null, l, ts_.a[k] != null ? ts_.a[k] + (suf || '') : null);
    const mg = p.margin != null ? `${esc(ts(p.margin >= 0 ? m.h : m.a))} +${Math.abs(p.margin).toFixed(1)}` : '–';
    return `
    <div class="card sec">
      <h2>${t('pred')} ${srcBadge('model')}</h2>
      <div class="predbox">
        <div class="pscore"><small>${t('pred_score')}</small><b>${p.score[0]} - ${p.score[1]}</b><i>${t('bb_total')}: ${p.total}</i></div>
        <div>
          ${pbar(p)}
          <div class="plabels"><span>1 · ${esc(ts(m.h))}</span><span>2 · ${esc(ts(m.a))}</span></div>
          <div class="kpis">
            <div class="kpi"><small>${t('bb_margin')}</small><b>${mg}</b></div>
            <div class="kpi"><small>${t('bb_exp_total')}</small><b>${p.total}</b></div>
            <div class="kpi"><small>${t('over')} ${m.line}</small><b>${p.po != null ? pct(p.po) + '%' : '–'}</b></div>
            <div class="kpi"><small>${t('under')} ${m.line}</small><b>${p.po != null ? pct(1 - p.po) + '%' : '–'}</b></div>
          </div>
        </div>
      </div>
      <div class="tip" style="margin-top:14px">
        <div><div class="lbl">${t('tip')}</div><div class="what">${esc(mkLabel(tp.k, m))}</div>${agChips(m.tip, true)}</div>
        <div><div class="lbl">${t('confidence')} · ${pct(tp.p)}%</div>${stars(tp.stars)}</div>
        ${ob(m, tp.k)}
      </div>
    </div>
    <div class="grid2">
      <div class="card sec"><h2>${t('ms')} ${srcBadge(m.src)}</h2><div class="og c2">${ob(m, '1')}${ob(m, '2')}</div></div>
      <div class="card sec"><h2>${t('bb_total')} ${m.line} ${srcBadge(m.src)}</h2><div class="og c2">${ob(m, 'BU')}${ob(m, 'BO')}</div></div>
    </div>
    <div class="card sec"><h2>${t('commentary')}</h2><ul class="cmt">${commentsBB(m).map(c => `<li>${esc(c)}</li>`).join('')}</ul><p class="note">${t('foot_disc')}</p></div>
    <div class="card sec"><h2>${t('compare')}</h2>
      <table class="cmp"><thead><tr><th>${esc(ts(m.h))}</th><th></th><th>${esc(ts(m.a))}</th></tr></thead><tbody>
        ${cmpRow(`${ha.w}-${ha.l}`, t('c_wl_all'), `${aa.w}-${aa.l}`)}
        ${cmpRow(`${sh.w}-${sh.l}`, t('home_rec') + ' / ' + t('away_rec'), `${sa.w}-${sa.l}`)}
        ${cmpRow(av(ha.pf, ha.p), t('c_pf'), av(aa.pf, aa.p))}
        ${cmpRow(av(ha.pa, ha.p), t('c_pa'), av(aa.pa, aa.p))}
        ${tsRow('fg', t('c_fg'), '%')}${tsRow('tp', t('c_tp'), '%')}${tsRow('reb', t('c_reb'))}${tsRow('ast', t('c_ast'))}${tsRow('to', t('c_to'))}${tsRow('l10', t('c_l10'))}${tsRow('strk', t('c_strk'))}
      </tbody></table></div>${aiMatchBlock(m)}
    <p class="note">${t('bb_note')}</p>`;
  }
  function tabPlayersBB(m) {
    const inj = m.inj || { h: [], a: [] };
    const st = s => { const k = 'inj_' + String(s || '').toLowerCase().replace(/[^a-z]/g, ''); return t(k) !== k ? t(k) : s; };
    const one = (id, pl, ij) => `<div class="card sec"><div class="sqhead">${logo(id)} ${esc(tn(id))}</div>
      <h2>${t('bb_leaders')}</h2>
      ${pl && pl.length ? `<div class="tblwrap"><table class="tbl pls"><tbody>${pl.map(x => `<tr><td class="tn"><span class="jr">${esc(x.j || '–')}</span><span>${esc(x.n)}</span><small class="mut">${esc(x.p)}</small></td><td class="mut">${t('lead_' + x.k)}</td><td class="pts">${esc(x.v)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="mut">${t('bb_pl_none')}</div>`}
      <h2 style="margin-top:14px">${t('bb_inj')}</h2>
      ${ij && ij.length ? `<ul class="outl">${ij.map(x => `<li class="${/out/i.test(x.s) ? 'red' : 'absent'}"><span><b>${esc(x.n)}</b> <small>${esc(x.p)} — ${esc(st(x.s))}${x.t ? ' · ' + esc(x.t) : ''}</small></span></li>`).join('')}</ul>` : `<div class="mut">${t('no_absent')}</div>`}
    </div>`;
    return `<div class="grid2">${one(m.h, m.pl.h, inj.h)}${one(m.a, m.pl.a, inj.a)}</div><p class="note">${t('bb_pl_note')}</p>`;
  }
  function viewMatchBB(m) {
    const TABS = [['an', '🔎 ' + t('ax_tab')], ['pred', t('pred')], ['odds', t('odds')], ['table', t('standings')], ['form', t('formh2h')], ['players', t('players')]];
    if (!TABS.some(x => x[0] === dtab)) dtab = 'pred';
    let body;
    if (dtab === 'pred') body = tabPredBB(m);
    else if (dtab === 'an') body = tabAnalysisBB(m);
    else if (dtab === 'odds') body = `<div class="card sec"><h2>${t('ms')} ${srcBadge(m.src)}</h2><div class="og c2">${ob(m, '1')}${ob(m, '2')}</div></div>
      <div class="card sec"><h2>${t('bb_total')} ${m.line} ${srcBadge(m.src)}</h2><div class="og c2">${ob(m, 'BU')}${ob(m, 'BO')}</div></div><p class="note">${t('bb_note')}</p>`;
    else if (dtab === 'table') body = `<div class="card sec">${bbTableHtml([m.h, m.a])}</div>`;
    else if (dtab === 'form') body = tabForm(m);
    else body = tabPlayersBB(m);
    return `${backLink('#/basketbol')}
      <div class="card" style="overflow:hidden">
        <div class="hero">
          <div class="meta">${badge('nba')} NBA · ${dayLabel(dayKey(m.d))} · ${timeOf(m.d)}${m.v ? ' · ' + esc(m.v) : ''}</div>
          <div class="vs">
            <div class="side-t">${logo(m.h)}<span>${esc(tn(m.h))} ${favBtn(m.h)}</span><span class="frm">${formDots(m.f.h.slice(0, 5).map(x => x.r).reverse())}</span></div>
            <div class="mid" data-lvh="${m.id}">${timeOf(m.d)}<small>${shortDate(m.d)}</small></div>
            <div class="side-t">${logo(m.a)}<span>${esc(tn(m.a))} ${favBtn(m.a)}</span><span class="frm">${formDots(m.f.a.slice(0, 5).map(x => x.r).reverse())}</span></div>
          </div>
        </div>
        <div class="dtabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${dtab === k}" class="${dtab === k ? 'on' : ''}" data-dtab="${k}">${l}</button>`).join('')}</div>
      </div>${body}`;
  }
  const srcNote = m => (m.src === 'model' ? t('src_note_m') : fmt(t('src_note_s'), { s: srcName(m.src) }));

  function comments(m) {
    const p = m.p, out = [], f2 = n => n.toFixed(2), H = tn(m.h), A = tn(m.a);
    if (Math.abs(p.p1 - p.p2) >= .12) out.push(fmt(t('x_fav'), { t: p.p1 > p.p2 ? H : A, p: pct(Math.max(p.p1, p.p2)) }));
    else out.push(fmt(t('x_even'), { a: pct(p.p1), b: pct(p.p2) }));
    const tb = D.tables[m.lg];
    if (tb) {
      const ra = tb.all.findIndex(r => r.t === m.h) + 1, rb = tb.all.findIndex(r => r.t === m.a) + 1;
      if (ra && rb) out.push(fmt(t('x_rank'), { a: H, ra, b: A, rb }));
    }
    const sh = m.st.h, sa = m.st.a;
    if (sh.p) out.push(fmt(t('x_home'), { t: H, n: sh.p, w: sh.w, d: sh.d, l: sh.l, gf: f2(sh.gf / sh.p), ga: f2(sh.ga / sh.p) }));
    if (sa.p) out.push(fmt(t('x_away'), { t: A, n: sa.p, w: sa.w, d: sa.d, l: sa.l, gf: f2(sa.gf / sa.p), ga: f2(sa.ga / sa.p) }));
    const L = RL();
    [[H, m.f.h], [A, m.f.a]].forEach(([nm, f]) => {
      const l5 = f.slice(0, 5); if (!l5.length) return;
      const pts = l5.reduce((s, x) => s + (x.r === 'W' ? 3 : x.r === 'D' ? 1 : 0), 0);
      out.push(fmt(t('x_form'), { n: l5.length, t: nm, pts, f: l5.map(x => L[x.r].slice(0, 1)).reverse().join('-') }));
    });
    const xg = f2(p.lh + p.la);
    out.push(p.o25 >= .5 ? fmt(t('x_goals_hi'), { x: xg, p: pct(p.o25) }) : fmt(t('x_goals_lo'), { x: xg, p: pct(1 - p.o25) }));
    out.push(fmt(t('x_btts'), { p: pct(p.btts) }));
    if (m.h2h.length) {
      let w = 0, d = 0, l = 0;
      m.h2h.forEach(g => { const hg = g.h === m.h ? g.hs : g.as, ag = g.h === m.h ? g.as : g.hs; if (hg > ag) w++; else if (hg < ag) l++; else d++; });
      out.push(fmt(t('x_h2h'), { n: m.h2h.length, a: H, w, b: A, l, d }));
    }
    [[H, m.pl.h], [A, m.pl.a]].forEach(([nm, pl]) => { const top = (pl || [])[0]; if (top && top.g >= 2) out.push(fmt(t('x_scorer'), { t: nm, p: top.n, g: top.g, ap: top.ap })); });
    [[H, m.sq.h], [A, m.sq.a]].forEach(([nm, sq]) => { if (sq && sq.out.length) out.push(fmt(t('x_abs'), { t: nm, n: sq.out.length })); });
    return out;
  }

  function tabPred(m) {
    const p = m.p, tp = tipOf(m), sh = m.st.h, sa = m.st.a;
    const av = (v, n) => (n ? (v / n).toFixed(2) : '-');
    const pc = (v, n) => (n ? pct(v / n) + '%' : '-');
    const cmpRow = (a, l, b) => `<tr><td>${a}</td><td>${l}</td><td>${b}</td></tr>`;
    return `
    <div class="card sec">
      <h2>${t('pred')} ${srcBadge('model')}</h2>
      <div class="predbox">
        <div class="pscore"><small>${t('pred_score')}</small><b>${p.score[0]} - ${p.score[1]}</b><i>${t('pred_ht')}: ${p.ht[0]} - ${p.ht[1]}</i></div>
        <div>
          ${pbar(p)}
          <div class="plabels"><span>1 · ${esc(ts(m.h))}</span><span>X · ${t('draw')}</span><span>2 · ${esc(ts(m.a))}</span></div>
          <div class="kpis">
            <div class="kpi"><small>${t('xg')}</small><b>${p.lh.toFixed(2)} – ${p.la.toFixed(2)}</b></div>
            <div class="kpi"><small>${t('over')} 2.5</small><b>${pct(p.o25)}%</b></div>
            <div class="kpi"><small>${t('under')} 2.5</small><b>${pct(1 - p.o25)}%</b></div>
            <div class="kpi"><small>${t('btts')}</small><b>${pct(p.btts)}%</b></div>
          </div>
        </div>
      </div>
      <div class="tip" style="margin-top:14px">
        <div><div class="lbl">${t('tip')}</div><div class="what">${esc(mkLabel(tp.k))}</div></div>
        <div><div class="lbl">${t('confidence')} · ${pct(tp.p)}%</div>${stars(tp.stars)}</div>
        ${ob(m, tp.k)}
      </div>
    </div>
    ${m.xp ? `<div class="card sec"><h2>${t('iy_res')} <small class="mut">${t('pred_ht')}: ${p.ht[0]} - ${p.ht[1]}</small></h2>
      ${pbar({ p1: m.xp.iy[0], px: m.xp.iy[1], p2: m.xp.iy[2] })}<div class="plabels"><span>1</span><span>X</span><span>2</span></div>
      <div class="hfg num">${HF_L.map((l, i) => `<span class="${m.xp.hf[i] === Math.max(...m.xp.hf) ? 'top' : ''}"><small>${l}</small><b>${pct(m.xp.hf[i])}%</b></span>`).join('')}</div></div>` : ''}
    <div class="grid2">
      <div class="card sec"><h2>${t('likely_scores')}</h2><div class="scores num">${p.top.map(s => `<span>${s[0]} - ${s[1]}<small>${(s[2] * 100).toFixed(1)}%</small></span>`).join('')}</div></div>
      <div class="card sec"><h2>${t('ms')} ${srcBadge(m.src)}</h2><div class="og c3">${ob(m, '1')}${ob(m, 'X')}${ob(m, '2')}</div><p class="note">${srcNote(m)}</p></div>
    </div>
    <div class="card sec"><h2>${t('commentary')}</h2><ul class="cmt">${comments(m).map(c => `<li>${esc(c)}</li>`).join('')}</ul><p class="note">${t('foot_disc')}</p></div>
    <div class="card sec"><h2>${t('compare')}</h2>
      <table class="cmp"><thead><tr><th>${esc(ts(m.h))} · ${t('home_rec')}</th><th></th><th>${esc(ts(m.a))} · ${t('away_rec')}</th></tr></thead><tbody>
        ${cmpRow(sh.p, t('c_played'), sa.p)}
        ${cmpRow(`${sh.w}-${sh.d}-${sh.l}`, t('c_wdl'), `${sa.w}-${sa.d}-${sa.l}`)}
        ${cmpRow(av(sh.gf, sh.p), t('c_gf'), av(sa.gf, sa.p))}
        ${cmpRow(av(sh.ga, sh.p), t('c_ga'), av(sa.ga, sa.p))}
        ${cmpRow(sh.cs, t('c_cs'), sa.cs)}
        ${cmpRow(pc(sh.o25, sh.p), t('c_o25'), pc(sa.o25, sa.p))}
        ${cmpRow(pc(sh.btts, sh.p), t('c_btts'), pc(sa.btts, sa.p))}
      </tbody></table></div>${aiMatchBlock(m)}`;
  }
  function tabOdds(m) {
    const grp = (title, ks, cols, src) => `<div class="card sec"><h2>${title} ${srcBadge(src)}</h2><div class="og c${cols}">${ks.map(k => ob(m, k)).join('')}</div></div>`;
    const ss = m.ss || { ms: m.src, dc: m.src === 'bet365' ? 'bet365' : 'model', ou25: m.ou || 'model', ou15: 'model', ou35: 'model', kg: 'model' };
    return grp(t('ms'), ['1', 'X', '2'], 3, ss.ms) + grp(t('dc'), ['1X', '12', 'X2'], 3, ss.dc)
      + grp(t('ou') + ' 2.5', ['U2.5', 'O2.5'], 2, ss.ou25)
      + grp(t('ou') + ' 1.5', ['U1.5', 'O1.5'], 2, ss.ou15)
      + grp(t('ou') + ' 3.5', ['U3.5', 'O3.5'], 2, ss.ou35)
      + grp(t('btts'), ['KGV', 'KGY'], 2, ss.kg)
      + xoGroups(m, true)
      + `<p class="note">${srcNote(m)}${m.xo ? ' ' + t('x_info') : ''}</p>`;
  }

  function tabForm(m) {
    const L = RL();
    const fl = (id, f) => `<div class="card sec"><h2>${logo(id)} ${esc(tn(id))} · ${t('last_matches')}</h2><div class="gl">${f.length ? f.map(g =>
      `<div class="g"><span class="f ${g.r}">${esc(L[g.r].slice(0, 1))}</span><span class="mut num">${shortDate(g.d)}</span>
       <span class="o">${logo(g.o, 'sm')} ${g.ha === 'H' ? '' : '<span class="mut">@</span> '}${esc(tn(g.o))} <small class="mut">${esc(ln(g.lg))}</small></span><span class="sc">${g.gf} - ${g.ga}</span></div>`).join('') : `<div class="empty">–</div>`}</div></div>`;
    const h2h = m.h2h.length ? `<div class="gl h2h">${m.h2h.map(g => `<div class="g"><span class="mut num">${shortDate(g.d)}.${g.d.slice(2, 4)}</span><span class="o">${esc(tn(g.h))} ${logo(g.h, 'sm')}</span><span class="sc">${g.hs} - ${g.as}</span><span class="o">${logo(g.a, 'sm')} ${esc(tn(g.a))}</span></div>`).join('')}</div>` : `<div class="empty">${t(m.sport === 'bb' ? 'bb_no_h2h' : 'no_h2h')}</div>`;
    return `<div class="grid2">${fl(m.h, m.f.h)}${fl(m.a, m.f.a)}</div><div class="card sec"><h2>${t('h2h')}</h2>${h2h}</div>`;
  }

  function prank(p) {
    const a = (p.p || '').toUpperCase();
    if (a === 'G' || a === 'GK') return 0;
    if (a.startsWith('DM')) return 2;
    if (/^(CD|CB|LB|RB|SW|D|LWB|RWB)/.test(a)) return 1;
    if (a.startsWith('AM') || /^(LW|RW)$/.test(a)) return 4;
    if (/^(CM|LM|RM|M)/.test(a)) return 3;
    if (/^(F|CF|S|LF|RF)/.test(a)) return 5;
    return 3;
  }
  const pside = p => { const a = (p.p || '').toUpperCase(); return /-L$/.test(a) || /^L/.test(a) ? 0 : /-R$/.test(a) || /^R/.test(a) ? 2 : 1; };
  const pname = n => (n.length <= 13 ? n : n.split(' ').slice(-1)[0]);
  function pitch(sq) {
    const xi = sq.xi.slice().sort((a, b) => prank(a) - prank(b));
    const nums = (sq.f || '').split('-').map(Number).filter(n => n > 0);
    let rows = [];
    if (xi.length === 11 && nums.reduce((s, n) => s + n, 0) === 10) {
      let i = 0; [1].concat(nums).forEach(n => { rows.push(xi.slice(i, i + n)); i += n; });
    } else {
      const g = {}; xi.forEach(p => { const r = Math.min(prank(p), 5); (g[r] = g[r] || []).push(p); });
      rows = Object.keys(g).sort().map(k => g[k]);
    }
    return `<div class="pitch">${rows.map(r => `<div class="prow">${r.sort((a, b) => pside(a) - pside(b)).map(p => `<div class="pl"><i>${esc(p.j)}</i><span>${esc(pname(p.n))}</span></div>`).join('')}</div>`).join('')}</div>`;
  }
  function tabSquad(m) {
    const one = (id, sq) => {
      if (!sq) return `<div class="card sec"><div class="sqhead">${logo(id)} ${esc(tn(id))}</div><div class="empty">${t('no_lineup')}</div></div>`;
      return `<div class="card sec"><div class="sqhead">${logo(id)} ${esc(tn(id))}<small class="num">${esc(sq.f)}</small></div>
        ${pitch(sq)}
        <p class="note">${t('probable_note')}: ${esc(tn(sq.o))}, ${shortDate(sq.d)}</p>
        <h2 style="margin-top:14px">${t('absent')}</h2>
        ${sq.out.length ? `<ul class="outl">${sq.out.map(o => `<li class="${o.w}"><span><b>${esc(o.n)}</b> <small>— ${t('w_' + o.w)}</small></span></li>`).join('')}</ul>` : `<div class="mut">${t('no_absent')}</div>`}
      </div>`;
    };
    return `<div class="pagehead" style="margin:14px 0 0"><h1 style="font-size:16px">${t('probable')}</h1></div>
      <div class="grid2">${one(m.h, m.sq.h)}${one(m.a, m.sq.a)}</div><p class="note">${t('absent_note')}</p>`;
  }
  function tabPlayers(m) {
    const one = (id, pl) => `<div class="card sec"><div class="sqhead">${logo(id)} ${esc(tn(id))}</div>${pl && pl.length ? `<div class="tblwrap"><table class="tbl pls"><thead><tr>
      <th class="tn">${t('ph_player')}</th><th title="${t('c_played')}">${t('ph_ap')}</th><th>${t('ph_g')}</th><th>${t('ph_a')}</th><th>${t('ph_sh')}</th><th title="${t('ph_yc_l')}"><span class="card-y"></span></th><th title="${t('ph_rc_l')}"><span class="card-r"></span></th></tr></thead><tbody>
      ${pl.map(p => `<tr><td class="tn"><span class="jr">${esc(p.j || '–')}</span><span>${esc(p.n)}</span><small class="mut">${esc(p.p)}</small></td><td>${p.ap}</td><td class="pts">${p.g}</td><td>${p.a}</td><td>${p.sh}</td><td>${p.yc}</td><td>${p.rc}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">${t('pl_none')}</div>`}</div>`;
    return `<div class="pagehead" style="margin:14px 0 0"><h1 style="font-size:16px">${t('pl_title')}</h1><small>${esc(ln(m.lg))} · ${t('pl_note')}</small></div>
      <div class="grid2">${one(m.h, m.pl.h)}${one(m.a, m.pl.a)}</div>`;
  }

  // ---------- puan durumu ----------
  function tableHtml(lg, hl) {
    const tb = D.tables[lg];
    if (!tb) return `<div class="empty">${t('no_table')}</div>`;
    const rows = tb[ttab] || tb.all;
    return `<div class="seg" role="tablist">${['all', 'home', 'away'].map(k => `<button class="${ttab === k ? 'on' : ''}" data-ttab="${k}">${t('t_' + k)}</button>`).join('')}</div>
      <div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th class="tn">${t('th_team')}</th><th>${t('th_p')}</th><th>${t('th_w')}</th><th>${t('th_d')}</th><th>${t('th_l')}</th><th>${t('th_g')}</th><th>${t('th_gd')}</th><th>${t('th_pts')}</th><th>${t('th_form')}</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${hl && hl.includes(r.t) ? 'hl' : ''}"><td>${i + 1}</td><td class="tn">${favBtn(r.t)}${logo(r.t)}<span>${esc(tn(r.t))}</span></td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}:${r.ga}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td class="pts">${r.pts}</td><td><span class="fr">${formDots(r.f)}</span></td></tr>`).join('')}
      </tbody></table></div>`;
  }
  function viewTables() {
    if (flt.sp === 'bb') return `<div class="pagehead"><h1>${t('tables')}</h1></div>${spSeg()}
      <div class="card sec" style="margin-top:0"><h2>${badge('nba')} ${t('bb_table')}</h2>${bbTableHtml()}</div>`;
    const has = D.leagues.filter(l => D.tables[l.id]);
    const lg = flt.lg !== 'all' && D.tables[flt.lg] ? flt.lg : (has[0] || {}).id;
    return `<div class="pagehead"><h1>${t('tables')}</h1></div>${spSeg()}
      ${strip(has.map(l => `<button class="chip ${lg === l.id ? 'on' : ''}" data-lg="${l.id}">${esc(ln(l.id))}</button>`).join(''))}
      <div class="card sec" style="margin-top:0">${lg ? `<h2>${badge(lg)} ${esc(ln(lg))}</h2>` + tableHtml(lg) : `<div class="empty">${t('no_table')}</div>`}</div>`;
  }

  // ---------- sonuclar ----------
  const resRow = (g, withDate) => `<div class="g"><span class="mut num">${withDate ? shortDate(g.d) : timeOf(g.d)}</span><span class="o">${esc(tn(g.h))} ${logo(g.h, 'sm')}</span><span class="sc">${g.hs} - ${g.as}</span><span class="o">${logo(g.a, 'sm')} ${esc(tn(g.a))}</span></div>`;
  const predOf = m => {
    if (!m.p) return null;
    const tp = tipOf(m); return { sc: m.p.score, k: tp.k, o: tp.o, ln: m.line };
  };
  function finRow(r, bb) {
    const pr = r.pr, hw = r.hs > r.as, aw = r.as > r.hs;
    let pred = `<span class="mut fpn">${t('f_nopred')}</span>`;
    if (pr) {
      const tipOk = wins(pr.k, r.hs, r.as, pr.ln);
      const scOk = bb ? (pr.sc[0] > pr.sc[1]) === (r.hs > r.as) : pr.sc[0] === r.hs && pr.sc[1] === r.as;
      const lbl = mkLabel(pr.k, null, pr.ln);
      pred = `<span class="fpl ${scOk ? 'ok' : ''}">${t('f_pred')} <b>${pr.sc[0]}-${pr.sc[1]}</b>${scOk ? ' ✓' : ''}</span><span class="fpt ${tipOk ? 'ok' : 'no'}">${esc(lbl)} ${tipOk ? '✓' : '✗'}</span>`;
    }
    const lg = bb ? '<span class="cc">NBA</span><span>NBA</span>' : `${badge(r.lg)}<span>${esc(ln(r.lg))}</span>`;
    return `<div class="frow"><div class="mtime num">${timeOf(r.d)}<small>${t('lv_ft')}</small></div>
      <div class="mteams"><div class="mlg">${lg}</div>
        <div class="tm ${hw ? 'w' : ''}">${logo(r.h)}<span>${esc(tn(r.h))}</span>${favMark(r.h)}<b class="ls">${r.hs}</b></div>
        <div class="tm ${aw ? 'w' : ''}">${logo(r.a)}<span>${esc(tn(r.a))}</span>${favMark(r.a)}<b class="ls">${r.as}</b></div></div>
      <div class="fp">${pred}</div></div>`;
  }
  function viewResults() {
    const bb = flt.sp === 'bb', src = bb ? BB.results : D.results, known = new Set(src.map(r => r.id));
    const liveRes = liveCands(bb ? 'bb' : 'fb').filter(m => LIVE[m.id] && LIVE[m.id].fin && !known.has(m.id))
      .map(m => ({ id: m.id, lg: m.lg, d: m.d, h: m.h, a: m.a, hs: LIVE[m.id].hs, as: LIVE[m.id].as, pr: predOf(m) }));
    const all = liveRes.concat(src).filter(r => bb || lgOk(r));
    const days = [...new Set(all.map(r => dayKey(r.d)))].sort().reverse();
    const list = all;
    const sinceOk = r => !D.since || (D.since.length > 10 ? r.d >= D.since : dayKey(r.d) >= D.since);
    const nSince = list.filter(sinceOk).length, wp = list.filter(r => r.pr && sinceOk(r)), tipOk = wp.filter(r => wins(r.pr.k, r.hs, r.as, r.pr.ln)).length;
    const scOk = wp.filter(r => (bb ? (r.pr.sc[0] > r.pr.sc[1]) === (r.hs > r.as) : r.pr.sc[0] === r.hs && r.pr.sc[1] === r.as)).length;
    const A = (bb ? D.accbb : D.acc) || { n: 0 };
    let html = `<div class="pagehead"><h1>${t('results')}</h1><small>${t('fin_note')}</small></div>
      ${spSeg()}
      ${bb ? '' : lgChips(new Set(D.results.map(r => r.lg)), true)}`;
    if (!list.length) return html + `<div class="card empty">${t('nomatch')}</div>`;
    html += `<div class="card sec facc" style="margin-top:0"><h2>${t('fin_all')}${D.since ? ` <small class="mut">${fmt(t('fin_since'), { d: dayShort(D.since.length > 10 ? dayKey(D.since) : D.since) })}</small>` : ''}</h2><div class="kpis">
      <div class="kpi"><small>${t('c_played')}</small><b>${nSince}</b></div>
      <div class="kpi"><small>${t('f_tip')}</small><b style="color:var(--pri)">${wp.length ? tipOk + '/' + wp.length : '–'}</b></div>
      <div class="kpi"><small>${t(bb ? 'f_win' : 'f_sc')}</small><b style="color:var(--gold)">${wp.length ? scOk + '/' + wp.length : '–'}</b></div>
      ${!bb && A.n3 ? `<div class="kpi"><small>${t('f_sc3')}</small><b style="color:var(--gold)">${A.sc3}/${A.n3}</b></div>` : ''}
      <div class="kpi"><small>${t('fin_30')}</small><b>${A.n ? pct(A.tip / A.n) + '%' : '–'}</b></div></div></div>`;
    // tum gunler alt alta (en yeni ustte); uzun liste parca parca acilir
    const lim = !bb && flt.lg !== 'all' ? days.length : flt.rlim;
    days.slice(0, lim).forEach(dk => {
      const rs = list.filter(r => dayKey(r.d) === dk).sort(byDate);
      html += `<h2 class="dayhead">${dayLabel(dk)} <small>${rs.length} ${t('selections')}</small></h2><section class="card lgblock">${rs.map(r => finRow(r, bb)).join('')}</section>`;
    });
    const rest = days.slice(lim).reduce((n, dk) => n + list.filter(r => dayKey(r.d) === dk).length, 0);
    if (rest) html += `<button class="btn ghost more" data-act="rmore">${fmt(t('show_more'), { n: rest })}</button>`;
    return html;
  }


  // ---------- basketbol ----------
  function bbAgentCard() {
    const lim = Date.now() + 48 * 3600e3;
    const ms = BB.matches.filter(m => future(m) && new Date(m.d).getTime() <= lim && m.tip && m.tip.ag && m.tip.v >= 3)
      .sort((a, b) => b.tip.v - a.tip.v || b.tip.p - a.tip.p).slice(0, 6);
    if (!ms.length) return '';
    return `<div class="card tipc mc" style="margin-top:0;margin-bottom:14px"><div class="tipc-h"><b>🤖 ${t('agb_card')}</b><small>${t('agb_card_s')}</small></div>
      ${ms.map(m => `<div class="tipc-r"><a class="tt" href="#/mac/${m.id}">${pair(m.h, m.a, ts(m.h), ts(m.a))}<small>${shortDate(m.d)} ${timeOf(m.d)} · <b>${esc(mkLabel(m.tip.k, m))}</b> · ${t('confidence')} ${pct(m.tip.p)}%</small>${agChips(m.tip, true)}</a>${ob(m, m.tip.k)}</div>`).join('')}</div>`;
  }
  function viewBasketball() {
    const up = BB.matches.filter(future).sort(byDate);
    let html = `<div class="pagehead"><h1>${t('bb_title')}</h1></div>
      <div class="chips bbnav">${[['analiz', 'analysis'], ['puan', 'tables'], ['sonuclar', 'results']].map(([u, k]) => `<button class="chip" data-go="${u}">${t(k)} →</button>`).join('')}</div>
      <div id="livebox" data-sport="bb">${liveBox('bb')}</div>${bbAgentCard()}`;
    if (!up.length) html += `<div class="card empty">${t('bb_none')}</div>`;
    [...new Set(up.map(m => dayKey(m.d)))].sort().forEach(dk => {
      const ms = up.filter(m => dayKey(m.d) === dk);
      html += `<h2 class="dayhead">${dayLabel(dk)}</h2><section class="card lgblock"><div class="lghead"><span class="cc">NBA</span><span>NBA</span><span class="day">${ms.length} ${t('selections')}</span></div>
        <div class="mkhead bb"><span></span><span>${t('ms')}</span><span>${t('bb_total')}</span><span>${t('pred')}</span></div>
        ${ms.map(m => `<div class="mrow bb">
          <a class="minfo" href="#/mac/${m.id}"><div class="mtime num">${timeOf(m.d)}</div>
            <div class="mteams"><div class="tm">${logo(m.h)}<span>${esc(tn(m.h))}</span>${favMark(m.h)}</div><div class="tm">${logo(m.a)}<span>${esc(tn(m.a))}</span>${favMark(m.a)}</div></div></a>
          <div class="og c2 ms">${ob(m, '1')}${ob(m, '2')}</div>
          <div class="og c2 tot">${ob(m, 'BU')}${ob(m, 'BO')}</div>
          <a class="bbp num" href="#/mac/${m.id}" title="${t('detail')}" aria-label="${t('detail')}: ${esc(tn(m.h))} – ${esc(tn(m.a))}"><b>${m.p.score[0]} - ${m.p.score[1]}</b><small>1: ${pct(m.p.p1)}% · 2: ${pct(m.p.p2)}%</small><small class="bbd">${t('analysis')} →</small></a>
        </div>`).join('')}</section>`;
    });
    html += `<p class="note">${t('bb_note')}</p>`;
    if ((BB.table || []).length) html += `<div class="card sec"><h2>${t('bb_table')}</h2>${bbTableHtml()}</div>`;
    const rs = BB.results.slice(0, 12);
    if (rs.length) html += `<div class="card sec"><h2>${t('results')}</h2><div class="gl h2h">${rs.map(g => resRow(g, true)).join('')}</div></div>`;
    return html;
  }

  // ---------- kupon ----------
  const totalOdds = () => slip.reduce((p, s) => p * ((MATCH[s.m] || {}).o || {})[s.k], 1);
  function cleanSlip() {
    const n = slip.length;
    slip = slip.filter(s => MATCH[s.m] && MATCH[s.m].o[s.k] && future(MATCH[s.m]));
    if (slip.length !== n) LS.set('slip', slip);
    return n - slip.length;
  }
  const sideTip = () => (/^#\/mollamyrat/.test(location.hash) ? '' : tipCoupon());
  function renderSlip() {
    const n = slip.length, tot = n ? totalOdds() : 0;
    document.body.classList.toggle('hasslip', n > 0);
    $('slipbar').innerHTML = `<span class="n">${n}</span><span>${t('coupon')}</span><span class="o num">${tot.toFixed(2)}</span>`;
    const head = `<div class="sliphead"><span>${t('coupon')}</span><span class="badge">${n}</span>${n ? shareBtn('share-slip') : ''}<span class="type">${n ? (n === 1 ? t('single') : t('combo')) : ''}</span>${n ? `<button class="clr" data-act="clear">${t('clear')}</button>` : ''}<button class="x" data-act="close" aria-label="×">×</button></div>`;
    if (!n) { $('slip').innerHTML = `<div class="card bs">${head}<div class="empty">${t('slip_empty')}</div></div>${sideTip()}`; return; }
    // kompakt satirlar: ayni anda en az 10 mac gorunur; bedel/oyna alani altta sabit kalir
    $('slip').innerHTML = `<div class="card bs">${head}
      <div class="sels">${slip.map((s, i) => { const m = MATCH[s.m]; return `<div class="sel"><span class="no">${i + 1}</span><div class="sc">
        <div class="r1">${pair(m.h, m.a, ts(m.h), ts(m.a))}<b>${m.o[s.k].toFixed(2)}</b></div>
        <div class="r2">${esc(mkLabel(s.k, m))} · ${shortDate(m.d)} ${timeOf(m.d)}</div></div>
        <button class="rm" data-rm="${s.m}" aria-label="×">×</button></div>`; }).join('')}</div>
      <div class="slipbody">
        <div class="stk"><label for="stake">${t('stake')}</label><input id="stake" type="number" inputmode="decimal" min="${MIN_STAKE}" max="${MAX_STAKE}" step="1" value="${esc(stake)}"><span>${CUR}</span></div>
        <div class="quick">${[20, 50, 100, 250].map(v => `<button data-q="${v}">${v}</button>`).join('')}</div>
        <div class="sum"><span>${t('total_odds')}</span><b id="s-odds">${tot.toFixed(2)}</b></div>
        <div class="sum win"><span>${t('max_win')}</span><b id="s-win"></b></div>
        <div class="err" id="s-err" role="alert">${esc(slipErr)}</div>
        <button class="btn" data-act="play">${t('play')}</button>
        <button class="btn ghost svb" data-act="save-slip">☆ ${t('save_coupon')}</button>
        <div class="slipnote">${t('min_stake')}</div>
      </div></div>${sideTip()}`;
    updWin();
  }
  function updWin() {
    const el = $('s-win'); if (!el) return;
    el.textContent = money(Math.min((parseFloat(stake) || 0) * totalOdds(), MAX_WIN));
  }
  function syncObs() {
    document.querySelectorAll('.ob[data-m]').forEach(b => {
      const on = slip.some(s => s.m === b.dataset.m && s.k === b.dataset.k);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
  }
  function toggleSel(mid, k) {
    const i = slip.findIndex(s => s.m === mid);
    if (i >= 0 && slip[i].k === k) slip.splice(i, 1);
    else if (i >= 0) slip[i].k = k;
    else { if (slip.length >= MAX_SEL) return toast(t('max_sel')); slip.push({ m: mid, k }); }
    slipErr = '';
    LS.set('slip', slip);
    syncObs(); renderSlip();
  }
  const slipSels = () => slip.map(x => { const m = MATCH[x.m]; return { m: x.m, k: x.k, o: m.o[x.k], hi: m.h, ai: m.a, h: tn(m.h), a: tn(m.a), d: m.d, ln: m.line, lg: m.lg || 'nba' }; });
  let savingC = false;
  async function saveSlip() {
    if (!slip.length || savingC) return;
    if (!user) { document.body.classList.remove('slipopen'); toast(t('login_first_save')); location.hash = '#/profil'; return; }
    if (cleanSlip()) { slipErr = t('started'); syncObs(); return renderSlip(); }
    if (saved.length >= 100) return toast(t('saved_full'));
    const sc = { id: 'S' + Date.now().toString().slice(-9) + String(10 + Math.floor(Math.random() * 90)), ts: Date.now(),
      name: shortDate(Date.now()) + ' · ' + slip.length + ' ' + t('selections'), sels: slipSels() };
    if (SB) {
      savingC = true;
      const { error } = await SB.from('saved_coupons').insert({ id: sc.id, user_id: profile.id, name: sc.name, sels: sc.sels });
      savingC = false;
      if (error) return toast(/saved_limit/.test(error.message || '') ? t('saved_full') : sbErr(error));
    }
    saved.unshift(sc); saveUser();
    toast(t('saved_ok'));
  }
  function trackSaved() {
    saved.forEach(c => {
      let ch = false;
      c.sels.forEach(x => { const r = RES[x.m]; if (r && x.ok === undefined) { x.res = r.hs + '-' + r.as; x.ok = wins(x.k, r.hs, r.as, x.ln); ch = true; } });
      if (!ch) return;
      if (SB && profile) SB.from('saved_coupons').update({ sels: c.sels }).eq('id', c.id).then(() => { });
      else saveUser();
    });
  }
  async function delSaved(id) {
    if (!confirm(t('sv_confirm'))) return;
    if (SB) { const { error } = await SB.from('saved_coupons').delete().eq('id', id); if (error) return toast(sbErr(error)); }
    saved = saved.filter(c => c.id !== id); saveUser(); render();
  }
  function loadSaved(id) {
    const c = saved.find(x => x.id === id); if (!c) return;
    const ok = c.sels.filter(x => MATCH[x.m] && future(MATCH[x.m]) && MATCH[x.m].o[x.k]).slice(0, MAX_SEL);
    if (!ok.length) return toast(t('share_none'));
    slip = ok.map(x => ({ m: x.m, k: x.k })); LS.set('slip', slip); slipErr = '';
    toast(fmt(t('sv_loaded'), { n: ok.length }) + (ok.length < c.sels.length ? ' · ' + fmt(t('sv_skipped'), { n: c.sels.length - ok.length }) : ''));
    syncObs(); renderSlip();
    if (matchMedia('(max-width:860px)').matches) document.body.classList.add('slipopen');
  }
  let playing = false;
  async function play() {
    if (playing) return;
    if (!user) { document.body.classList.remove('slipopen'); toast(t('login_first')); location.hash = '#/profil'; return; }
    if (cleanSlip()) { slipErr = t('started'); syncObs(); return renderSlip(); }
    const st = Math.round((parseFloat(stake) || 0) * 100) / 100;
    if (st < MIN_STAKE) slipErr = t('min_stake');
    else if (st > MAX_STAKE) slipErr = t('max_stake');
    else if (st > balance) slipErr = t('no_balance');
    else slipErr = '';
    if (slipErr || !slip.length) return renderSlip();
    const tot = Math.round(totalOdds() * 100) / 100;
    const c = {
      id: 'A' + Date.now().toString().slice(-9) + String(10 + Math.floor(Math.random() * 90)), ts: Date.now(), stake: st, odds: tot,
      win: Math.min(Math.round(st * tot * 100) / 100, MAX_WIN), status: 'pending',
      sels: slipSels()
    };
    if (SB) {
      playing = true; slipErr = ''; renderSlip();
      const { data, error } = await SB.rpc('place_coupon', { p_id: c.id, p_stake: st, p_sels: c.sels });
      playing = false;
      if (error) { slipErr = sbErr(error); return renderSlip(); }
      balance = +data; c.win = Math.min(Math.round(st * c.odds * 100) / 100, MAX_WIN);
      coupons.unshift(c); slip = []; LS.set('slip', slip);
      document.body.classList.remove('slipopen');
      toast(`${t('played')} · ${c.id}`);
      if (location.hash === '#/kuponlarim') render(); else location.hash = '#/kuponlarim';
      return;
    }
    coupons.unshift(c); balance = Math.round((balance - st) * 100) / 100; slip = [];
    saveUser(); LS.set('slip', slip);
    document.body.classList.remove('slipopen');
    toast(`${t('played')} · ${c.id}`);
    if (location.hash === '#/kuponlarim') render(); else location.hash = '#/kuponlarim';
  }
  function dispStatus(c) {
    if (c.status !== 'pending') return c.status;
    if (c.sels.some(x => x.ok === false)) return 'lost';
    return c.sels.length && c.sels.every(x => x.ok === true) ? 'won_wait' : 'pending';
  }
  function settle() {
    trackSaved();
    if (SB) {
      coupons.forEach(c => c.sels.forEach(x => { const r = RES[x.m]; if (r && x.ok === undefined) { x.res = r.hs + '-' + r.as; x.ok = wins(x.k, r.hs, r.as, x.ln); } }));
      return;
    }
    let ch = false;
    coupons.forEach(c => {
      if (c.status !== 'pending') return;
      let all = true, lost = false;
      c.sels.forEach(s => {
        const r = RES[s.m];
        if (!r) { all = false; return; }
        s.res = r.hs + '-' + r.as; s.ok = wins(s.k, r.hs, r.as, s.ln);
        if (!s.ok) lost = true;
      });
      if (lost) { c.status = 'lost'; ch = true; }
      else if (all) { c.status = 'won'; balance = Math.round((balance + c.win) * 100) / 100; ch = true; }
    });
    if (ch) saveUser();
  }
  function viewCoupons() {
    if (!user) return `<div class="pagehead"><h1>${t('mycoupons')}</h1></div><div class="card empty">${t('login_need')}<br><br><a class="btn" style="max-width:260px;margin:0 auto" href="#/profil">${t('login_or')}</a></div>`;
    const nm = (s, side) => { const id = s[side + 'i']; return id && D.teams[id] ? tn(id) : s[side]; };
    let html = `<div class="pagehead"><h1>${t('mycoupons')}</h1></div>
      <div class="card cpn"><div class="cpn-h"><span class="mut">${t('demo_balance')}</span><b style="font-size:20px;color:var(--pri)" class="num">${money(balance)}</b>
      <button class="chip" style="margin-left:auto" data-act="resetbal">${t('reset_balance')}</button></div></div>`;
    const tab = flt.ctab === 'saved' ? 'saved' : 'played';
    html += `<div class="seg" role="tablist"><button class="${tab === 'played' ? 'on' : ''}" data-ctab="played">${t('played_t')} (${coupons.length})</button><button class="${tab === 'saved' ? 'on' : ''}" data-ctab="saved">☆ ${t('saved_t')} (${saved.length})</button></div>`;
    if (tab === 'saved') return html + (saved.length ? saved.map(c => savedCard(c, nm)).join('') : `<div class="card empty">${t('no_saved')}</div>`);
    if (!coupons.length) return html + `<div class="card empty">${t('no_coupons')}</div>`;
    return html + coupons.map(c => `<div class="card cpn">
      <div class="cpn-h"><b>${t('coupon_no')}: ${esc(c.id)}</b>${shareBtn('share-cpn', `data-cid="${esc(c.id)}"`)}<span class="st ${dispStatus(c) === 'won_wait' ? 'won' : dispStatus(c)}">${t(dispStatus(c))}</span><span class="mut num" style="margin-left:auto">${shortDate(c.ts)} ${timeOf(c.ts)}</span></div>
      ${c.sels.map(s => `<div class="row"><span class="rl">${pair(s.hi, s.ai, nm(s, 'h'), nm(s, 'a'))}<small class="mut">${esc(mkLabel(s.k, null, s.ln))} · ${shortDate(s.d)} ${timeOf(s.d)}${s.res ? ' · ' + esc(s.res) : ''}</small></span><span class="r ${s.ok === true ? 'ok' : s.ok === false ? 'no' : ''}">${s.o.toFixed(2)}</span></div>`).join('')}
      <div class="cpn-f"><span>${t('stake')}: <b>${money(c.stake)}</b></span><span>${t('total_odds')}: <b>${c.odds.toFixed(2)}</b></span><span>${t(c.status === 'won' ? 'payout' : 'max_win')}: <b>${money(c.win)}</b></span></div>
    </div>`).join('');
  }
  function savedCard(c, nm) {
    const ok = c.sels.filter(x => x.ok === true).length, no = c.sels.filter(x => x.ok === false).length;
    const st = no ? 'lost' : ok === c.sels.length ? 'won' : 'track';
    const tot = c.sels.reduce((p, x) => p * x.o, 1);
    const live = c.sels.filter(x => MATCH[x.m] && future(MATCH[x.m]) && MATCH[x.m].o[x.k]).length;
    return `<div class="card cpn sv">
      <div class="cpn-h"><b>☆ ${esc(c.name || '')}</b><span class="st ${st === 'track' ? 'pending' : st}">${t(st === 'track' ? 's_track' : st)}</span>${shareBtn('share-saved', `data-sid="${esc(c.id)}"`)}<span class="mut num" style="margin-left:auto">${shortDate(c.ts)} ${timeOf(c.ts)}</span></div>
      ${c.sels.map(x => `<div class="row"><span class="rl">${pair(x.hi, x.ai, nm(x, 'h'), nm(x, 'a'))}<small class="mut">${esc(mkLabel(x.k, null, x.ln))} · ${shortDate(x.d)} ${timeOf(x.d)}${x.res ? ' · ' + esc(x.res) : `<span data-lv="${esc(x.m)}" data-lk="${esc(x.k)}"${x.ln != null ? ` data-ll="${x.ln}"` : ''}></span>`}</small></span><span class="r ${x.ok === true ? 'ok' : x.ok === false ? 'no' : ''}">${(+x.o).toFixed(2)}</span></div>`).join('')}
      <div class="cpn-f"><span>${t('total_odds')}: <b>${tot.toFixed(2)}</b></span><span><b style="color:var(--pri)">${ok} ✓</b> · <b style="color:var(--red)">${no} ✗</b> · ${c.sels.length - ok - no} •</span><span>${fmt(t('tipc_min'), { s: MIN_STAKE })}: <b>${money(Math.min(MIN_STAKE * tot, MAX_WIN))}</b></span></div>
      <div class="sv-a">${live ? `<button class="btn" data-act="sv-load" data-sid="${esc(c.id)}">${t('sv_play')} (${live})</button>` : ''}<button class="btn ghost" data-act="sv-del" data-sid="${esc(c.id)}">${t('sv_del')}</button></div>
    </div>`;
  }
  function shareSaved(id) {
    const c = saved.find(x => x.id === id); if (!c) return;
    const nm = (x, side) => { const i = x[side + 'i']; return i && D.teams[i] ? tn(i) : x[side]; };
    const tot = c.sels.reduce((p, x) => p * x.o, 1);
    shareCoupon('☆ ' + (c.name || t('saved_t')), shortDate(c.ts) + ' ' + timeOf(c.ts),
      c.sels.map(x => ({ teams: nm(x, 'h') + ' – ' + nm(x, 'a'), sub: mkLabel(x.k, null, x.ln) + ' · ' + shortDate(x.d) + ' ' + timeOf(x.d), o: (+x.o).toFixed(2), mark: mark(x.ok) })),
      { tot: tot.toFixed(2), stake: money(MIN_STAKE), win: money(Math.min(MIN_STAKE * tot, MAX_WIN)) }, c.sels.map(x => ({ m: x.m, k: x.k })));
  }
  const viewRules = () => `<div class="pagehead"><h1>${t('r_title')}</h1></div><div class="card rules"><ol>${t('r_items').map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>`;

  // ---------- canli skor (tarayicidan dogrudan, dakikada bir) ----------
  const LIVE = {};            // id -> { s: 'in' | 'post', hs, as, c: saat, fin: sonuclandirilabilir }
  const RECENT = D.recent || [];
  const tsLast = {};
  const isBB = m => m.sport === 'bb';
  function liveCands(sport) {
    const now = Date.now(), seen = new Set(), out = [];
    D.matches.concat(RECENT, BB.matches).forEach(m => {
      if (seen.has(m.id)) return; seen.add(m.id);
      if (sport && (sport === 'bb') !== isBB(m)) return;
      const t0 = new Date(m.d).getTime();
      if (t0 <= now + 30e3 && t0 > now - (isBB(m) ? 4.5 : 3.3) * 3600e3) out.push(m);
    });
    return out.sort(byDate);
  }
  function liveRow(m) {
    const l = LIVE[m.id], on = l && l.s === 'in';
    const clock = !l ? (Date.now() - new Date(m.d).getTime() > 15 * 60e3 ? t('lv_nodata') : t('lv_started')) : l.s === 'post' ? t('lv_ft') : (l.c || t('live'));
    const lg = isBB(m) ? '<span class="cc">NBA</span><span>NBA</span>' : `${badge(m.lg)}<span>${esc(ln(m.lg))}</span>`;
    const inner = `<div class="mtime num"><b class="lclk ${on ? 'on' : ''}">${esc(clock)}</b><small>${timeOf(m.d)}</small></div>
      <div class="mteams"><div class="mlg">${lg}</div>
        <div class="tm">${logo(m.h)}<span>${esc(tn(m.h))}</span><b class="ls ${on ? 'on' : ''}">${l ? l.hs : '–'}</b></div>
        <div class="tm">${logo(m.a)}<span>${esc(tn(m.a))}</span><b class="ls ${on ? 'on' : ''}">${l ? l.as : '–'}</b></div></div>`;
    return `<a class="lrow" href="#/mac/${m.id}">${inner}</a>`;
  }
  function liveBox(sport) {
    const cs = liveCands(sport).filter(m => sport === 'bb' || lgOk(m)).sort((a, b) => isFavM(b) - isFavM(a) || byDate(a, b));
    if (!cs.length) return '';
    const n = cs.filter(m => !(LIVE[m.id] && LIVE[m.id].s === 'post')).length;
    const LIM = 6, show = flt.lvall ? cs : cs.slice(0, LIM);
    return `<h2 class="dayhead lvhead"><span class="pulse"></span>${t('live')} <small>${n} ${t('selections')}</small></h2><section class="card lgblock live">${show.map(liveRow).join('')}
      ${cs.length > LIM ? `<button class="lvmore" data-act="lvall">${flt.lvall ? t('show_less') : fmt(t('show_all'), { n: cs.length })}</button>` : ''}</section>`;
  }
  function paintLive() {
    const box = $('livebox');
    if (box && !(flt.q || '').trim()) box.innerHTML = liveBox(box.dataset.sport);
    document.querySelectorAll('[data-lv]').forEach(el => {
      const l = LIVE[el.dataset.lv];
      const k = el.dataset.lk, w = l && k && !/^(IY|2Y|HF)/.test(k) ? wins(k, l.hs, l.as, el.dataset.ll != null ? +el.dataset.ll : undefined) : null;
      el.innerHTML = l ? ` · <b class="ls ${l.s === 'in' ? 'on' : ''}${w === true ? ' win' : w === false ? ' lose' : ''}">${l.hs}-${l.as}${l.s === 'in' && l.c ? ' <i>' + esc(l.c) + '</i>' : ''}</b>` : '';
    });
    document.querySelectorAll('[data-lvh]').forEach(el => {
      const l = LIVE[el.dataset.lvh];
      if (l) el.innerHTML = `<span class="${l.s === 'in' ? 'lsc' : ''}">${l.hs} - ${l.as}</span><small class="lclk ${l.s === 'in' ? 'on' : ''}">${esc(l.s === 'post' ? t('lv_ft') : l.c || t('live'))}</small>`;
    });
    document.querySelectorAll('[data-lvg]').forEach(el => {
      const l = LIVE[el.dataset.lvg], g = (l && l.g) || [];
      el.closest('.card').hidden = !g.length;
      el.innerHTML = g.map(x => `<div class="lvg ${x.s}"><b class="num">${esc(x.m)}</b><span>⚽ ${esc(x.p || '')}${x.pk ? ' (' + t('lv_pen') + ')' : ''}${x.og ? ' (' + t('lv_og') + ')' : ''}</span></div>`).join('');
    });
    ['fb', 'bb'].forEach(sp => {
      const n = liveCands(sp).filter(m => !(LIVE[m.id] && LIVE[m.id].s === 'post')).length;
      document.querySelectorAll(`.lvn[data-sport="${sp}"]`).forEach(el => { el.textContent = n; el.hidden = !n; });
    });
  }
  function watched(id) {
    const m = MATCH[id] || RECENT.find(x => x.id === id);
    if (m && isFavM(m)) return true;
    if (slip.some(x => x.m === id)) return true;
    if (coupons.some(c => c.status === 'pending' && c.sels.some(x => x.m === id))) return true;
    const c0 = MOLLA.coupons[0], nx = MOLLA.next;
    if (nx && (nx.picks || []).some(x => x.id === id)) return true;
    return !!(c0 && ['main', 'hi', 'sys'].concat(XK).some(k => kPicks(c0, k).some(x => x.id === id)));
  }
  function setLive(id, v) {
    const prev = LIVE[id];
    LIVE[id] = v;
    if (!prev || !watched(id)) return;
    const m = MATCH[id] || RECENT.find(x => x.id === id);
    if (!m) return;
    const sc = `${tn(m.h)} ${v.hs}-${v.as} ${tn(m.a)}`;
    if (v.hs + v.as > prev.hs + prev.as) notify((isBB(m) ? '🏀 ' : '⚽ ') + t('n_goal') + (v.c ? ' ' + v.c : ''), sc, 'g' + id);
    else if (v.s === 'post' && prev.s === 'in') notify('🏁 ' + t('n_ft'), sc, 'f' + id);
  }
  function tsApply(e) {
    const id = 'T' + e.idEvent, st = String(e.strStatus || '').toUpperCase();
    if (!MATCH[id] && !RECENT.some(x => x.id === id)) return;
    if (!st || st === 'NS' || st === 'NOT STARTED' || /POSTP|CANC|ABAN/.test(st) || e.intHomeScore == null) return;
    const fin = ['FT', 'AET', 'PEN', 'MATCH FINISHED'].includes(st);
    setLive(id, { s: fin ? 'post' : 'in', hs: +e.intHomeScore || 0, as: +e.intAwayScore || 0,
      c: fin ? '' : st === 'HT' ? t('ht') : (e.strProgress ? e.strProgress + "'" : st), fin: st === 'FT' || st === 'MATCH FINISHED' });
  }
  const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  let polling = false;
  // zaman asimli istek: erisilemeyen bir kaynak canli yenilemeyi kilitlemesin
  const tfetch = (u, ms) => { const c = new AbortController(), tm = setTimeout(() => c.abort(), ms || 9000);
    return fetch(u, { signal: c.signal, cache: 'no-store' }).finally(() => clearTimeout(tm)); };
  const espnAt = {}, srvAt = {}, srvBad = {};
  const SRV_LIVE = [((window.AHAL_CFG || {}).supabaseUrl || '').replace(/\/$/, '') + '/storage/v1/object/public/live/live.json', 'data/live.json'].filter(u => !/^\/storage/.test(u));
  // sunucu yedegi (data/live.json): ESPN'e ulasilamayan aglarda skor buradan gelir; dakika, dosyanin yasina gore ilerletilir
  function applySrv(j) {
    if (!j || !j.ev || !j.t) return;
    const age = (Date.now() - Date.parse(j.t)) / 60e3;
    const at = Date.parse(j.t);
    if (!(age < 45)) return;
    Object.keys(j.ev).forEach(id => {
      if (espnAt[id] > Date.now() - 180e3 || srvAt[id] >= at) return;   // ESPN'den ya da daha yeni yedekten veri varsa o gecerli
      srvAt[id] = at;
      const v = j.ev[id];
      let c = v.c || '';
      if (v.s === 'in' && /HALFTIME/.test(v.n || '')) c = t('ht');
      else if (v.s === 'in' && id[0] !== 'b') {
        const mm = /^(\d+)'$/.exec(c);
        if (mm) { const b = +mm[1], n = b + Math.floor(age), cap = b <= 45 ? 45 : 90; c = n > cap ? cap + "+'" : n + "'"; }
      }
      setLive(id, { s: v.s, hs: v.hs, as: v.as, c, fin: v.s === 'post' && /FULL_TIME|FINAL/.test(v.n || ''), g: v.g || null });
    });
  }
  async function pollLive() {
    if (polling || (document.hidden && !notifOn())) return;
    const cs = liveCands().filter(m => !(LIVE[m.id] && LIVE[m.id].s === 'post'));
    if (!cs.length) return;
    polling = true;
    const want = {}, jobs = [], tsQ = {};
    cs.forEach(m => {
      const id = String(m.id);
      if (id[0] === 'T') {          // TheSportsDB (alt ligler): mac basina degil, tur basina tek istek
        const key = m.tr ? m.tr.join('|') : id;
        if (!tsQ[key] && Date.now() - (tsLast[key] || 0) >= 110e3) tsQ[key] = m.tr || id;
        return;
      }
      const lg = isBB(m) ? 'nba' : m.lg, t0 = new Date(m.d).getTime();
      (want[lg] = want[lg] || new Set()).add(ymd(t0)).add(ymd(t0 - 6 * 3600e3));
    });
    if (Object.keys(want).length) SRV_LIVE.filter(u => !(srvBad[u] > Date.now())).forEach(u => jobs.push(tfetch(u + '?t=' + Date.now(), 7000)
      .then(r => { if (r.ok) return r.json(); srvBad[u] = Date.now() + 15 * 60e3; return null; }).then(applySrv).catch(() => { srvBad[u] = Date.now() + 5 * 60e3; })));
    Object.keys(want).forEach(lg => want[lg].forEach(day => {
      const path = lg === 'nba' ? 'basketball/nba' : 'soccer/' + lg;
      jobs.push(tfetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day}&limit=200`).then(r => r.json()).then(d => {
        (d.events || []).forEach(e => {
          const st = e.status && e.status.type;
          if (!st || st.state === 'pre' || /POSTPON|CANCEL|ABANDON|SUSPEND|DELAY/.test(st.name || '')) return;
          const c = e.competitions[0].competitors, h = c.find(x => x.homeAway === 'home'), a = c.find(x => x.homeAway === 'away');
          const id = (lg === 'nba' ? 'b' : '') + e.id;
          espnAt[id] = Date.now();
          setLive(id, { s: st.state === 'post' ? 'post' : 'in', hs: +h.score || 0, as: +a.score || 0,
            c: st.state === 'post' ? '' : /HALFTIME/.test(st.name) ? t('ht') : (lg === 'nba' ? st.shortDetail : e.status.displayClock) || '',
            fin: st.name === 'STATUS_FULL_TIME' || st.name === 'STATUS_FINAL',
            g: lg === 'nba' ? null : (e.competitions[0].details || []).filter(x => x.scoringPlay && !x.shootout).map(x => ({
              m: (x.clock || {}).displayValue || '', s: String((x.team || {}).id) === String(h.team.id) ? 'h' : 'a',
              p: ((x.athletesInvolved || [])[0] || {}).displayName || '', og: !!x.ownGoal, pk: !!x.penaltyKick })) });
        });
      }).catch(() => { }));
    }));
    // TheSportsDB pes pese istekleri reddeder (429): istekler sirayla ve aralikli gider
    const tsKeys = Object.keys(tsQ).sort((x, y) => (tsQ[y] instanceof Array) - (tsQ[x] instanceof Array)).slice(0, 6);
    if (tsKeys.length) (async () => {
      for (let i = 0; i < tsKeys.length; i++) {
        const k = tsKeys[i], q = tsQ[k];
        if (i) await new Promise(r => setTimeout(r, 2600));
        tsLast[k] = Date.now();
        const url = 'https://www.thesportsdb.com/api/v1/json/123/' + (q instanceof Array
          ? `eventsround.php?id=${q[0]}&r=${q[1]}&s=${q[2]}` : 'lookupevent.php?id=' + q.slice(1));
        try {
          const d = await tfetch(url).then(r => (r.ok ? r.json() : Promise.reject(r.status)));
          (d.events || []).forEach(tsApply);
        } catch (e) { tsLast[k] = Date.now() + 60e3; break; }   // sinir asildi: bu turu birak, sonra dene
      }
    })().then(liveChanged);
    await Promise.all(jobs);
    polling = false;
    liveChanged();
  }
  function liveChanged() {
    let fin = false;
    Object.keys(LIVE).forEach(id => {
      const l = LIVE[id];
      if (l.s === 'post' && l.fin && !RES[id]) { RES[id] = { id, hs: l.hs, as: l.as, live: 1 }; fin = true; }
    });
    if (fin) {
      settle(); renderChrome();
      const h = location.hash || '#/', typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      if (!typing && /^#\/(mollamyrat|sonuclar|kuponlarim|profil)/.test(h)) { const y = scrollY; render(); scrollTo(0, y); return; }
    }
    paintLive();
  }

  // ---------- yonlendirme ----------
  let lastRoute = null;
  function render() {
    const h = location.hash || '#/';
    const km = h.match(/^#\/k\/(.+)$/);
    if (km) { loadShared(decodeURIComponent(km[1])); location.replace('#/'); return; }
    const mm = h.match(/^#\/mac\/(\w+)/);
    let html, title;
    // spor baglami: son gezilen bulten (futbol / basketbol) analiz, puan ve sonuc sayfalarini belirler
    if (h === '#/' || h === '#') flt.sp = 'fb';
    else if (h.startsWith('#/basketbol')) flt.sp = 'bb';
    else if (mm) flt.sp = mm[1][0] === 'b' ? 'bb' : 'fb';
    if (mm) { html = viewMatch(mm[1]); const m = MATCH[mm[1]]; title = m ? tn(m.h) + ' – ' + tn(m.a) : t('bulletin'); }
    else if (h.startsWith('#/analiz')) { html = viewAnalysis(); title = t('analysis'); }
    else if (h.startsWith('#/basketbol')) { html = viewBasketball(); title = t('basketball'); }
    else if (h.startsWith('#/puan')) { html = viewTables(); title = t('tables'); }
    else if (h.startsWith('#/sonuclar')) { html = viewResults(); title = t('results'); }
    else if (h.startsWith('#/kuponlarim')) { html = viewCoupons(); title = t('mycoupons'); }
    else if (h.startsWith('#/kurallar')) { html = viewRules(); title = t('rules'); }
    else if (h.startsWith('#/mollamyrat')) { html = viewMolla(); title = t('tipc_title'); }
    else if (h.startsWith('#/profil')) { html = viewProfile(); title = t('profile'); }
    else { html = viewBulletin(); title = t('bulletin'); }
    $('main').innerHTML = html;
    document.title = title + ' — Analiz365';
    renderChrome(); renderSide(); renderSlip(); syncStrips(); paintLive();
    if (h !== lastRoute) { window.scrollTo(0, 0); lastRoute = h; }
  }
  let toastT;
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600); }

  // ---------- olaylar ----------
  document.addEventListener('click', e => {
    const back = e.target.closest('[data-back]');
    if (back && navDepth > 0) { e.preventDefault(); return history.back(); }
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.m && d.k) return toggleSel(d.m, d.k);
    if (d.scroll) { const c = b.parentNode.querySelector('.chips'); return c.scrollBy({ left: +d.scroll * c.clientWidth * .7, behavior: 'smooth' }); }
    if (d.lg) { flt.lg = flt.lg === d.lg ? 'all' : d.lg; flt.alim = 24; return render(); }
    if (d.day) { flt.day = d.day; flt.q = ''; flt.alim = 24; return render(); }
    if (d.rday) { flt.rday = d.rday; return render(); }
    if (d.dtab) { dtab = d.dtab; render(); if (d.top) scrollTo(0, 0); return; }
    if (d.axj) { const el = $('ax-' + d.axj); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (d.fav) {
      const id = d.fav, on = !FAV.has(id);
      if (on) FAV.add(id); else FAV.delete(id);
      LS.set('fav', [...FAV]);
      if (SB && profile) SB.from('profiles').update({ favs: [...FAV] }).eq('id', profile.id).then(() => { });
      if (!FAV.size && flt.lg === 'fav') flt.lg = 'all';
      toast(fmt(t(on ? 'fav_added' : 'fav_removed'), { n: tn(id) }));
      const y = scrollY; render(); scrollTo(0, y); return;
    }
    if (d.sp) { flt.sp = d.sp; flt.rday = undefined; flt.alim = 24; return render(); }
    if (d.go) { flt.rday = undefined; location.hash = '#/' + d.go; return; }
    if (d.mx) {
      const row = b.closest('.mrow'), nx = row.nextElementSibling, open = nx && nx.classList.contains('mxp');
      if (open) nx.remove(); else row.insertAdjacentHTML('afterend', mxPanel(MATCH[d.mx]));
      b.setAttribute('aria-expanded', String(!open)); b.classList.toggle('on', !open); return;
    }
    if (d.asort) { flt.asort = d.asort; flt.alim = 24; return render(); }
    if (d.mp) { flt.mp = d.mp; const y = scrollY; render(); scrollTo(0, y); return; }
    if (d.mk || d.ma) { if (d.mk) flt.mk = d.mk; if (d.ma) flt.ma = d.ma === '*' ? null : d.ma; if (d.mgo && !/^#\/mollamyrat/.test(location.hash)) { location.hash = '#/mollamyrat'; return; } const y = scrollY; render(); scrollTo(0, y); return; }
    if (d.act === 'notif') return toggleNotif();
    if (d.act === 'share-slip') return shareSlip();
    if (d.act === 'share-molla') return shareMolla(d.cdate, d.ck, d.own);
    if (d.act === 'share-cpn') return shareUserCoupon(d.cid);
    if (d.ttab) { ttab = d.ttab; return render(); }
    if (d.rm) return toggleSel(d.rm, (slip.find(s => s.m === d.rm) || {}).k);
    if (d.q) { stake = +d.q; LS.set('stake', stake); const i = $('stake'); if (i) i.value = stake; slipErr = ''; $('s-err').textContent = ''; return updWin(); }
    if (d.act === 'play') return play();
    if (d.act === 'save-slip') return saveSlip();
    if (d.act === 'sv-load') return loadSaved(d.sid);
    if (d.act === 'sv-del') return delSaved(d.sid);
    if (d.act === 'share-saved') return shareSaved(d.sid);
    if (d.ctab) { flt.ctab = d.ctab; return render(); }
    if (d.act === 'bmore' || d.act === 'rmore') { flt[d.act === 'bmore' ? 'blim' : 'rlim'] = 999; const y = scrollY; render(); scrollTo(0, y); return; }
    if (d.act === 'amore') { flt.alim += 24; const y = scrollY; render(); scrollTo(0, y); return; }
    if (d.act === 'lvall') { flt.lvall = !flt.lvall; return paintLive(); }
    if (d.act === 'tipadd') {
      slip = kPicks(cByDate(d.cdate) || MOLLA.coupons[0], d.ck, d.own).filter(pkLive).slice(0, MAX_SEL).map(x => ({ m: x.id, k: x.k })); LS.set('slip', slip); slipErr = '';
      toast(t('tipc_added')); syncObs(); renderSlip();
      if (matchMedia('(max-width:860px)').matches) document.body.classList.add('slipopen');
      return;
    }
    if (d.act === 'clear') { slip = []; LS.set('slip', slip); document.body.classList.remove('slipopen'); syncObs(); return renderSlip(); }
    if (d.act === 'close') return document.body.classList.remove('slipopen');
    if (d.act === 'resetbal') {
      if (SB) { SB.rpc('reset_balance').then(({ data, error }) => { if (error) toast(sbErr(error)); else balance = +data; render(); }); return; }
      balance = START_BAL; saveUser(); return render();
    }
    if (d.act === 'logout') {
      if (SB) { SB.auth.signOut().finally(() => { user = null; profile = null; coupons = []; saved = []; balance = 0; render(); }); return; }
      user = null; LS.set('user', null); loadUser(); return render();
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'stake') { stake = e.target.value; LS.set('stake', parseFloat(stake) || MIN_STAKE); updWin(); }
    if (e.target.id === 'q') { flt.q = e.target.value; $('blist').innerHTML = bulletinList(); const b = $('livebox'); if (b) b.innerHTML = flt.q.trim() ? '' : liveBox('fb'); }
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    (f.dataset.form === 'reg' ? doRegister : doLogin)(f);
  });
  $('slipbar').addEventListener('click', () => document.body.classList.add('slipopen'));
  $('scrim').addEventListener('click', () => document.body.classList.remove('slipopen'));
  $('lang').addEventListener('change', e => { lang = e.target.value; LS.set('lang', lang); render(); });
  const stack = [location.hash || '#/'];
  window.addEventListener('hashchange', () => {
    const h = location.hash || '#/';
    if (stack.length > 1 && stack[stack.length - 2] === h) stack.pop(); else stack.push(h);
    navDepth = stack.length - 1;
    dtab = /^#\/mac\//.test(location.hash) ? 'an' : 'pred';   // maca girildiginde once Analiz acilir
    document.body.classList.remove('slipopen'); render();
  });
  window.addEventListener('resize', syncStrips);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('slipopen'); });

  // amblem yuklenemezse bas harfli yer tutucu (satir ici onerror yok: CSP uyumlu)
  document.addEventListener('error', e => {
    const el = e.target;
    if (el && el.tagName === 'IMG' && el.classList.contains('logo')) {
      const sp = document.createElement('span');
      sp.className = el.className + ' ph'; sp.textContent = el.dataset.ini || '';
      el.replaceWith(sp);
    }
  }, true);
  if (/^#\/mac\//.test(location.hash)) dtab = 'an';
  cleanSlip(); settle(); render();
  if (SB) sbLoad().then(() => { settle(); render(); }).catch(() => { });
  (function () {   // yeni MollaMyrat kuponu haber ver (ilk ziyarette degil)
    const c = MOLLA.coupons[0]; if (!c) return;
    const seen = LS.get('mseen', null);
    if (seen && seen !== c.date) setTimeout(() => notify('★ ' + t('n_molla'), cRange(c) + ' · ' + c.picks.length + ' ' + t('selections'), 'molla'), 1500);
    LS.set('mseen', c.date);
  })();
  pollLive(); setInterval(pollLive, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
