// Converts one picture at a time: decode (the browser does that), resize, encode to WebP and/or AVIF (Squoosh codecs in WebAssembly).
import encodeWebp from './lib/webp/encode.js';
import encodeAvif from './lib/avif/encode.js';

function fit(w, h, max){ if(!max || (w <= max && h <= max)) return [w, h]; const k = max / Math.max(w, h); return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))] }

function pixels(bmp, w, h){
  // big reductions in steps of at most 2x: sharper than one big jump
  let src = bmp, sw = bmp.width, sh = bmp.height;
  while(sw / 2 > w && sh / 2 > h){ const c = new OffscreenCanvas(Math.round(sw / 2), Math.round(sh / 2)), x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height); src = c; sw = c.width; sh = c.height }
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d', {willReadFrequently:true}); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h);
  return x.getImageData(0, 0, w, h) }

self.onmessage = async e => {
  const {id, file, o} = e.data;
  try{
    const bmp = await createImageBitmap(file), out = [], src = [bmp.width, bmp.height];
    const sizes = [{tag:'', max:o.max}].concat(o.thumb ? [{tag:'thumb', max:o.thumb}] : []);
    for(const s of sizes){
      const [w, h] = fit(bmp.width, bmp.height, s.max), img = pixels(bmp, w, h);
      if(o.webp) out.push({fmt:'webp', tag:s.tag, w, h, buf:await encodeWebp(img, {quality:o.qWebp, method:o.effort === 'small' ? 6 : o.effort === 'fast' ? 2 : 4})});
      if(o.avif) out.push({fmt:'avif', tag:s.tag, w, h, buf:await encodeAvif(img, {quality:o.qAvif, speed:o.effort === 'small' ? 4 : o.effort === 'fast' ? 9 : 7})});
    }
    bmp.close && bmp.close();
    self.postMessage({id, ok:true, src, out}, out.map(x => x.buf));
  }catch(err){ self.postMessage({id, ok:false, error:String(err && err.message || err)}) }
};
