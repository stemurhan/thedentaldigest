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
  const flt = { lg: 'all', day: null, q: '', alim: 48, lvall: false };
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
  const MATCH = {}; D.matches.concat(BB.matches).forEach(m => { MATCH[m.id] = m; if (!m.pl) m.pl = { h: [], a: [] }; if (!m.sq) m.sq = { h: null, a: null }; if (!m.f) m.f = { h: [], a: [] }; if (!m.h2h) m.h2h = []; });
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

  function mkLabel(k, m, line) {
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
  function dayStrip(days) {
    return strip(`<button class="chip day ${flt.day === 'all' ? 'on' : ''}" data-day="all"><small>${t('alldays_s')}</small>${t('all')}</button>` +
      days.map(d => { const p = keyParts(d); return `<button class="chip day ${flt.day === d ? 'on' : ''}" data-day="${d}"><small>${relDay(d) || t('wd')[p.wd]}</small>${dayShort(d)}</button>`; }).join(''), 'days');
  }
  function pickDay(list) {
    const days = [...new Set(list.map(m => dayKey(m.d)))].sort();
    if (flt.day !== 'all' && !days.includes(flt.day)) flt.day = days[0] || 'all';
    return days;
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
      + `<a href="#/mollamyrat" class="mm ${h.startsWith('#/mollamyrat') ? 'on' : ''}">★ MollaMyrat</a>`;
    $('tabs').innerHTML = NAV.map(([k, u]) => `<a href="${u}" class="${act(k) ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg><span>${t(k + '_s') !== k + '_s' ? t(k + '_s') : t(k)}</span></a>`).join('');
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
    const r = RES[pk.id];
    if (!r) return null;
    return score ? (r.hs === pk.sc[0] && r.as === pk.sc[1]) : wins(pk.k, r.hs, r.as);
  }
  const pkRes = pk => pk.res || (RES[pk.id] ? [RES[pk.id].hs, RES[pk.id].as] : null);
  const pkIcon = (pk, score) => { const ok = pkOk(pk, score); return ok === true ? '<span class="mst ok" title="✓">✓</span>' : ok === false ? '<span class="mst no" title="✗">✗</span>' : '<span class="mst wait" title="…">•</span>'; };
  const cRange = c => (c.until && c.until !== c.date ? dayShort(c.date) + ' – ' + dayShort(c.until) : dayLabel(c.date));
  const pkLive = pk => MATCH[pk.id] && future(MATCH[pk.id]) && MATCH[pk.id].o[pk.k];
  function weekRange(off) {
    const k = dayKey(Date.now()), p = keyParts(k), [y, m, d] = k.split('-').map(Number);
    const base = Date.UTC(y, m - 1, d, 12) - ((p.wd + 6) % 7) * 864e5 + off * 7 * 864e5;
    const f = ms => new Date(ms).toISOString().slice(0, 10);
    return [f(base), f(base + 6 * 864e5)];
  }
  function weekStats(off) {
    const [a, b] = weekRange(off), cs = MOLLA.coupons.filter(c => c.date >= a && c.date <= b);
    const r = { a, b, cs, ok: 0, no: 0, wait: 0, sok: 0, sno: 0, swait: 0 };
    cs.forEach(c => {
      c.picks.forEach(x => { const ok = pkOk(x); if (ok === true) r.ok++; else if (ok === false) r.no++; else r.wait++; });
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
  const kPicks = (c, kind) => (kind === 'hi' ? (hiOf(c) || {}).picks : kind === 'sys' ? (sysOf(c) || {}).picks : c.picks) || [];
  function molRow(pk, score) {
    const lg = LG[pk.lg] ? esc(ln(pk.lg)) : '';
    const tag = MATCH[pk.id] ? 'a' : 'div', href = MATCH[pk.id] ? ` href="#/mac/${pk.id}"` : '';
    const right = score
      ? `<span class="to num">${pk.sc[0]} - ${pk.sc[1]}<small>${pct(pk.sp)}%</small></span>`
      : `<span class="to num">${pk.o.toFixed(2)}</span>`;
    const sub = score ? `${shortDate(pk.d)} ${timeOf(pk.d)} · ${lg}` : `${shortDate(pk.d)} ${timeOf(pk.d)} · ${esc(mkLabel(pk.k))} · ${t('m_pred')} ${pk.sc[0]}-${pk.sc[1]}`;
    const res = pkRes(pk);
    return `<${tag} class="tipc-r"${href}><span class="tt">${pair(pk.h, pk.a, pkName(pk, 'h'), pkName(pk, 'a'))}<small>${sub}${res ? ' · <b class="res">' + res[0] + '-' + res[1] + '</b>' : `<span data-lv="${pk.id}"></span>`}</small></span>${right}${pkIcon(pk, score)}</${tag}>`;
  }
  function tipCoupon() {
    const c = MOLLA.coupons[0];
    if (!c) return '';
    const tot = c.picks.reduce((p, x) => p * x.o, 1), w = weekStats(0);
    return `<div class="card tipc"><div class="tipc-h">${shareBtn('share-molla', `data-cdate="${c.date}"`)}<b>★ ${t('tipc_title')}</b><small>${fmt(t('tipc_sub'), { n: c.picks.length })} · ${cRange(c)}</small></div>
      ${c.picks.map(x => molRow(x)).join('')}
      <div class="tipc-f"><div class="sum"><span>${t('total_odds')}</span><b class="num">${tot.toFixed(2)}</b></div>
      <div class="sum"><span>${fmt(t('tipc_min'), { s: MIN_STAKE })}</span><b class="num" style="color:var(--pri)">${money(Math.min(MIN_STAKE * tot, MAX_WIN))}</b></div>
      <div class="sum"><span>${t('m_week')}</span><b class="num"><span style="color:var(--pri)">${w.ok} ✓</span> · <span style="color:var(--red)">${w.no} ✗</span> · ${w.wait} •</b></div>
      ${c.picks.some(pkLive) ? `<button class="btn" data-act="tipadd" data-cdate="${c.date}">${t('tipc_add')}</button>` : ''}
      ${hiOf(c) ? `<a class="tipx" href="#/mollamyrat"><span>🔥 ${t('m_k_hi')} · ${hiOf(c).picks.length} ${t('selections')}</span><b class="num">${prodO(hiOf(c).picks).toFixed(2)}</b></a>` : ''}
      ${sysOf(c) ? `<a class="tipx" href="#/mollamyrat"><span>🎯 ${t('m_k_sys')}</span><b class="num">${sysOf(c).k}/${sysOf(c).picks.length}</b></a>` : ''}
      <a class="btn ghost" href="#/mollamyrat">${t('m_track')} →</a></div></div>`;
  }
  function viewMolla() {
    const w = weekStats(0), lw = weekStats(-1), c0 = MOLLA.coupons[0];
    const rate = (o, n) => (o + n ? pct(o / (o + n)) + '%' : '–');
    const box = x => `<div class="kpis m5">
      <div class="kpi"><small>${t('m_ok')}</small><b style="color:var(--pri)">${x.ok}</b></div>
      <div class="kpi"><small>${t('m_no')}</small><b style="color:var(--red)">${x.no}</b></div>
      <div class="kpi"><small>${t('m_wait')}</small><b>${x.wait}</b></div>
      <div class="kpi"><small>${t('m_rate')}</small><b style="color:var(--gold)">${rate(x.ok, x.no)}</b></div>
      <div class="kpi"><small>${t('m_score_hit')}</small><b>${x.sok}/${x.sok + x.sno}</b></div></div>`;
    const cpn = c => {
      const o = c.picks.filter(x => pkOk(x) === true).length, n = c.picks.filter(x => pkOk(x) === false).length;
      const st = n ? 'lost' : (o === c.picks.length ? 'won' : 'pending');
      let html = `<h3 class="mdate">${cRange(c)}</h3><div class="card tipc mc"><div class="tipc-h row"><b>★ ${t('m_k_main')}</b>${shareBtn('share-molla', `data-cdate="${c.date}"`)}<span class="st ${st}">${t(st)}</span><small class="num">${o} ✓ · ${n} ✗ · ${c.picks.length - o - n} •</small></div>${c.picks.map(x => molRow(x)).join('')}
        <div class="tipc-f"><div class="sum"><span>${t('total_odds')}</span><b class="num">${prodO(c.picks).toFixed(2)}</b></div>
        ${c.picks.some(pkLive) ? `<button class="btn" data-act="tipadd" data-cdate="${c.date}">${t('tipc_add')}</button>` : ''}</div></div>`;
      const hi = hiOf(c), sy = sysOf(c);
      if (hi) {
        const ho = hi.picks.filter(x => pkOk(x) === true).length, hn = hi.picks.filter(x => pkOk(x) === false).length, tot = prodO(hi.picks);
        const hs = hn ? 'lost' : (ho === hi.picks.length ? 'won' : 'pending');
        html += `<div class="card tipc mc"><div class="tipc-h row"><b>🔥 ${t('m_k_hi')}</b>${shareBtn('share-molla', `data-cdate="${c.date}" data-ck="hi"`)}<span class="st ${hs}">${t(hs)}</span><small class="num">${ho} ✓ · ${hn} ✗ · ${hi.picks.length - ho - hn} •</small></div>${hi.picks.map(x => molRow(x)).join('')}
          <div class="tipc-f"><div class="sum"><span>${t('total_odds')}</span><b class="num" style="color:var(--gold)">${tot.toFixed(2)}</b></div>
          <div class="sum"><span>${fmt(t('tipc_min'), { s: MIN_STAKE })}</span><b class="num" style="color:var(--pri)">${money(Math.min(MIN_STAKE * tot, MAX_WIN))}</b></div>
          ${hi.picks.some(pkLive) ? `<button class="btn" data-act="tipadd" data-cdate="${c.date}" data-ck="hi">${t('tipc_add')}</button>` : ''}</div></div>`;
      }
      if (sy) {
        const S = sysInfo(sy);
        html += `<div class="card tipc mc"><div class="tipc-h row"><b>🎯 ${t('m_k_sys')} ${S.k}/${S.N}</b>${shareBtn('share-molla', `data-cdate="${c.date}" data-ck="sys"`)}<span class="st ${S.st}">${t(S.st)}</span><small class="num">${S.ok} ✓ · ${S.no} ✗ · ${S.N - S.ok - S.no} •</small></div>${sy.picks.map(x => molRow(x)).join('')}
          <div class="tipc-f"><div class="sum"><span>${fmt(t('sys_rule'), { k: S.k, n: S.N })}</span><b class="num">${S.cols} ${t('sys_cols')}</b></div>
          <div class="sum"><span>${t('sys_per')} × ${S.cols}</span><b class="num">${money(S.per)} → ${money(MIN_STAKE)}</b></div>
          <div class="sum"><span>${t('sys_max')}</span><b class="num" style="color:var(--pri)">${money(Math.min(S.max, MAX_WIN))}</b></div>
          ${S.ok + S.no ? `<div class="sum"><span>${t('sys_wcols')}: ${S.wcols}/${S.cols}</span><b class="num" style="color:var(--gold)">${money(Math.min(S.win, MAX_WIN))}</b></div>` : ''}
          <p class="note" style="margin:8px 0 0">${fmt(t('sys_note'), { k: S.k })}</p></div></div>`;
      }
      return html;
    };
    const range = x => `${dayShort(x.a)} – ${dayShort(x.b)}`;
    return `<div class="pagehead"><h1>★ ${t('tipc_title')}</h1><small>${t('m_note')}</small></div>
      <div class="card sec" style="margin-top:0"><h2>${t('m_week')} <small class="mut num">${range(w)}</small></h2>${box(w)}</div>
      ${c0 && c0.scores && c0.scores.length ? `<div class="card tipc mc"><div class="tipc-h"><b>${t('m_scores')}</b><small>${cRange(c0)}</small></div>${c0.scores.map(x => molRow(x, true)).join('')}</div>` : ''}
      <h2 class="dayhead">${t('m_coupons')}</h2>
      ${w.cs.length ? w.cs.map(cpn).join('') : `<div class="card empty">${t('m_none')}</div>`}
      ${lw.cs.length ? `<div class="card sec"><h2>${t('m_last')} <small class="mut num">${range(lw)}</small></h2>${box(lw)}</div><details class="lastw"><summary>${t('m_last')} · ${t('m_coupons')}</summary>${lw.cs.map(cpn).join('')}</details>` : ''}
      ${mollaArchive()}
      <div class="card sec mnotif"><span>🔔 ${t('n_molla_hint')}</span>${notifOn() ? `<b class="mut">${t('notif_enabled')}</b>` : notifSup() && Notification.permission !== 'denied' ? `<button type="button" class="btn" data-act="notif">${t('notif_on')}</button>` : ''}</div>`;
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
  function shareMolla(date, kind) {
    const c0 = MOLLA.coupons.find(x => x.date === date) || MOLLA.coupons[0]; if (!c0) return;
    const pk = kPicks(c0, kind); if (!pk.length) return;
    const rows = x => ({ teams: pkName(x, 'h') + ' – ' + pkName(x, 'a'), sub: mkLabel(x.k) + ' · ' + shortDate(x.d) + ' ' + timeOf(x.d), o: x.o.toFixed(2), mark: mark(pkOk(x)) });
    if (kind === 'sys') {
      const S = sysInfo(c0.sys);
      return shareCoupon('★ MollaMyrat · ' + t('m_k_sys') + ' ' + S.k + '/' + S.N, cRange(c0) + ' · ' + fmt(t('sys_rule'), { k: S.k, n: S.N }), pk.map(rows),
        { tot: S.k + '/' + S.N + ' · ' + S.cols + ' ' + t('sys_cols'), stake: money(MIN_STAKE), win: money(Math.min(S.max, MAX_WIN)) }, pk.map(x => ({ m: x.id, k: x.k })));
    }
    const c = { picks: pk };
    const tot = c.picks.reduce((p, x) => p * x.o, 1);
    shareCoupon('★ ' + (kind === 'hi' ? 'MollaMyrat · ' + t('m_k_hi') : t('tipc_title')), cRange(c0) + ' · ' + (kind === 'hi' ? c.picks.length + ' ' + t('selections') : fmt(t('tipc_sub'), { n: c.picks.length })),
      c.picks.map(x => ({ teams: pkName(x, 'h') + ' – ' + pkName(x, 'a'), sub: mkLabel(x.k) + ' · ' + shortDate(x.d) + ' ' + timeOf(x.d), o: x.o.toFixed(2), mark: mark(pkOk(x)) })),
      { tot: tot.toFixed(2), stake: money(MIN_STAKE), win: money(Math.min(MIN_STAKE * tot, MAX_WIN)) }, c.picks.map(x => ({ m: x.id, k: x.k })));
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
      html += `<p class="note">${fmt(t('m_since'), { d: dayShort(cs[cs.length - 1].date) })}</p>`;
    }
    if (A.n) {
      const lgRows = Object.keys(A.lg).sort((a, b) => A.lg[b][0] - A.lg[a][0]).slice(0, 10);
      html += `<div class="card sec"><h2>${t('m_site')}</h2><div class="kpis">
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
    return `<div class="pagehead"><h1>${t('bulletin')}</h1><small>${t('tznote')}</small></div>
      ${dayStrip(days)}${lgChips(new Set(up.map(m => m.lg)))}
      <div class="searchrow"><input id="q" type="search" placeholder="${t('search')}" value="${esc(flt.q)}" autocomplete="off" aria-label="${t('search')}"></div>
      <details class="tipmob"><summary>★ ${t('tipc_title')}</summary>${tipCoupon()}</details>
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
    [...new Set(list.map(m => dayKey(m.d)))].sort().forEach(dk => {
      const ms = list.filter(m => dayKey(m.d) === dk).sort((a, b) => byDate(a, b) || order[a.lg] - order[b.lg]);
      html += `<h2 class="dayhead">${dayLabel(dk)} <small>${ms.length} ${t('selections')}</small></h2><section class="card lgblock">
        <div class="mkhead"><span></span><span>${t('ms')}</span><span>${t('ou')} 2.5</span><span>${t('btts')}</span><span></span></div>
        ${ms.map(row).join('')}</section>`;
    });
    return html;
  }
  function row(m, wd) {
    return `<div class="mrow">
      <a class="minfo" href="#/mac/${m.id}">
        <div class="mtime num">${wd === true ? `<span class="md">${shortDate(m.d)}</span>` : ''}${timeOf(m.d)}</div>
        <div class="mteams"><div class="mlg">${badge(m.lg)}<span>${esc(ln(m.lg))}</span></div><div class="tm">${logo(m.h)}<span>${esc(tn(m.h))}</span>${favMark(m.h)}</div><div class="tm">${logo(m.a)}<span>${esc(tn(m.a))}</span>${favMark(m.a)}</div></div>
      </a>
      <div class="og c3 ms">${ob(m, '1')}${ob(m, 'X')}${ob(m, '2')}</div>
      <div class="og c2 ou">${ob(m, 'U2.5', t('under'))}${ob(m, 'O2.5', t('over'))}</div>
      <div class="og c2 kg">${ob(m, 'KGV')}${ob(m, 'KGY')}</div>
      <a class="morebtn" href="#/mac/${m.id}" title="${t('detail')} · ${t('more')}" aria-label="${t('detail')}: ${esc(tn(m.h))} – ${esc(tn(m.a))}">+${Object.keys(m.o).length - 3}</a>
    </div>`;
  }

  // ---------- analiz listesi ----------
  const pbar = p => `<div class="pbar num"><div class="p1" style="flex:${p.p1}">${pct(p.p1)}%</div>${p.px != null ? `<div class="px" style="flex:${p.px}">${pct(p.px)}%</div>` : ''}<div class="p2" style="flex:${p.p2}">${pct(p.p2)}%</div></div>`;
  const spSeg = () => `<div class="seg" role="tablist">${['fb', 'bb'].map(k => `<button class="${(flt.sp === 'bb' ? 'bb' : 'fb') === k ? 'on' : ''}" data-sp="${k}">${t('sp_' + k)}</button>`).join('')}</div>`;
  function viewAnalysisBB() {
    const up = BB.matches.filter(future).sort(byDate);
    const days = pickDay(up);
    const list = up.filter(m => flt.day === 'all' || dayKey(m.d) === flt.day);
    const html = `<div class="pagehead"><h1>${t('analysis')} · ${t('basketball')}</h1><small>${t('foot_disc')}</small></div>${spSeg()}${dayStrip(days)}`;
    if (!list.length) return html + `<div class="card empty">${t('bb_none')}</div>`;
    return html + '<div class="acards">' + list.map(m => {
      const tp = tipOf(m), p = m.p;
      return `<a class="card acard" href="#/mac/${m.id}">
        <div class="top-l"><span>${badge('nba')} NBA</span><span class="num">${shortDate(m.d)} ${timeOf(m.d)}</span></div>
        <div class="teams"><div class="tm">${logo(m.h)}<span>${esc(ts(m.h))}</span></div><div class="ps">${p.score[0]} - ${p.score[1]}</div><div class="tm">${logo(m.a)}<span>${esc(ts(m.a))}</span></div></div>
        ${pbar(p)}
        <div class="top-l"><span>${t('tip')}: <b style="color:var(--tx)">${esc(mkLabel(tp.k, m))}</b> · <span class="num">${tp.o.toFixed(2)}</span></span>${stars(tp.stars)}</div>
      </a>`;
    }).join('') + '</div>';
  }
  function viewAnalysis() {
    if (flt.sp === 'bb') return viewAnalysisBB();
    const up = upcoming();
    const inLg = up.filter(lgOk);
    const days = pickDay(inLg);
    const list = inLg.filter(m => flt.day === 'all' || dayKey(m.d) === flt.day).sort(byDate);
    let html = `<div class="pagehead"><h1>${t('analysis')}</h1><small>${t('foot_disc')}</small></div>${spSeg()}${dayStrip(days)}${lgChips(new Set(up.map(m => m.lg)), true)}`;
    if (!list.length) return html + `<div class="card empty">${t('nomatch')}</div>`;
    const more = list.length - flt.alim;
    return html + '<div class="acards">' + list.slice(0, flt.alim).map(m => {
      const tp = tipOf(m), p = m.p;
      return `<a class="card acard" href="#/mac/${m.id}">
        <div class="top-l"><span>${badge(m.lg)} ${esc(ln(m.lg))}</span><span class="num">${shortDate(m.d)} ${timeOf(m.d)}</span></div>
        <div class="teams"><div class="tm">${logo(m.h)}<span>${esc(ts(m.h))}</span></div><div class="ps">${p.score[0]} - ${p.score[1]}</div><div class="tm">${logo(m.a)}<span>${esc(ts(m.a))}</span></div></div>
        ${pbar(p)}
        <div class="top-l"><span>${t('tip')}: <b style="color:var(--tx)">${esc(mkLabel(tp.k))}</b> · <span class="num">${tp.o.toFixed(2)}</span></span>${stars(tp.stars)}</div>
      </a>`;
    }).join('') + '</div>' + (more > 0 ? `<button class="btn ghost more" data-act="amore">${fmt(t('show_more'), { n: more })}</button>` : '');
  }

  // ---------- mac detay ----------
  const backLink = href => `<a class="back" href="${href || '#/'}" data-back="1">← ${t('back')}</a>`;
  function viewMatch(id) {
    const m = MATCH[id];
    if (!m) return `${backLink(/^b/.test(id) ? '#/basketbol' : '')}<div class="card empty">${t('no_match_found')}</div>`;
    if (m.sport === 'bb') return viewMatchBB(m);
    const TABS = [['pred', t('pred')], ['odds', t('odds')], ['table', t('standings')], ['form', t('formh2h')], ['squad', t('lineups')], ['players', t('players')]];
    let body = '';
    if (dtab === 'pred') body = tabPred(m);
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
        <div><div class="lbl">${t('tip')}</div><div class="what">${esc(mkLabel(tp.k, m))}</div></div>
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
      </tbody></table>
    </div>
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
    const TABS = [['pred', t('pred')], ['odds', t('odds')], ['table', t('standings')], ['form', t('formh2h')], ['players', t('players')]];
    if (!TABS.some(x => x[0] === dtab)) dtab = 'pred';
    let body;
    if (dtab === 'pred') body = tabPredBB(m);
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
      </tbody></table>
    </div>`;
  }

  function tabOdds(m) {
    const grp = (title, ks, cols, src) => `<div class="card sec"><h2>${title} ${srcBadge(src)}</h2><div class="og c${cols}">${ks.map(k => ob(m, k)).join('')}</div></div>`;
    const ss = m.ss || { ms: m.src, dc: m.src === 'bet365' ? 'bet365' : 'model', ou25: m.ou || 'model', ou15: 'model', ou35: 'model', kg: 'model' };
    return grp(t('ms'), ['1', 'X', '2'], 3, ss.ms) + grp(t('dc'), ['1X', '12', 'X2'], 3, ss.dc)
      + grp(t('ou') + ' 2.5', ['U2.5', 'O2.5'], 2, ss.ou25)
      + grp(t('ou') + ' 1.5', ['U1.5', 'O1.5'], 2, ss.ou15)
      + grp(t('ou') + ' 3.5', ['U3.5', 'O3.5'], 2, ss.ou35)
      + grp(t('btts'), ['KGV', 'KGY'], 2, ss.kg)
      + `<p class="note">${srcNote(m)}</p>`;
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
    if (!days.includes(flt.rday)) flt.rday = days[0];
    const list = all.filter(r => dayKey(r.d) === flt.rday).sort((x, y) => byDate(x, y));
    const wp = list.filter(r => r.pr), tipOk = wp.filter(r => wins(r.pr.k, r.hs, r.as, r.pr.ln)).length;
    const scOk = wp.filter(r => (bb ? (r.pr.sc[0] > r.pr.sc[1]) === (r.hs > r.as) : r.pr.sc[0] === r.hs && r.pr.sc[1] === r.as)).length;
    const A = (bb ? D.accbb : D.acc) || { n: 0 };
    let html = `<div class="pagehead"><h1>${t('results')}</h1><small>${t('fin_note')}</small></div>
      ${spSeg()}
      ${strip(days.map(d => { const p = keyParts(d); return `<button class="chip day ${flt.rday === d ? 'on' : ''}" data-rday="${d}"><small>${relDay(d) || t('wd')[p.wd]}</small>${dayShort(d)}</button>`; }).join(''), 'days')}
      ${bb ? '' : lgChips(new Set(D.results.map(r => r.lg)), true)}`;
    if (!list.length) return html + `<div class="card empty">${t('nomatch')}</div>`;
    html += `<div class="card sec facc" style="margin-top:0"><h2>${t('fin_day')} <small class="mut">${dayLabel(flt.rday)}</small></h2><div class="kpis">
      <div class="kpi"><small>${t('c_played')}</small><b>${list.length}</b></div>
      <div class="kpi"><small>${t('f_tip')}</small><b style="color:var(--pri)">${wp.length ? tipOk + '/' + wp.length : '–'}</b></div>
      <div class="kpi"><small>${t(bb ? 'f_win' : 'f_sc')}</small><b style="color:var(--gold)">${wp.length ? scOk + '/' + wp.length : '–'}</b></div>
      <div class="kpi"><small>${t('fin_30')}</small><b>${A.n ? pct(A.tip / A.n) + '%' : '–'}</b></div></div></div>`;
    return html + `<section class="card lgblock">${list.map(r => finRow(r, bb)).join('')}</section>`;
  }

  // ---------- basketbol ----------
  function viewBasketball() {
    const up = BB.matches.filter(future).sort(byDate);
    let html = `<div class="pagehead"><h1>${t('bb_title')}</h1><small>${t('tznote')}</small></div>
      <div class="chips bbnav">${[['analiz', 'analysis'], ['puan', 'tables'], ['sonuclar', 'results']].map(([u, k]) => `<button class="chip" data-go="${u}">${t(k)} →</button>`).join('')}</div>
      <div id="livebox" data-sport="bb">${liveBox('bb')}</div>`;
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
      ${c.sels.map(x => `<div class="row"><span class="rl">${pair(x.hi, x.ai, nm(x, 'h'), nm(x, 'a'))}<small class="mut">${esc(mkLabel(x.k, null, x.ln))} · ${shortDate(x.d)} ${timeOf(x.d)}${x.res ? ' · ' + esc(x.res) : `<span data-lv="${esc(x.m)}"></span>`}</small></span><span class="r ${x.ok === true ? 'ok' : x.ok === false ? 'no' : ''}">${(+x.o).toFixed(2)}</span></div>`).join('')}
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
  const viewRules = () => `<div class="pagehead"><h1>${t('r_title')}</h1></div><div class="card rules"><ol>${t('r_items').map(x => `<li>${esc(x)}</li>`).join('')}</ol><p class="note">${t('max_win_note')}</p></div>`;

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
    const clock = !l ? t('lv_started') : l.s === 'post' ? t('lv_ft') : (l.c || t('live'));
    const lg = isBB(m) ? '<span class="cc">NBA</span><span>NBA</span>' : `${badge(m.lg)}<span>${esc(ln(m.lg))}</span>`;
    const inner = `<div class="mtime num"><b class="lclk ${on ? 'on' : ''}">${esc(clock)}</b><small>${timeOf(m.d)}</small></div>
      <div class="mteams"><div class="mlg">${lg}</div>
        <div class="tm">${logo(m.h)}<span>${esc(tn(m.h))}</span><b class="ls ${on ? 'on' : ''}">${l ? l.hs : '–'}</b></div>
        <div class="tm">${logo(m.a)}<span>${esc(tn(m.a))}</span><b class="ls ${on ? 'on' : ''}">${l ? l.as : '–'}</b></div></div>`;
    return MATCH[m.id] ? `<a class="lrow" href="#/mac/${m.id}">${inner}</a>` : `<div class="lrow">${inner}</div>`;
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
      el.innerHTML = l ? ` · <b class="ls ${l.s === 'in' ? 'on' : ''}">${l.hs}-${l.as}${l.s === 'in' && l.c ? ' <i>' + esc(l.c) + '</i>' : ''}</b>` : '';
    });
    document.querySelectorAll('[data-lvh]').forEach(el => {
      const l = LIVE[el.dataset.lvh];
      if (l) el.innerHTML = `<span class="${l.s === 'in' ? 'lsc' : ''}">${l.hs} - ${l.as}</span><small class="lclk ${l.s === 'in' ? 'on' : ''}">${esc(l.s === 'post' ? t('lv_ft') : l.c || t('live'))}</small>`;
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
    const c0 = MOLLA.coupons[0];
    return !!(c0 && ['main', 'hi', 'sys'].some(k => kPicks(c0, k).some(x => x.id === id)));
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
  const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  let polling = false;
  async function pollLive() {
    if (polling || (document.hidden && !notifOn())) return;
    const cs = liveCands().filter(m => !(LIVE[m.id] && LIVE[m.id].s === 'post'));
    if (!cs.length) return;
    polling = true;
    const want = {}, jobs = [];
    cs.forEach(m => {
      const id = String(m.id);
      if (id[0] === 'T') {          // TheSportsDB (Turkiye / Rusya alt ligleri)
        if (Date.now() - (tsLast[id] || 0) < 110e3) return;
        tsLast[id] = Date.now();
        jobs.push(fetch('https://www.thesportsdb.com/api/v1/json/123/lookupevent.php?id=' + id.slice(1)).then(r => r.json()).then(d => {
          const e = (d.events || [])[0]; if (!e) return;
          const st = String(e.strStatus || '').toUpperCase();
          if (!st || st === 'NS' || st === 'NOT STARTED' || /POSTP|CANC|ABAN/.test(st) || e.intHomeScore == null) return;
          const fin = ['FT', 'AET', 'PEN', 'MATCH FINISHED'].includes(st);
          setLive(id, { s: fin ? 'post' : 'in', hs: +e.intHomeScore || 0, as: +e.intAwayScore || 0,
            c: fin ? '' : st === 'HT' ? t('ht') : (e.strProgress ? e.strProgress + "'" : st), fin: st === 'FT' || st === 'MATCH FINISHED' });
        }).catch(() => { }));
        return;
      }
      const lg = isBB(m) ? 'nba' : m.lg, t0 = new Date(m.d).getTime();
      (want[lg] = want[lg] || new Set()).add(ymd(t0)).add(ymd(t0 - 6 * 3600e3));
    });
    Object.keys(want).forEach(lg => want[lg].forEach(day => {
      const path = lg === 'nba' ? 'basketball/nba' : 'soccer/' + lg;
      jobs.push(fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day}&limit=200`).then(r => r.json()).then(d => {
        (d.events || []).forEach(e => {
          const st = e.status && e.status.type;
          if (!st || st.state === 'pre' || /POSTPON|CANCEL|ABANDON|SUSPEND|DELAY/.test(st.name || '')) return;
          const c = e.competitions[0].competitors, h = c.find(x => x.homeAway === 'home'), a = c.find(x => x.homeAway === 'away');
          const id = (lg === 'nba' ? 'b' : '') + e.id;
          setLive(id, { s: st.state === 'post' ? 'post' : 'in', hs: +h.score || 0, as: +a.score || 0,
            c: st.state === 'post' ? '' : /HALFTIME/.test(st.name) ? t('ht') : (lg === 'nba' ? st.shortDetail : e.status.displayClock) || '',
            fin: st.name === 'STATUS_FULL_TIME' || st.name === 'STATUS_FINAL' });
        });
      }).catch(() => { }));
    }));
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
    if (d.lg) { flt.lg = flt.lg === d.lg ? 'all' : d.lg; flt.alim = 48; return render(); }
    if (d.day) { flt.day = d.day; flt.q = ''; flt.alim = 48; return render(); }
    if (d.rday) { flt.rday = d.rday; return render(); }
    if (d.dtab) { dtab = d.dtab; return render(); }
    if (d.fav) {
      const id = d.fav, on = !FAV.has(id);
      if (on) FAV.add(id); else FAV.delete(id);
      LS.set('fav', [...FAV]);
      if (SB && profile) SB.from('profiles').update({ favs: [...FAV] }).eq('id', profile.id).then(() => { });
      if (!FAV.size && flt.lg === 'fav') flt.lg = 'all';
      toast(fmt(t(on ? 'fav_added' : 'fav_removed'), { n: tn(id) }));
      const y = scrollY; render(); scrollTo(0, y); return;
    }
    if (d.sp) { flt.sp = d.sp; flt.rday = undefined; flt.alim = 48; return render(); }
    if (d.go) { flt.rday = undefined; location.hash = '#/' + d.go; return; }
    if (d.act === 'notif') return toggleNotif();
    if (d.act === 'share-slip') return shareSlip();
    if (d.act === 'share-molla') return shareMolla(d.cdate, d.ck);
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
    if (d.act === 'amore') { flt.alim += 48; const y = scrollY; render(); scrollTo(0, y); return; }
    if (d.act === 'lvall') { flt.lvall = !flt.lvall; return paintLive(); }
    if (d.act === 'tipadd') {
      slip = kPicks(MOLLA.coupons.find(x => x.date === d.cdate) || MOLLA.coupons[0], d.ck).filter(pkLive).slice(0, MAX_SEL).map(x => ({ m: x.id, k: x.k })); LS.set('slip', slip); slipErr = '';
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
    if (!/^#\/mac\//.test(location.hash)) dtab = 'pred';
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
