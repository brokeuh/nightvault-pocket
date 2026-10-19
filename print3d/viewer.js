/* Nightvault 3D Print – NVMESH: reads 3D model files and draws them. No outside libraries.
   NVMESH.parse(bytes, name)        → {pos:Float32Array (9 numbers per triangle, Z is up, mm), tris, min:[x,y,z], max:[x,y,z], dims:[x,y,z], fmt}
                                      STL (binary and text), OBJ (Y up → turned to Z up), 3MF (objects, components and build transforms)
   NVMESH.unzip(blob)               → {names, has(name), read(name) → Uint8Array, blob(name, type) → Blob}   (ZIP / 3MF; deflate via DecompressionStream)
   NVMESH.zipInfo(blob)             → for a 3MF: {thumb:Blob|null, slice:{time, grams, fil:[{type, color, g, m}], plates}|null, project:{printer, filament, layer, nozzle}|null}
   new NVMESH.Viewer(canvas, opts)  → .setMesh(mesh) .reset() .setColor('#hex') .autoRotate(on) .draw() .destroy()  (rotate: drag; zoom: pinch / wheel; move: two fingers / right drag)
   NVMESH.snapshot(mesh, size)      → Promise<Blob> a picture for the tile (three-quarter view, see-through background)
   Plan: plans/print3d.md in nightvault-src. */
(function(){
'use strict';
const MAX_VIEW = 1200000, MAX_SNAP = 150000;

/* ---------------- ZIP (3MF files and Printables / Thingiverse downloads are ZIP files) ---------------- */
async function inflate(u8){
  if(typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open packed (ZIP / 3MF) files');
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer()) }
async function unzip(blob){
  const size = blob.size, tailLen = Math.min(size, 65557), tail = new DataView(await blob.slice(size - tailLen).arrayBuffer());
  let eo = -1; for(let i = tailLen - 22; i >= 0; i--) if(tail.getUint32(i, true) === 0x06054b50){ eo = i; break }
  if(eo < 0) throw new Error('Not a ZIP file (or it is damaged)');
  let count = tail.getUint16(eo + 10, true), cdSize = tail.getUint32(eo + 12, true), cdOff = tail.getUint32(eo + 16, true);
  if(cdOff === 0xffffffff || count === 0xffff){ /* ZIP64 */
    const lo = eo - 20; if(lo < 0 || tail.getUint32(lo, true) !== 0x07064b50) throw new Error('This ZIP file is too big to open here');
    const z64 = Number(tail.getBigUint64(lo + 8, true)), r = new DataView(await blob.slice(z64, z64 + 56).arrayBuffer());
    count = Number(r.getBigUint64(32, true)); cdSize = Number(r.getBigUint64(40, true)); cdOff = Number(r.getBigUint64(48, true)) }
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer()), td = new TextDecoder(), E = {};
  let p = 0;
  for(let i = 0; i < count && p + 46 <= cd.byteLength; i++){
    if(cd.getUint32(p, true) !== 0x02014b50) break;
    const flags = cd.getUint16(p + 8, true), method = cd.getUint16(p + 10, true); let csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true); let off = cd.getUint32(p + 42, true);
    const nb = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl), name = (flags & 0x800) ? td.decode(nb) : td.decode(nb);
    if(usize === 0xffffffff || csize === 0xffffffff || off === 0xffffffff){ let q = p + 46 + nl; const qe = q + xl;
      while(q + 4 <= qe){ const id = cd.getUint16(q, true), l = cd.getUint16(q + 2, true); if(id === 1){ let r = q + 4;
          if(usize === 0xffffffff){ usize = Number(cd.getBigUint64(r, true)); r += 8 } if(csize === 0xffffffff){ csize = Number(cd.getBigUint64(r, true)); r += 8 } if(off === 0xffffffff) off = Number(cd.getBigUint64(r, true)) } q += 4 + l } }
    if(!name.endsWith('/')) E[name] = {name, method, csize, usize, off, enc:flags & 1};
    p += 46 + nl + xl + cl }
  const find = n => E[n] || E[Object.keys(E).find(k => k.toLowerCase() === String(n).toLowerCase())];
  async function read(n){ const e = find(n); if(!e) throw new Error('Not in the ZIP: ' + n); if(e.enc) throw new Error('This ZIP file has a password');
    const h = new DataView(await blob.slice(e.off, e.off + 30).arrayBuffer()); if(h.getUint32(0, true) !== 0x04034b50) throw new Error('Damaged ZIP file');
    const start = e.off + 30 + h.getUint16(26, true) + h.getUint16(28, true), raw = new Uint8Array(await blob.slice(start, start + e.csize).arrayBuffer());
    if(e.method === 0) return raw; if(e.method === 8) return inflate(raw); throw new Error('Unknown packing in the ZIP (' + e.method + ')') }
  return {names:Object.keys(E), entries:E, has:n => !!find(n), read, size:n => (find(n) || {}).usize || 0,
    blob:async (n, type) => new Blob([await read(n)], {type:type || ''})} }

