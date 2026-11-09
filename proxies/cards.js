/* Nightvault Proxies – card lookup (plan: plans/proxy.md).
   Name -> every printing of that card with a picture, for every game that has an online list or a daily card file.
   These are cut-down copies of the find functions in pocket/test_src.html (Pocket itself is not touched). If a source changes there,
   change it here too. Each printing: {set, number, showSet, showNum, name, setName, rarity, released, image (small), print (to print),
   hq (sharper, when the site has one), back (second face), alts (other addresses to try), price, currency}.
   PXC.GAMES = the games and their card sizes, PXC.SIZES = the common card sizes, PXC.find(game, name), PXC.suggest(game, text). */
const PXC = (() => {
  const NATIVE = !!(window.Capacitor && (typeof Capacitor.isNativePlatform === 'function' ? Capacitor.isNativePlatform() : typeof Capacitor.nativePromise === 'function'));
  const SITE = 'https://brokeuh.github.io/nightvault-pocket/', BASE = NATIVE ? SITE : '../';
  const enc = encodeURIComponent, sleep = ms => new Promise(r => setTimeout(r, ms));
  const num = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n };
  const normNum = n => { const m = /^0*(\d+)(.*)$/.exec(String(n ?? '').trim()); return m ? String(+m[1]) + m[2] : String(n ?? '').trim() };
  const pad = (v, w) => /^\d+$/.test(String(v)) ? String(v).padStart(w, '0') : String(v);
  const clean = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const slugOf = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  const lwr = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  function lev(a, b){ a = a.toLowerCase(); b = b.toLowerCase(); if(a === b) return 0; const d = Array.from({length:b.length + 1}, (_, i) => i);
    for(let i = 1; i <= a.length; i++){ let p = d[0]; d[0] = i; for(let j = 1; j <= b.length; j++){ const t = d[j]; d[j] = Math.min(d[j] + 1, d[j-1] + 1, p + (a[i-1] === b[j-1] ? 0 : 1)); p = t } } return d[b.length] }
  const sim = (a, b) => { const base = s => s.split(' - ')[0].trim(); a = base(a); b = base(b); const m = Math.max(a.length, b.length) || 1; return 1 - lev(a, b) / m };
  async function getJSON(url){ const r = await fetch(url, {headers:{Accept:'application/json'}}); if(!r.ok) throw Object.assign(new Error('HTTP ' + r.status), {status:r.status}); return r.json() }

  /* ---- common card sizes (mm) and the games ---- */
  const SIZES = [['Standard 63 × 88', 63, 88], ['Japanese small 59 × 86', 59, 86], ['Poker 63.5 × 88.9', 63.5, 88.9], ['Bridge 57 × 89', 57, 89], ['Mini American 41 × 63', 41, 63],
    ['Mini European 45 × 68', 45, 68], ['Tarot 70 × 120', 70, 120], ['Square 70 × 70', 70, 70], ['Large 89 × 127', 89, 127]];
  const G = (id, label, size, how, extra) => Object.assign({id, label, size, how}, extra || {});
  const GAMES = [
    G('mtg', 'Magic', [63, 88], 'Scryfall'), G('pokemon', 'Pokémon', [63, 88], 'Pokémon TCG API, TCGdex'), G('ygo', 'Yu-Gi-Oh!', [59, 86], 'YGOPRODeck'),
    G('lorcana', 'Lorcana', [63, 88], 'Lorcast'), G('swu', 'Star Wars: Unlimited', [63, 88], 'starwarsunlimited.com'), G('onepiece', 'One Piece', [63, 88], 'OPTCG API'),
    G('riftbound', 'Riftbound', [63, 88], 'Riftcodex'), G('swccg', 'Star Wars CCG', [63, 88], 'SWCCG Players Committee'),
    G('gundam', 'Gundam', [63, 88], 'daily card file'), G('digimon', 'Digimon', [63, 88], 'daily card file'), G('fab', 'Flesh and Blood', [63, 88], 'daily card file'),
    G('sorcery', 'Sorcery', [63, 88], 'daily card file'), G('ws', 'Weiss Schwarz', [59, 86], 'daily card file'), G('dbsfw', 'DB Fusion World', [63, 88], 'daily card file'),
    G('dbsm', 'DB Super Masters', [63, 88], 'daily card file'), G('dbz', 'Dragon Ball Z TCG', [63, 88], 'daily card file'),
    G('other', 'Other game (my own pictures)', [63, 88], '', {noLookup:true})];
  const DGAMES = ['gundam', 'digimon', 'fab', 'sorcery', 'ws', 'dbsfw', 'dbsm', 'dbz'];

  /* ---- Magic: Scryfall ---- */
  const mtgFace = (c, i) => ((c.card_faces && c.card_faces[i] && c.card_faces[i].image_uris) || {});
  const mtgMap = c => { const iu = c.image_uris || mtgFace(c, 0), bk = c.image_uris ? null : mtgFace(c, 1);
    return {game:'mtg', set:c.set.toLowerCase(), number:normNum(c.collector_number), showSet:c.set.toUpperCase(), showNum:c.collector_number, name:c.name, setName:c.set_name, rarity:c.rarity,
      released:c.released_at || '', image:iu.small || iu.normal || '', print:iu.large || iu.normal || '', hq:iu.png || '', back:bk ? (bk.large || bk.normal || '') : '', backHq:bk ? (bk.png || '') : '',
      price:num(c.prices && c.prices.eur) ?? num(c.prices && c.prices.usd), currency:(c.prices && c.prices.eur != null) ? 'EUR' : 'USD'} };
  /* a 404 from Scryfall means "no such card"; anything else (no connection, 429 slow down, 5xx) is a problem to tell the owner about, never "not found" */
  const nf = e => e && e.status === 404, net = e => new Error(e && e.status ? `The card site answered HTTP ${e.status}${e.status === 429 ? ' (too many requests - wait a moment)' : ''}` : 'No connection to the card site');
  async function mtgNamed(q){          // exact name, then Scryfall's fuzzy match (typos), then its autocomplete (part of a name); null = really not found
    for(const mode of ['exact', 'fuzzy']){ try{ return await getJSON(`https://api.scryfall.com/cards/named?${mode}=` + enc(q)) }catch(e){ if(!nf(e)) throw net(e) } }
    let ac; try{ ac = await getJSON('https://api.scryfall.com/cards/autocomplete?q=' + enc(q)) }catch(e){ if(!nf(e)) throw net(e); return null }
    if(!ac.data || !ac.data.length) return null;
    try{ return await getJSON('https://api.scryfall.com/cards/named?exact=' + enc(ac.data[0])) }catch(e){ if(nf(e)) return null; throw net(e) } }
  async function mtgOne(q, want){            // one printing, fast (a whole deck at once): the exact set + number when the list gives them, else Scryfall's usual printing
    if(want && want.set && want.number){ try{ return mtgMap(await getJSON(`https://api.scryfall.com/cards/${enc(want.set)}/${enc(want.number)}`)) }catch(e){ if(!nf(e) && e.status !== 400) throw net(e) } }
    const card = await mtgNamed(q); return card ? mtgMap(card) : null }
  async function mtgAll(q){
    const card = await mtgNamed(q); if(!card) return [];
    let prints = [card]; try{ let u = card.prints_search_uri + '&unique=prints', got = []; while(u && got.length < 300){ const j = await getJSON(u); got.push(...j.data); u = j.has_more ? j.next_page : null; if(u) await sleep(100) } if(got.length) prints = got }catch(e){}
    return prints.map(mtgMap) }

  /* ---- Pokémon: pokemontcg.io, then TCGdex ---- */
  const pkmMap = c => { const cm = (c.cardmarket || {}).prices || {}, tp = (c.tcgplayer || {}).prices || {}, tpv = Object.values(tp)[0] || {}, eur = cm.averageSellPrice ?? cm.trendPrice;
    return {game:'pokemon', set:c.set.id.toLowerCase(), number:normNum(c.number), showSet:(c.set.ptcgoCode || c.set.id).toUpperCase(), showNum:c.number + (c.set.printedTotal ? '/' + c.set.printedTotal : ''),
      name:c.name, setName:c.set.name, rarity:c.rarity || '', released:(c.set.releaseDate || '').replace(/\//g, '-'), image:(c.images || {}).small || '', print:(c.images || {}).large || (c.images || {}).small || '',
      price:eur ?? tpv.market ?? null, currency:eur != null ? 'EUR' : 'USD'} };
  async function findTCGdex(q){
    const list = await getJSON('https://api.tcgdex.net/v2/en/cards?name=' + enc(q)), top = (list || []).slice(0, 120);
    return top.map(c => { const sid = String(c.id.split('-')[0]);
      return {game:'pokemon', set:sid.toLowerCase(), number:normNum(c.localId), showSet:sid.toUpperCase(), showNum:c.localId, name:c.name, setName:'', rarity:'', released:'',
        image:c.image ? c.image + '/low.webp' : '', print:c.image ? c.image + '/high.webp' : '', price:null, currency:'EUR'} }) }
  async function findPokemon(q){
    const base = 'https://api.pokemontcg.io/v2/cards?pageSize=250&orderBy=-set.releaseDate&select=id,name,set,number,images,rarity,cardmarket,tcgplayer&q=';
    let r = await getJSON(base + enc(`name:"${q}"`)).catch(() => ({data:[], down:true}));
    if(r.down) return findTCGdex(q);
    if(!r.data || !r.data.length) return findTCGdex(q);
    return r.data.map(pkmMap) }

  /* ---- Yu-Gi-Oh!: YGOPRODeck (one printing per set; other artworks of a card come as extra printings) ---- */
  async function findYGO(q){
    const r = await getJSON('https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=' + enc(q)).catch(() => ({data:[]})), out = [];
    for(const c of (r.data || []).slice(0, 12)){
      const imgs = c.card_images || [], price = num((c.card_prices || [])[0] && c.card_prices[0].cardmarket_price), sets = c.card_sets && c.card_sets.length ? c.card_sets : [{set_code:'', set_name:'', set_rarity:''}], seen = new Set();
      for(const s of sets){ const [code, n] = String(s.set_code || '').split(/-(.*)/s); if(seen.has(s.set_code)) continue; seen.add(s.set_code);
        out.push({game:'ygo', set:(code || '').toLowerCase(), number:normNum(n || ''), showSet:code || '?', showNum:n || '', name:c.name, setName:s.set_name, rarity:s.set_rarity || '', released:'',
          image:(imgs[0] || {}).image_url_small || '', print:(imgs[0] || {}).image_url || '', price, currency:'EUR'}) }
      imgs.slice(1).forEach((im, i) => out.push({game:'ygo', set:'art' + (i + 2), number:String(c.id), showSet:'Art ' + (i + 2), showNum:'', name:c.name, setName:'Other artwork', rarity:'', released:'',
        image:im.image_url_small || '', print:im.image_url || '', price, currency:'EUR'}));
    }
    return out.slice(0, 300) }

  /* ---- Lorcana: Lorcast ---- */
  const lorMap = c => { const iu = (c.image_uris || {}).digital || c.image_uris || {}, p = c.prices || {};
    return {game:'lorcana', set:pad(String(c.set.code).toLowerCase(), 2), number:normNum(c.collector_number), showSet:String(c.set.code), showNum:c.collector_number, name:c.name + (c.version ? ' - ' + c.version : ''),
      setName:c.set.name, rarity:c.rarity || '', released:c.released_at || '', image:iu.small || iu.normal || '', print:iu.large || iu.normal || iu.small || '', price:num(p.usd), currency:'USD'} };
  async function findLorcana(q){ const r = await getJSON('https://api.lorcast.com/v0/cards/search?q=' + enc(q)); return (r.results || []).slice(0, 40).map(lorMap) }

  /* ---- Star Wars: Unlimited: the official list, then swu-db ---- */
  const SWUO = 'https://admin.starwarsunlimited.com/api/', _at = x => (x && x.data && (x.data.attributes || x.data)) || {};
  const swuVariant = a => ((((a.variantTypes || {}).data || [])[0] || {}).attributes || {}).name || 'Standard';
  function swuMapOfficial(c){ const a = c.attributes || c, ex = _at(a.expansion), art = _at(a.artFront), v = swuVariant(a), tag = v && !/^(normal|standard)$/i.test(v) ? v.split(' ').map(w => w[0]).join('').toUpperCase() : '';
    const url = ((art.formats || {}).card || {}).url || art.url || '';
    return {game:'swu', set:String(ex.code || '').toLowerCase(), number:normNum(String(a.cardNumber ?? '').padStart(3, '0')) + (tag ? '-' + tag.toLowerCase() : ''), showSet:String(ex.code || '').toUpperCase(),
      showNum:String(a.cardNumber ?? '') + (tag ? ' ' + tag : ''), name:(a.title || '') + (a.subtitle ? ' - ' + a.subtitle : ''), setName:String(ex.code || '').toUpperCase() + (v !== 'Standard' ? ' · ' + v : ''),
      rarity:_at(a.rarity).name || '', released:'', image:url, print:((art.formats || {}).large || {}).url || url, price:null, currency:'USD'} }
  const swuMapDb = c => ({game:'swu', set:String(c.Set).toLowerCase(), number:normNum(c.Number), showSet:String(c.Set).toUpperCase(), showNum:c.Number, name:c.Name + (c.Subtitle ? ' - ' + c.Subtitle : ''),
    setName:String(c.Set).toUpperCase() + (c.VariantType && c.VariantType !== 'Normal' ? ' · ' + c.VariantType : ''), rarity:c.Rarity || '', released:'', image:c.FrontArt || '', print:c.FrontArt || '', price:num(c.MarketPrice), currency:'USD'});
  async function findSWU(q){
    try{ const get = t => getJSON(`${SWUO}card-list?locale=en&pagination[pageSize]=40&filters[variantTypes][name][$notContainsi]=foil&filters[title][$containsi]=${enc(t)}`);
      let j = await get(q); if(!(j.data || []).length){ const w = q.split(/\s+-\s+|,/)[0].trim(); if(w !== q && w.length >= 3) j = await get(w) }
      const out = (j.data || []).filter(c => !/foil|prerelease|judge/i.test(swuVariant(c.attributes || c))).map(swuMapOfficial); if(out.length) return out }catch(e){}
    const r = await getJSON('https://api.swu-db.com/cards/search?q=' + enc(q)); return (r.data || []).slice(0, 40).map(swuMapDb) }

  /* ---- Riftbound: Riftcodex (pictures from riftbound.gg) ---- */
  async function findRiftbound(q){
    const r = await getJSON('https://api.riftcodex.com/cards/name?fuzzy=' + enc(q) + '&size=40');
    return (r.items || []).map(c => { const sid = String((c.set || {}).set_id || '').toUpperCase(), cn = String(c.collector_number ?? ''), dg = k => `https://static.dotgg.gg/riftbound/cards/${k}.webp`, n = c.riftbound_id || `${sid}-${cn.padStart(3, '0')}`;
      const main = dg(`${sid}-${cn.padStart(3, '0')}`);
      return {game:'riftbound', set:sid.toLowerCase(), number:normNum(n), showSet:sid, showNum:cn, name:c.name, setName:(c.set || {}).label || sid, rarity:(c.classification || {}).rarity || '', released:'',
        image:main, print:main, alts:[dg(`OGN-${cn.padStart(3, '0')}`), dg(`SFD-${cn.padStart(3, '0')}`), (c.media || {}).image_url || ''].filter(Boolean), price:null, currency:'EUR'} }) }

  /* ---- One Piece: OPTCG API (the whole list is read once) ---- */
  let OPDB = null;
  const opdb = () => { if(!OPDB) OPDB = Promise.all(['allSetCards', 'allSTCards'].map(p => getJSON(`https://optcgapi.com/api/${p}/`).catch(() => []))).then(a => a.flat()); return OPDB };
  const opBase = n => String(n || '').replace(/\s*\((\d{3}|parallel|alternate art|sp|manga|[A-Z]{2,3}\d{2}-\d{3})\)/gi, '').trim();
  async function findOnePiece(q){
    const all = await opdb(); if(!all.length){ OPDB = null; throw new Error('The One Piece list is not available right now') }
    const hits = [];
    for(const c of all){ const nm = opBase(c.card_name), sm = sim(q, nm); if(sm >= 0.6) hits.push([sm, c, nm]) }
    hits.sort((a, b) => b[0] - a[0]);
    return hits.slice(0, 30).map(([, c, nm]) => { const [st, n] = String(c.card_set_id || '').split('-'), v = String(c.card_image_id || '').split('_')[1];
      return {game:'onepiece', set:String(st).toLowerCase(), number:normNum(n) + (v ? '-' + v : ''), showSet:st, showNum:n + (v ? ' ' + v.toUpperCase() : ''), name:nm + (/parallel/i.test(c.card_name) ? ' (Parallel)' : ''),
        setName:c.set_name || '', rarity:c.rarity || '', released:'', image:c.card_image || '', print:c.card_image || '', price:num(c.market_price), currency:'USD'} }) }

  /* ---- Star Wars CCG: Players Committee list ---- */
  let SWDB = null;
  const swdb = () => { if(!SWDB) SWDB = Promise.all(['Light', 'Dark'].map(x => getJSON(`https://cdn.jsdelivr.net/gh/swccgpc/swccg-card-json@main/${x}.json`).then(j => j.cards || []))).then(a => a.flat()).catch(e => { SWDB = null; throw e }); return SWDB };
  async function findSWCCG(q){
    const all = await swdb(), hits = [];
    for(const c of all){ const nm = String((c.front || {}).title || '').replace(/[•<>]/g, '').trim(), sm = sim(q, nm); if(sm >= 0.6) hits.push([sm, c, nm]) }
    hits.sort((a, b) => b[0] - a[0]);
    return hits.slice(0, 30).map(([, c, nm]) => { const img = (c.front || {}).imageUrl || '', label = ((img.split('/cards/')[1] || '').split('/')[0] || '').replace(/-(Light|Dark)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
      return {game:'swccg', set:String(c.set || '').toLowerCase(), number:String(c.gempId || c.id), showSet:label || 'Set ' + c.set, showNum:String(c.gempId || c.id), name:nm, setName:(c.side ? c.side + ' side' : ''), rarity:c.rarity || '', released:'',
        image:img, print:img, back:(c.back || {}).imageUrl && (c.back || {}).imageUrl !== img ? (c.back || {}).imageUrl : '', price:null, currency:'USD'} }) }

  /* ---- games read from a daily card file (data/<game>.json, made by GitHub from TCGplayer's price list) ---- */
  const _dg = {};
  const dgData = g => _dg[g] || (_dg[g] = (async () => {
    for(const u of [`${BASE}data/${g}.json`, `https://raw.githubusercontent.com/brokeuh/nightvault-pocket/main/data/${g}.json`]) try{ const d = await getJSON(u); if(d && d.cards) return d }catch(e){}
    delete _dg[g]; throw new Error('The card list of this game is not available right now') })());
  async function findDG(g, q){
    const d = await dgData(g), b = lwr(q), hits = []; if(!b) return [];
    for(const r of d.cards){ const n = lwr(r[2]); let sc = n === b ? 1 : (n.includes(b) || (b.length > 5 && b.includes(n))) ? 0.9 : 0;
      if(!sc && n[0] === b[0] && Math.abs(n.length - b.length) < 8){ const x = sim(q, r[2]); if(x >= 0.6) sc = x } if(sc) hits.push([sc, r]) }
    hits.sort((a, c) => c[0] - a[0]);
    return hits.slice(0, 40).map(([, r]) => { const st = d.sets[r[0]] || {}, pid = r[4], small = r[7] ? (d.imgBase ? d.imgBase.replace('{}', r[7]) : r[7]) : (pid ? `https://tcgplayer-cdn.tcgplayer.com/product/${pid}_200w.jpg` : '');
      return {game:g, set:st.code, number:r[1] ? normNum(r[1]) : slugOf(r[2]), showSet:String(st.code || '').toUpperCase(), showNum:r[1] || '', name:r[2], setName:st.name || '', rarity:r[3] || '', released:st.released || '',
        image:small, print:pid ? `https://tcgplayer-cdn.tcgplayer.com/product/${pid}_in_1000x1000.jpg` : small, alts:small ? [small] : [], price:r[5] ?? null, currency:'USD'} }) }

  const FINDERS = {pokemon:findPokemon, ygo:findYGO, lorcana:findLorcana, swu:findSWU, riftbound:findRiftbound, onepiece:findOnePiece, swccg:findSWCCG, mtg:mtgAll};
  /* PXC.find(game, name) -> every printing; PXC.one(game, name, want) -> one printing, fast (Magic: a single request) */
  const find = async (game, name) => game === 'other' ? [] : DGAMES.includes(game) ? findDG(game, name) : FINDERS[game](name);
  const one = async (game, name, want) => game === 'mtg' ? mtgOne(name, want) : null;
  async function suggest(game, q){ if(game !== 'mtg' || q.length < 2) return []; try{ return (await getJSON('https://api.scryfall.com/cards/autocomplete?q=' + enc(q))).data || [] }catch(e){ return [] } }
  const front = n => String(n || '').split(' // ')[0];
  const sameName = (a, b) => { const x = lwr(front(a)), y = lwr(front(b)); return x === y || lwr(a) === lwr(b) || lwr(String(a).replace(/ - .*$/, '')) === y };

  /* ---- Community art: MPC Autofill (mpcfill.com). Its server only answers its own website in a browser, so this works in the Android app only.
     card id = Google Drive file id; lh4.googleusercontent.com/d/<id>=h<px> gives any height. ---- */
  const MPC = 'https://mpcfill.com/', lh4 = (id, h) => `https://lh4.googleusercontent.com/d/${id}=h${h}`;
  let _mpcSrc = null;
  async function mpcCall(path, body){
    const url = MPC + path, H = NATIVE && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp;
    try{
      if(H){ const r = await H.request({url, method:body ? 'POST' : 'GET', headers:body ? {'Content-Type':'application/json', Accept:'application/json'} : {Accept:'application/json'}, data:body || undefined, responseType:'json'});
        if(r.status >= 400) throw Object.assign(new Error('MPC Autofill answered HTTP ' + r.status + (r.status === 403 ? ' (its security check may have refused the app)' : '')), {status:r.status});
        return typeof r.data === 'string' ? JSON.parse(r.data) : r.data }
      const r = await fetch(url, body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {}); if(!r.ok) throw Object.assign(new Error('MPC Autofill answered HTTP ' + r.status), {status:r.status}); return r.json();
    }catch(e){ if(e.status) throw e; throw new Error(H ? 'No connection to MPC Autofill' : 'MPC Autofill can only be reached from the Android app') }
  }
  async function mpcSources(){ if(_mpcSrc) return _mpcSrc; const j = await mpcCall('2/sources/'); _mpcSrc = Object.values(j.results || {}).map(x => x.pk); return _mpcSrc }
  async function mpcSearch(name, max){
    const q = String(name || '').trim(); if(!q) return []; const srcs = await mpcSources();
    const ask = fuzzy => mpcCall('3/editorSearch/', {queries:{q:{query:q, cardType:'CARD'}}, searchSettings:{filterSettings:{excludesTags:[], includesTags:[], languages:[], maximumDPI:1500, minimumDPI:0, maximumSize:30},
      searchTypeSettings:{fuzzySearch:fuzzy, filterCardbacks:false}, sourceSettings:{sources:srcs.map(pk => [pk, true])}}});
    let ids = ((await ask(false)).results || {}).q || []; if(!ids.length) ids = ((await ask(true)).results || {}).q || [];
    ids = ids.slice(0, max || 40); if(!ids.length) return [];
    const det = (await mpcCall('2/cards/', {cardIdentifiers:ids})).results || {};
    return ids.filter(id => det[id]).map(id => { const c = det[id];
      return {kind:'mpc', id, name:c.name, artist:c.sourceName, dpi:c.dpi, language:c.language, sizeMB:Math.round(c.size / 1048576 * 10) / 10, tags:c.tags || [], image:c.mediumThumbnailUrl || c.smallThumbnailUrl || '', print:lh4(id, 1500), hq:lh4(id, 2200), link:c.sourceExternalLink || ''} });
  }
  return {GAMES, SIZES, find, one, suggest, sameName, sim, lwr, NATIVE, getJSON, mpcSearch};
})();
