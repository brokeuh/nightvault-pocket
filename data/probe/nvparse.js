// copy of the tag/chapter readers of audio/index.html, for the probe workflow
const NATIVE=false;
/* ---------- reading tags, chapters and length from the files ---------- */
const AUDIO_RE = /\.(mp3|m4a|m4b|mp4|aac|ogg|oga|opus|flac|wav|webm|mka)$/i;
const IMG_RE = /\.(jpe?g|png|webp)$/i;
const MIME = {mp3:'audio/mpeg', m4a:'audio/mp4', m4b:'audio/mp4', mp4:'audio/mp4', aac:'audio/aac', ogg:'audio/ogg', oga:'audio/ogg', opus:'audio/ogg', flac:'audio/flac', wav:'audio/wav', webm:'audio/webm', mka:'audio/webm'};
const ext = n => (n.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
const rd = (b, a, z) => b.slice(a, Math.min(z, b.size)).arrayBuffer();
const latin = (u8, a, z) => { let s = ''; for(let i = a; i < z; i++) s += String.fromCharCode(u8[i]); return s };
const utf8 = new TextDecoder('utf-8');

/* MP4 / M4A / M4B: tags (ilst), length (mvhd), chapters (QuickTime chapter track, else Nero 'chpl') */
async function mp4Info(blob){
  let off = 0, moov = null;
  for(let n = 0; n < 64 && off + 8 <= blob.size; n++){
    const h = new DataView(await rd(blob, off, off + 16)); let size = h.getUint32(0), hl = 8; const type = latin(new Uint8Array(h.buffer), 4, 8);
    if(size === 1 && h.byteLength >= 16){ size = Number(h.getBigUint64(8)); hl = 16 } else if(size === 0) size = blob.size - off;
    if(size < hl) break;
    if(type === 'moov'){ if(size > 96e6) return null; moov = new DataView(await rd(blob, off, off + size)); break }
    off += size }
  if(!moov) return null;
  const u8 = new Uint8Array(moov.buffer);
  const kids = (s, e) => { const out = []; let p = s; while(p + 8 <= e){ let sz = moov.getUint32(p), hl = 8; const t = latin(u8, p + 4, p + 8);
      if(sz === 1){ sz = Number(moov.getBigUint64(p + 8)); hl = 16 } else if(sz === 0) sz = e - p;
      if(sz < hl || p + sz > e) break; out.push({t, s:p + hl, e:p + sz}); p += sz } return out };
  const one = (box, t) => box && kids(box.s, box.e).find(k => k.t === t);
  const path = (box, ...ts) => { for(const t of ts){ box = one(box, t); if(!box) return null } return box };
  const top = {s:8, e:moov.byteLength}, info = {tags:{}, chapters:[], dur:0};
  const mvhd = one(top, 'mvhd');
  if(mvhd){ const v = moov.getUint8(mvhd.s); const ts = moov.getUint32(mvhd.s + (v ? 20 : 12)); const d = v ? Number(moov.getBigUint64(mvhd.s + 24)) : moov.getUint32(mvhd.s + 16); if(ts) info.dur = d / ts }
  // tags
  const meta = path(top, 'udta', 'meta') || one(top, 'meta');
  const ilst = meta && kids(meta.s + 4, meta.e).find(k => k.t === 'ilst');
  if(ilst) for(const it of kids(ilst.s, ilst.e)){ const d = one(it, 'data'); if(!d || d.e - d.s < 8) continue;
    const kind = moov.getUint32(d.s) & 0xffffff, a = d.s + 8, z = d.e, key = it.t.replace('\xa9', '@');
    if(key === 'covr'){ info.tags.cover = new Blob([u8.slice(a, z)], {type:kind === 14 ? 'image/png' : 'image/jpeg'}); continue }
    if(key === 'trkn' || key === 'disk'){ if(z - a >= 4) info.tags[key === 'trkn' ? 'track' : 'disc'] = moov.getUint16(a + 2); continue }
    const map = {'@nam':'title', '@ART':'artist', 'aART':'albumartist', '@alb':'album', '@wrt':'composer', '@day':'year', 'desc':'desc', '@nrt':'narrator'};
    if(map[key] && kind === 1) info.tags[map[key]] = utf8.decode(u8.slice(a, z)).trim() }
  // chapters: QuickTime chapter track (text samples)
  try{
    const traks = kids(top.s, top.e).filter(k => k.t === 'trak'), byId = {}; let chapId = 0;
    for(const tr of traks){ const tk = one(tr, 'tkhd'); if(!tk) continue; const v = moov.getUint8(tk.s); byId[moov.getUint32(tk.s + (v ? 20 : 12))] = tr;
      const chap = path(tr, 'tref', 'chap'); if(chap && chap.e - chap.s >= 4) chapId = moov.getUint32(chap.s) }
    const ct = chapId && byId[chapId];
    if(ct){ const mdhd = path(ct, 'mdia', 'mdhd'), stbl = path(ct, 'mdia', 'minf', 'stbl');
      const v = moov.getUint8(mdhd.s), ts = moov.getUint32(mdhd.s + (v ? 20 : 12));
      const stts = one(stbl, 'stts'), stsz = one(stbl, 'stsz'), stsc = one(stbl, 'stsc'), stco = one(stbl, 'stco') || one(stbl, 'co64'), big = stco && stco.t === 'co64';
      const times = []; { let t = 0; const n = moov.getUint32(stts.s + 4); for(let i = 0; i < n; i++){ const c = moov.getUint32(stts.s + 8 + i * 8), d = moov.getUint32(stts.s + 12 + i * 8); for(let j = 0; j < c; j++){ times.push(t); t += d } } }
      const fixed = moov.getUint32(stsz.s + 4), ns = moov.getUint32(stsz.s + 8), sizes = []; for(let i = 0; i < ns; i++) sizes.push(fixed || moov.getUint32(stsz.s + 12 + i * 4));
      const nc = moov.getUint32(stco.s + 4), chunks = []; for(let i = 0; i < nc; i++) chunks.push(big ? Number(moov.getBigUint64(stco.s + 8 + i * 8)) : moov.getUint32(stco.s + 8 + i * 4));
      const ne = moov.getUint32(stsc.s + 4), ent = []; for(let i = 0; i < ne; i++) ent.push([moov.getUint32(stsc.s + 8 + i * 12), moov.getUint32(stsc.s + 12 + i * 12)]);
      const offs = []; let si = 0;
      for(let c = 0; c < nc && si < ns; c++){ let per = 1; for(const [first, spc] of ent) if(c + 1 >= first) per = spc; let o = chunks[c]; for(let k = 0; k < per && si < ns; k++){ offs.push(o); o += sizes[si]; si++ } }
      if(offs.length && ts){ const lo = Math.min(...offs), hi = Math.max(...offs.map((o, i) => o + sizes[i]));
        // the chapter names sit together (one read) or spread through the whole book, e.g. LibriVox (one small read each)
        const near = hi - lo < 4e6, all = near ? new Uint8Array(await rd(blob, lo, hi)) : null;
        for(let i = 0; i < offs.length && i < 2000; i++){
          const b = near ? all.subarray(offs[i] - lo, offs[i] - lo + sizes[i]) : new Uint8Array(await rd(blob, offs[i], offs[i] + Math.min(sizes[i], 4096)));
          if(b.length < 2) continue; const len = (b[0] << 8) | b[1], s = b.slice(2, 2 + len);
          const title = (s[0] === 0xfe && s[1] === 0xff) ? new TextDecoder('utf-16be').decode(s.slice(2)) : utf8.decode(s);
          info.chapters.push({t:times[i] / ts, title:title.trim()}) } } }
  }catch(e){ info.chapters = [] }
  // chapters: Nero chpl
  if(!info.chapters.length){ const ch = path(top, 'udta', 'chpl');
    if(ch){ try{ const v = moov.getUint8(ch.s); let p = ch.s + 4 + (v ? 4 : 0); const n = moov.getUint8(p++);
      for(let i = 0; i < n && p + 9 <= ch.e; i++){ const t = Number(moov.getBigUint64(p)) / 1e7, l = moov.getUint8(p + 8); info.chapters.push({t, title:utf8.decode(u8.slice(p + 9, p + 9 + l)).trim()}); p += 9 + l } }catch(e){} } }
  info.chapters.sort((a, b) => a.t - b.t);
  return info }

/* MP3: ID3v2 tags, picture and CHAP chapters; length from the Xing/VBRI header or the bitrate */
function id3text(b, enc){ let s;
  if(enc === 0) s = latin(b, 0, b.length);
  else if(enc === 1){ const be = b[0] === 0xfe && b[1] === 0xff; s = new TextDecoder(be ? 'utf-16be' : 'utf-16le').decode((b[0] === 0xfe || b[0] === 0xff) ? b.slice(2) : b) }
  else if(enc === 2) s = new TextDecoder('utf-16be').decode(b);
  else s = utf8.decode(b);
  return s.split('\0')[0].trim() }
function id3frames(b, v, a, z, out){
  const ssafe = (p) => (b[p] << 21) | (b[p + 1] << 14) | (b[p + 2] << 7) | b[p + 3];
  let p = a;
  while(p + (v === 2 ? 6 : 10) <= z){
    let id, size, hl;
    if(v === 2){ id = latin(b, p, p + 3); size = (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]; hl = 6 }
    else { id = latin(b, p, p + 4); size = v === 4 ? ssafe(p + 4) : ((b[p + 4] << 24) >>> 0) + (b[p + 5] << 16) + (b[p + 6] << 8) + b[p + 7]; hl = 10 }
    if(!/^[A-Z0-9]{3,4}$/.test(id) || size <= 0 || p + hl + size > z) break;
    const s = p + hl, e = s + size, f = b.subarray(s, e);
    const T = {TIT2:'title', TT2:'title', TPE1:'artist', TP1:'artist', TPE2:'albumartist', TP2:'albumartist', TALB:'album', TAL:'album', TCOM:'composer', TCM:'composer', TYER:'year', TDRC:'year', TYE:'year', TRCK:'track', TRK:'track', TPOS:'disc', TPA:'disc'};
    if(T[id]){ const val = id3text(f.subarray(1), f[0]); if(T[id] === 'track' || T[id] === 'disc') out.tags[T[id]] = parseInt(val) || 0; else if(val) out.tags[T[id]] = val }
    else if((id === 'APIC' || id === 'PIC') && !out.tags.cover){
      const enc = f[0]; let q = 1, mime;
      if(id === 'PIC'){ mime = /png/i.test(latin(f, 1, 4)) ? 'image/png' : 'image/jpeg'; q = 4 } else { const m0 = q; while(q < f.length && f[q]) q++; mime = latin(f, m0, q) || 'image/jpeg'; q++ }
      q++;  // picture type
      if(enc === 1 || enc === 2){ while(q + 1 < f.length && (f[q] || f[q + 1])) q += 2; q += 2 } else { while(q < f.length && f[q]) q++; q++ }
      if(!/^image\//.test(mime)) mime = /png/i.test(mime) ? 'image/png' : 'image/jpeg';
      if(q < f.length) out.tags.cover = new Blob([f.slice(q)], {type:mime}) }
    else if(id === 'CHAP'){ let q = 0; while(q < f.length && f[q]) q++; q++;
      const dv = new DataView(f.buffer, f.byteOffset, f.byteLength), start = dv.getUint32(q) / 1000; const sub = {tags:{}, chapters:[]};
      id3frames(f, v, q + 16, f.length, sub); out.chapters.push({t:start, title:sub.tags.title || ''}) }
    p = e }
}
async function mp3Info(blob){
  const out = {tags:{}, chapters:[], dur:0}; let start = 0;
  const h = new Uint8Array(await rd(blob, 0, 10));
  if(h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33){
    const v = h[3], fl = h[5], size = ((h[6] << 21) | (h[7] << 14) | (h[8] << 7) | h[9]) + 10;
    start = size + (fl & 0x10 ? 10 : 0);
    if(size < 64e6){ const b = new Uint8Array(await rd(blob, 0, size)); let a = 10;
      if(fl & 0x40 && v >= 3){ a += v === 4 ? ((b[10] << 21) | (b[11] << 14) | (b[12] << 7) | b[13]) : (((b[10] << 24) >>> 0) + (b[11] << 16) + (b[12] << 8) + b[13] + 4) }
      try{ id3frames(b, v, a, size, out) }catch(e){} } }
  out.chapters.sort((x, y) => x.t - y.t);
  // first audio frame
  try{ const b = new Uint8Array(await rd(blob, start, start + 65536));
    for(let i = 0; i + 4 < b.length; i++){ if(b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
      const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, bi = b[i + 2] >> 4, ri = (b[i + 2] >> 2) & 3, mono = (b[i + 3] >> 6) === 3;
      if(ver === 1 || layer !== 1 || bi === 0 || bi === 15 || ri === 3) continue;   // only MPEG layer III
      const v1 = ver === 3, sr = [[11025, 12000, 8000], null, [22050, 24000, 16000], [44100, 48000, 32000]][ver][ri];
      const br = (v1 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bi] * 1000;
      const spf = v1 ? 1152 : 576, side = v1 ? (mono ? 17 : 32) : (mono ? 9 : 17), dv = new DataView(b.buffer);
      const x = i + 4 + side, tag = latin(b, x, x + 4);
      if((tag === 'Xing' || tag === 'Info') && x + 12 <= b.length && (dv.getUint32(x + 4) & 1)) out.dur = dv.getUint32(x + 8) * spf / sr;
      else if(latin(b, i + 36, i + 40) === 'VBRI' && i + 54 <= b.length) out.dur = dv.getUint32(i + 50) * spf / sr;
      else out.dur = (blob.size - start - i) * 8 / br;
      break } }catch(e){}
  return out }


const fs=require('fs'); const buf=fs.readFileSync(process.argv[2]); const blob=new Blob([buf]);
(async()=>{ const i=await mp4Info(blob); console.log(JSON.stringify({dur:i&&i.dur, tags:i&&Object.keys(i.tags), title:i&&i.tags.album, chapters:i&&i.chapters.length, first:i&&i.chapters.slice(0,4), last:i&&i.chapters.slice(-2)}, null, 1)) })().catch(e=>console.log('ERROR', e.stack));
