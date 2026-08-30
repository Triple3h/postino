/**
 * 脚本沙箱共用的 CryptoJS shim(单一真源)。
 * 消费方:src/scripting/pm-facade.ts(worker/iframe 沙箱)与 src/utils/pre-request.ts(页面直执行兜底)。
 * 覆盖签名脚本最常用的 API:SHA256 / HmacSHA256 / CryptoJS.enc.{Hex,Base64,Utf8,Latin1}。
 * hash 结果 toString(无参或 CryptoJS.enc.Hex)= 小写 hex;其余编码器按原始字节转换。
 * 注意:此文件在 worker / 沙箱 iframe / 页面 / Node 测试四个环境运行,只能依赖全局
 * btoa/atob/TextDecoder(模块闭包拿到的都是宿主真身,不受沙箱参数遮蔽影响)。
 */

export function createCryptoJsShim(): any {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const stringToBytes = (str: string): number[] => {
    const bytes: number[] = []
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      if (code < 0x80) bytes.push(code)
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
      else if (code < 0xd800 || code >= 0xe000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
      else {
        i++
        const cp = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff))
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
      }
    }
    return bytes
  }
  const sha256 = (bytes: number[]): string => {
    const padded = bytes.slice()
    padded.push(0x80)
    while (padded.length % 64 !== 56) padded.push(0)
    const bitLen = bytes.length * 8
    for (let i = 56; i >= 0; i -= 8) padded.push(Math.floor(bitLen / Math.pow(2, i)) & 0xff)
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
    for (let offset = 0; offset < padded.length; offset += 64) {
      const w = new Array<number>(64)
      for (let j = 0; j < 16; j++) w[j] = (padded[offset + j * 4] << 24) | (padded[offset + j * 4 + 1] << 16) | (padded[offset + j * 4 + 2] << 8) | padded[offset + j * 4 + 3]
      for (let j = 16; j < 64; j++) {
        const s0 = ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^ ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^ (w[j - 15] >>> 3)
        const s1 = ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^ ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^ (w[j - 2] >>> 10)
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
      for (let j = 0; j < 64; j++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
        const ch = (e & f) ^ (~e & g)
        const temp1 = (h + S1 + ch + K[j] + w[j]) | 0
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
        const maj = (a & b) ^ (a & c) ^ (b & c)
        const temp2 = (S0 + maj) | 0
        h = g; g = f; f = e; e = (d + temp1) | 0
        d = c; c = b; b = a; a = (temp1 + temp2) | 0
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(item => ('00000000' + (item >>> 0).toString(16)).slice(-8)).join('')
  }
  const hexToBytes = (hex: string): number[] => {
    const bytes: number[] = []
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))
    return bytes
  }
  const bytesToBase64 = (bytes: number[]): string => btoa(bytes.map(b => String.fromCharCode(b & 0xff)).join(''))
  const bytesToUtf8 = (bytes: number[]): string => new TextDecoder().decode(new Uint8Array(bytes))
  const bytesToLatin1 = (bytes: number[]): string => bytes.map(b => String.fromCharCode(b & 0xff)).join('')
  const toBytes = (input: unknown): number[] => {
    if (typeof input === 'string') return stringToBytes(input)
    if (Array.isArray(input)) return input.map(b => Number(b) & 0xff)
    return stringToBytes(String(input ?? ''))
  }
  const enc = {
    Hex: {
      stringify: (value: unknown) => String(value),
      parse: (value: string) => hexToBytes(String(value)),
    },
    Base64: {
      stringify: (value: unknown) => bytesToBase64(hexToBytes(String(value))),
      parse: (value: string) => Array.from(atob(String(value)), ch => ch.charCodeAt(0) & 0xff),
    },
    Utf8: {
      stringify: (value: unknown) => bytesToUtf8(hexToBytes(String(value))),
      parse: (value: string) => stringToBytes(String(value)),
    },
    Latin1: {
      stringify: (value: unknown) => bytesToLatin1(hexToBytes(String(value))),
      parse: (value: string) => Array.from(String(value), ch => ch.charCodeAt(0) & 0xff),
    },
  }
  const wrapHash = (hashHex: string) => ({
    toString(encoder?: unknown) {
      const stringify = (encoder as { stringify?: (v: string) => string } | undefined)?.stringify
      return typeof stringify === 'function' ? stringify(hashHex) : hashHex
    },
  })
  return {
    enc,
    SHA256(message: unknown) {
      return wrapHash(sha256(toBytes(message)))
    },
    /** HmacSHA256(message, key):key 为字符串(按 UTF-8)或 enc.*.parse 得到的字节数组 */
    HmacSHA256(message: unknown, key: unknown) {
      let keyBytes = toBytes(key)
      if (keyBytes.length > 64) keyBytes = hexToBytes(sha256(keyBytes))
      const block = keyBytes.slice()
      while (block.length < 64) block.push(0)
      const ipad = block.map(b => b ^ 0x36)
      const opad = block.map(b => b ^ 0x5c)
      return wrapHash(sha256(opad.concat(hexToBytes(sha256(ipad.concat(toBytes(message)))))))
    },
  }
}