/* ---------------- STL ---------------- */
function parseSTL(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), size = u8.byteLength;
  const n = size >= 84 ? dv.getUint32(80, true) : 0;
  const head = new TextDecoder().decode(u8.subarray(0, Math.min(size, 512))).trimStart().toLowerCase();
  const looksText = head.startsWith('solid') && /facet|endsolid/.test(new TextDecoder().decode(u8.subarray(0, Math.min(size, 4096))).toLowerCase());
  if(n > 0 && 84 + 50 * n === size || (!looksText && n > 0 && 84 + 50 * n <= size)){
    const pos = new Float32Array(n * 9);
    for(let i = 0, o = 84; i < n; i++, o += 50){ const b = i * 9; for(let k = 0; k < 9; k++) pos[b + k] = dv.getFloat32(o + 12 + k * 4, true) }
    return {pos, fmt:'STL (binary)'} }
  const txt = new TextDecoder().decode(u8), re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g, out = [];
  let m; while((m = re.exec(txt))) out.push(+m[1], +m[2], +m[3]);
  const t = Math.floor(out.length / 9); if(!t) throw new Error('No triangles found in this STL file');
  return {pos:Float32Array.from(out.slice(0, t * 9)), fmt:'STL (text)'} }

/* ---------------- OBJ (Y is up in most OBJ files: turned so Z is up like STL / 3MF) ---------------- */
function parseOBJ(u8){
  const txt = new TextDecoder().decode(u8), v = [], out = [];
  let i = 0; const L = txt.length;
  while(i < L){ let j = txt.indexOf('\n', i); if(j < 0) j = L; const line = txt.slice(i, j); i = j + 1;
    if(line.charCodeAt(0) === 118 && line.charCodeAt(1) === 32){ const p = line.trim().split(/\s+/); v.push(+p[1], +p[2], +p[3]) }
    else if(line.charCodeAt(0) === 102 && line.charCodeAt(1) === 32){ const p = line.trim().split(/\s+/).slice(1).map(s => { const k = parseInt(s, 10); return k > 0 ? k - 1 : v.length / 3 + k });
      for(let k = 1; k < p.length - 1; k++) for(const q of [p[0], p[k], p[k + 1]]){ out.push(v[q * 3], v[q * 3 + 1], v[q * 3 + 2]) } } }
  if(!out.length) throw new Error('This OBJ file has no faces');
  const pos = new Float32Array(out.length);
  for(let k = 0; k < out.length; k += 3){ pos[k] = out[k]; pos[k + 1] = -out[k + 2]; pos[k + 2] = out[k + 1] }
  return {pos, fmt:'OBJ'} }

