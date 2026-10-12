// Replaces the 'wasm-feature-detect' package for the browser (no bundler here).
// SIMD: a tiny module that only validates when the browser has WebAssembly SIMD (then the faster WebP encoder is used).
export const simd = async () => { try{ return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])) }catch(e){ return false } };
// Threads need a cross-origin isolated page, which GitHub Pages cannot give: always the single-thread AVIF encoder.
export const threads = async () => false;
