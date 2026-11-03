/**
 * Lite 向量：零依赖、离线可用的中文语义近似向量。
 * 字 unigram / bigram / trigram + 英文词，FNV 哈希到 DIM 维，带符号哈希抵消碰撞偏差，L2 归一化。
 * 对中文短文本的主题相似度（同人物、同地点、同事件）足够好；需要更强语义时切换 EMBED_MODE=api。
 */
export const LITE_DIM = 512;

const STOP = new Set("的了是在我你他她它们和与也就都还很又着过吧呢吗啊呀哦嗯一个这那有没不".split(""));

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  for (const w of lower.match(/[a-z0-9]+/g) ?? []) tokens.push(w);
  for (const seg of lower.match(/[一-鿿]+/g) ?? []) {
    const cs = Array.from(seg);
    for (let i = 0; i < cs.length; i++) {
      if (!STOP.has(cs[i])) tokens.push(cs[i]);
      if (i + 1 < cs.length) tokens.push(cs[i] + cs[i + 1]);
      if (i + 2 < cs.length) tokens.push(cs[i] + cs[i + 1] + cs[i + 2]);
    }
  }
  return tokens;
}

export function embedLite(text: string): Float32Array {
  const v = new Float32Array(LITE_DIM);
  for (const t of tokenize(text)) {
    const h = fnv(t);
    const weight = t.length >= 2 ? 1.6 : 1; // 词组比单字信息量大
    v[h % LITE_DIM] += (h & 0x80000000 ? -1 : 1) * weight;
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function toBytes(v: Float32Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(v.byteLength);
  out.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  return out;
}

export function fromBytes(b: Uint8Array | null | undefined): Float32Array | null {
  if (!b || b.byteLength === 0 || b.byteLength % 4 !== 0) return null;
  const copy = new Uint8Array(b);
  return new Float32Array(copy.buffer);
}