/* ---------------- 3MF: objects (mesh or components), build items, transforms (row vectors: p' = p·M) ---------------- */
const attrs = s => { const o = {}; s.replace(/([\w:]+)\s*=\s*"([^"]*)"/g, (m, k, v) => { o[k] = v; return '' }); return o };
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const tf = s => { const a = String(s || '').trim().split(/\s+/).map(Number); return a.length === 12 && a.every(isFinite) ? a : I3 };
const mul = (a, b) => [   /* a then b */
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  a[9] * b[0] + a[10] * b[3] + a[11] * b[6] + b[9], a[9] * b[1] + a[10] * b[4] + a[11] * b[7] + b[10], a[9] * b[2] + a[10] * b[5] + a[11] * b[8] + b[11]];
function modelFile(txt){
  const objs = {}, re = /<(?:\w+:)?object\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?object>/g; let m;
  while((m = re.exec(txt))){ const a = attrs(m[1]), body = m[2], o = {id:a.id, mesh:null, comps:[]};
    if(/<(?:\w+:)?mesh\b/.test(body)){ const v = [], t = [];
      const vr = /<(?:\w+:)?vertex\b([^>]*?)\/?>/g; let x; while((x = vr.exec(body))){ const q = x[1]; v.push(+(/\bx="([^"]*)"/.exec(q) || [0, 0])[1], +(/\by="([^"]*)"/.exec(q) || [0, 0])[1], +(/\bz="([^"]*)"/.exec(q) || [0, 0])[1]) }
      const tr = /<(?:\w+:)?triangle\b([^>]*?)\/?>/g; while((x = tr.exec(body))){ const q = x[1]; t.push(+(/\bv1="(\d+)"/.exec(q) || [0, 0])[1], +(/\bv2="(\d+)"/.exec(q) || [0, 0])[1], +(/\bv3="(\d+)"/.exec(q) || [0, 0])[1]) }
      if(t.length) o.mesh = {v, t} }
    const cr = /<(?:\w+:)?component\b([^>]*?)\/?>/g; let c; while((c = cr.exec(body))){ const q = attrs(c[1]); o.comps.push({obj:q.objectid, path:q['p:path'] || q.path || '', M:tf(q.transform)}) }
    objs[o.id] = o }
  const items = []; const bm = /<(?:\w+:)?build\b[^>]*>([\s\S]*?)<\/(?:\w+:)?build>/.exec(txt);
  if(bm){ const ir = /<(?:\w+:)?item\b([^>]*?)\/?>/g; let x; while((x = ir.exec(bm[1]))){ const q = attrs(x[1]); if(q.printable === '0') continue; items.push({obj:q.objectid, path:q['p:path'] || '', M:tf(q.transform)}) } }
  return {objs, items} }
async function parse3MF(blob){
  const z = await unzip(blob), td = new TextDecoder();
  let root = '3D/3dmodel.model';
  if(z.has('_rels/.rels')){ const r = td.decode(await z.read('_rels/.rels')), m = /Target="\/?([^"]+\.model)"/i.exec(r); if(m) root = m[1] }
  const files = {}, load = async p => { p = String(p || root).replace(/^\//, ''); if(!(p in files)) files[p] = z.has(p) ? modelFile(td.decode(await z.read(p))) : null; return files[p] };
  const parts = []; let count = 0;
  async function emit(path, id, M, depth){ if(depth > 8) return; const f = await load(path); const o = f && f.objs[id]; if(!o) return;
    if(o.mesh){ parts.push({mesh:o.mesh, M}); count += o.mesh.t.length / 3 }
    for(const c of o.comps) await emit(c.path || path, c.obj, mul(c.M, M), depth + 1) }
  const main = await load(root);
  if(main){ if(main.items.length) for(const it of main.items) await emit(it.path || root, it.obj, it.M, 0);
    else for(const id of Object.keys(main.objs)) if(main.objs[id].mesh) await emit(root, id, I3, 0) }
  if(!count){ /* no build: every mesh in every .model file */
    for(const n of z.names.filter(n => /\.model$/i.test(n))){ const f = await load(n); for(const o of Object.values(f.objs)) if(o.mesh){ parts.push({mesh:o.mesh, M:I3}); count += o.mesh.t.length / 3 } } }
  if(!count) throw new Error('This 3MF file has no model inside (a sliced print file?)');
  const pos = new Float32Array(count * 9); let w = 0;
  for(const {mesh:{v, t}, M} of parts) for(let i = 0; i < t.length; i++){ const k = t[i] * 3, x = v[k], y = v[k + 1], zz = v[k + 2];
    pos[w++] = x * M[0] + y * M[3] + zz * M[6] + M[9]; pos[w++] = x * M[1] + y * M[4] + zz * M[7] + M[10]; pos[w++] = x * M[2] + y * M[5] + zz * M[8] + M[11] }
  return {pos, fmt:'3MF'} }

/* pictures and print facts inside a 3MF (Bambu Studio, OrcaSlicer, PrusaSlicer) */
async function zipInfo(blob){
  const z = await unzip(blob), td = new TextDecoder(), out = {thumb:null, slice:null, project:null};
  const pics = ['Metadata/plate_1.png', 'Metadata/thumbnail.png', 'Metadata/top_1.png', 'Metadata/plate_1_small.png', 'Thumbnails/thumbnail.png'];
  const pic = pics.find(n => z.has(n)) || z.names.find(n => /^metadata\/.*\.png$/i.test(n) && !/pick_|_small/i.test(n));
  if(pic) try{ out.thumb = await z.blob(pic, 'image/png') }catch(e){}
  if(z.has('Metadata/slice_info.config')) try{ const x = td.decode(await z.read('Metadata/slice_info.config'));
    let time = 0, grams = 0, plates = 0; const fil = [];
    x.replace(/<plate>([\s\S]*?)<\/plate>/g, (m, b) => { plates++;
      const p = /key="prediction"\s+value="([\d.]+)"/.exec(b), g = /key="weight"\s+value="([\d.]+)"/.exec(b); time += p ? +p[1] : 0; grams += g ? +g[1] : 0;
      b.replace(/<filament\b([^>]*)\/?>/g, (mm, a) => { const q = attrs(a); fil.push({type:q.type || '', color:q.color || '', g:+q.used_g || 0, m:+q.used_m || 0}); return '' }); return '' });
    if(time || grams || fil.length) out.slice = {time:Math.round(time), grams:Math.round(grams * 10) / 10, fil, plates} }catch(e){}
  if(z.has('Metadata/project_settings.config')) try{ const j = JSON.parse(td.decode(await z.read('Metadata/project_settings.config')));
    const first = v => Array.isArray(v) ? v[0] : v;
    out.project = {printer:first(j.printer_model) || first(j.printer_settings_id) || '', filament:first(j.filament_type) || '', layer:first(j.layer_height) || '', nozzle:first(j.nozzle_diameter) || ''} }catch(e){}
  return out }

/* ---------------- one entry point ---------------- */
async function parse(src, name){
  const ext = (String(name || '').match(/\.([a-z0-9]+)$/i) || [0, ''])[1].toLowerCase();
  let r;
  if(ext === '3mf') r = await parse3MF(src instanceof Blob ? src : new Blob([src]));
  else { const u8 = src instanceof Blob ? new Uint8Array(await src.arrayBuffer()) : src instanceof Uint8Array ? src : new Uint8Array(src);
    r = ext === 'obj' ? parseOBJ(u8) : parseSTL(u8) }
  const p = r.pos, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for(let i = 0; i < p.length; i += 3) for(let k = 0; k < 3; k++){ const x = p[i + k]; if(x < min[k]) min[k] = x; if(x > max[k]) max[k] = x }
  if(!isFinite(min[0])) throw new Error('This model is empty');
  return {pos:p, tris:p.length / 9, min, max, dims:[max[0] - min[0], max[1] - min[1], max[2] - min[2]], fmt:r.fmt} }

/* ---------------- drawing (WebGL 1) ---------------- */
const VS = `attribute vec3 p;attribute vec3 n;uniform mat4 mvp;uniform mat4 mv;varying vec3 vn;varying vec3 vp;
void main(){vn=(mv*vec4(n,0.0)).xyz;vp=(mv*vec4(p,1.0)).xyz;gl_Position=mvp*vec4(p,1.0);}`;
const FS = `precision mediump float;varying vec3 vn;varying vec3 vp;uniform vec3 col;
void main(){vec3 N=normalize(vn);if(!gl_FrontFacing)N=-N;vec3 V=normalize(-vp);
vec3 L1=normalize(vec3(0.5,0.8,0.6));vec3 L2=normalize(vec3(-0.7,-0.2,0.4));
float d=max(dot(N,L1),0.0)*0.72+max(dot(N,L2),0.0)*0.28+0.22;float s=pow(max(dot(N,normalize(L1+V)),0.0),36.0)*0.25;
float rim=pow(1.0-max(dot(N,V),0.0),3.0)*0.18;gl_FragColor=vec4(col*d+vec3(s+rim),1.0);}`;
const VSL = `attribute vec3 p;uniform mat4 mvp;void main(){gl_Position=mvp*vec4(p,1.0);}`;
const FSL = `precision mediump float;uniform vec4 col;void main(){gl_FragColor=col;}`;
const M4 = {
  persp(f, a, n, fa){ const t = 1 / Math.tan(f / 2), r = 1 / (n - fa); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (n + fa) * r, -1, 0, 0, 2 * n * fa * r, 0] },
  look(e, c, u){ let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; const zl = Math.hypot(...z); z = z.map(x => x / zl);
    let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; const xl = Math.hypot(...x) || 1; x = x.map(v => v / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1] },
  mul(a, b){ const o = new Array(16); for(let i = 0; i < 4; i++) for(let j = 0; j < 4; j++){ let s = 0; for(let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s } return o } };
const hex = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = parseInt(m ? m[1] : '9fb8c8', 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] };

class Viewer {
  constructor(canvas, opts){ this.c = canvas; this.o = Object.assign({grid:true, interact:true, color:'#9fb8c8'}, opts || {});
    const ctx = {antialias:true, alpha:true, premultipliedAlpha:false, preserveDrawingBuffer:!!this.o.preserve};
    const gl = this.gl = canvas.getContext('webgl', ctx) || canvas.getContext('experimental-webgl', ctx);
    if(!gl) throw new Error('This device cannot show 3D (no WebGL)');
    this.ui = gl.getExtension('OES_element_index_uint');
    const prog = (vs, fs) => { const p = gl.createProgram(); for(const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]){ const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
        if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); gl.attachShader(p, sh) } gl.linkProgram(p); return p };
    this.pm = prog(VS, FS); this.pl = prog(VSL, FSL);
    this.col = hex(this.o.color); this.yaw = -0.6; this.pitch = 0.45; this.dist = 1; this.target = [0, 0, 0]; this.spin = false; this.n = 0;
    if(this.o.interact) this.hook();
    this._ro = 'ResizeObserver' in window ? new ResizeObserver(() => this.draw()) : null; if(this._ro) this._ro.observe(canvas) }
  setMesh(mesh){ const gl = this.gl, src = mesh.pos, all = src.length / 9, lim = this.o.limit || MAX_VIEW, step = all > lim ? Math.ceil(all / lim) : 1, n = Math.floor(all / step);
    const c = [(mesh.min[0] + mesh.max[0]) / 2, (mesh.min[1] + mesh.max[1]) / 2, mesh.min[2]];
    const pos = new Float32Array(n * 9), nor = new Int8Array(n * 9);
    for(let t = 0; t < n; t++){ const s = t * step * 9, d = t * 9;
      for(let k = 0; k < 9; k += 3){ pos[d + k] = src[s + k] - c[0]; pos[d + k + 1] = src[s + k + 1] - c[1]; pos[d + k + 2] = src[s + k + 2] - c[2] }
      const ax = pos[d + 3] - pos[d], ay = pos[d + 4] - pos[d + 1], az = pos[d + 5] - pos[d + 2], bx = pos[d + 6] - pos[d], by = pos[d + 7] - pos[d + 1], bz = pos[d + 8] - pos[d + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx = nx / l * 127; ny = ny / l * 127; nz = nz / l * 127;
      for(let k = 0; k < 9; k += 3){ nor[d + k] = nx; nor[d + k + 1] = ny; nor[d + k + 2] = nz } }
    this.free(); this.bp = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bp); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    this.bn = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bn); gl.bufferData(gl.ARRAY_BUFFER, nor, gl.STATIC_DRAW);
    this.n = n * 3; this.shown = n; this.dims = mesh.dims.slice();
    /* the floor: a grid of 10 mm squares under the model */
    const span = Math.max(mesh.dims[0], mesh.dims[1], 20) * 0.75, g = Math.ceil(span / 10) * 10, ln = [];
    for(let x = -g; x <= g + 0.01; x += 10){ ln.push(x, -g, 0, x, g, 0, -g, x, 0, g, x, 0) }
    this.bg = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bg); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ln), gl.STATIC_DRAW); this.gn = ln.length / 3;
    this.r = Math.max(1, Math.hypot(...mesh.dims) / 2); this.reset(); return this }
  reset(){ if(!this.dims) return; this.yaw = -0.6; this.pitch = 0.45; this.dist = this.r * 3.7; this.target = [0, 0, this.dims[2] / 2]; this.draw() }
  setColor(h){ this.col = hex(h); this.draw() }
  autoRotate(on){ this.spin = !!on; if(on) this.tick(); return this.spin }
  tick(){ if(!this.spin || this.dead) return; this.yaw += 0.008; this.draw(); requestAnimationFrame(() => this.tick()) }
  draw(){ if(this.dead || !this.n) return; if(this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; this.render() }) }
  render(){ const gl = this.gl, c = this.c, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round((c.clientWidth || c.width) * (this.o.preserve ? 1 : dpr))), h = Math.max(1, Math.round((c.clientHeight || c.height) * (this.o.preserve ? 1 : dpr)));
    if(!this.o.preserve && (c.width !== w || c.height !== h)){ c.width = w; c.height = h }
    gl.viewport(0, 0, c.width, c.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
    const cp = Math.cos(this.pitch), t = this.target, e = [t[0] + this.dist * cp * Math.cos(this.yaw), t[1] + this.dist * cp * Math.sin(this.yaw), t[2] + this.dist * Math.sin(this.pitch)];
    const mv = M4.look(e, t, [0, 0, 1]), pr = M4.persp(0.62, c.width / c.height, this.dist / 50, this.dist + this.r * 8), mvp = M4.mul(pr, mv);
    if(this.o.grid && this.gn){ gl.useProgram(this.pl); gl.bindBuffer(gl.ARRAY_BUFFER, this.bg); const a = gl.getAttribLocation(this.pl, 'p'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.pl, 'mvp'), false, mvp); gl.uniform4fv(gl.getUniformLocation(this.pl, 'col'), [0.5, 0.62, 0.72, 0.38]);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.LINES, 0, this.gn); gl.disable(gl.BLEND); gl.disableVertexAttribArray(a) }
    gl.useProgram(this.pm);
    const ap = gl.getAttribLocation(this.pm, 'p'), an = gl.getAttribLocation(this.pm, 'n');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bp); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bn); gl.enableVertexAttribArray(an); gl.vertexAttribPointer(an, 3, gl.BYTE, true, 0, 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.pm, 'mvp'), false, mvp); gl.uniformMatrix4fv(gl.getUniformLocation(this.pm, 'mv'), false, mv); gl.uniform3fv(gl.getUniformLocation(this.pm, 'col'), this.col);
    gl.drawArrays(gl.TRIANGLES, 0, this.n); gl.disableVertexAttribArray(ap); gl.disableVertexAttribArray(an) }
  /* rotate with one finger / the mouse, zoom with two fingers or the wheel, move with two fingers or the right mouse button */
  hook(){ const c = this.c, P = new Map(); let last = null, tapAt = 0;
    const two = () => { const [a, b] = [...P.values()]; return {d:Math.hypot(a.x - b.x, a.y - b.y), x:(a.x + b.x) / 2, y:(a.y + b.y) / 2} };
    const pan = (dx, dy) => { const s = this.dist / (c.clientHeight || 300) * 1.1, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
      /* right = (-sin yaw, cos yaw, 0); up on screen = (-cos yaw·sin pitch, -sin yaw·sin pitch, cos pitch) */
      this.target[0] += (dx * sy - dy * cy * sp) * s; this.target[1] += (-dx * cy - dy * sy * sp) * s; this.target[2] += dy * cp * s; this.draw() };
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); P.set(e.pointerId, {x:e.clientX, y:e.clientY, b:e.button}); this.spin = false; last = P.size === 2 ? two() : null;
      if(P.size === 1){ const now = Date.now(); if(now - tapAt < 300) this.reset(); tapAt = now } });
    c.addEventListener('pointermove', e => { const p = P.get(e.pointerId); if(!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if(P.size >= 2){ const t = two(); if(last){ this.dist = Math.min(this.r * 40, Math.max(this.r * 0.3, this.dist * last.d / Math.max(10, t.d))); pan(t.x - last.x, t.y - last.y) } last = t; return }
      if(p.b === 2 || e.shiftKey) return pan(dx, dy);
      this.yaw -= dx * 0.01; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.01)); this.draw() });
    const up = e => { P.delete(e.pointerId); last = P.size === 2 ? two() : null };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => { e.preventDefault(); this.dist = Math.min(this.r * 40, Math.max(this.r * 0.3, this.dist * Math.exp(e.deltaY * 0.0015))); this.draw() }, {passive:false}) }
  free(){ const gl = this.gl; for(const b of ['bp', 'bn', 'bg']) if(this[b]){ gl.deleteBuffer(this[b]); this[b] = null } this.n = 0 }
  destroy(){ this.dead = true; this.spin = false; try{ this._ro && this._ro.disconnect() }catch(e){} this.free(); const x = this.gl.getExtension('WEBGL_lose_context'); if(x && !this.o.keep) x.loseContext() } }

/* a picture for the tile: one hidden canvas, reused */
let SNAP = null;
async function snapshot(mesh, size, color){ size = size || 400;
  if(!SNAP){ const c = document.createElement('canvas'); c.width = c.height = size; SNAP = new Viewer(c, {preserve:true, interact:false, grid:false, keep:true, limit:MAX_SNAP}) }
  const v = SNAP; if(v.c.width !== size){ v.c.width = v.c.height = size }
  v.setMesh(mesh); v.setColor(color || '#a9c2d2'); v.dist = v.r * 3.45; v.target = [0, 0, mesh.dims[2] / 2]; v.yaw = -0.75; v.pitch = 0.5; v.render();
  const b = await new Promise(ok => v.c.toBlob(ok, 'image/webp', 0.86)); v.free(); return b }

window.NVMESH = {parse, unzip, zipInfo, snapshot, Viewer};
})();
