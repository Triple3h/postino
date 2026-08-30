import { describe, expect, it } from 'vitest'
import { createCryptoJsShim } from '@/scripting/crypto-shim'

const CryptoJS = createCryptoJsShim()

// 回归防线:pm-facade.ts 曾因 K 表缺 8 个常量导致沙箱内 SHA-256 结果全错且无测试覆盖
describe('CryptoJS shim(签名脚本兼容)', () => {
  it('SHA256 默认输出小写 hex', () => {
    expect(CryptoJS.SHA256('abc').toString()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('toString(CryptoJS.enc.Hex) 与默认一致(签名脚本惯用法)', () => {
    expect(CryptoJS.SHA256('abc').toString(CryptoJS.enc.Hex)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('toString(CryptoJS.enc.Base64) 输出标准 base64', () => {
    expect(CryptoJS.SHA256('abc').toString(CryptoJS.enc.Base64)).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=')
  })

  it('enc.Utf8.parse 字节数组可作输入', () => {
    expect(CryptoJS.SHA256(CryptoJS.enc.Utf8.parse('abc')).toString()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('HmacSHA256 标准向量', () => {
    expect(CryptoJS.HmacSHA256('The quick brown fox jumps over the lazy dog', 'key').toString())
      .toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8')
  })

  it('HmacSHA256 超 64 字节 key 先哈希(RFC 4231 case 6)', () => {
    const key = CryptoJS.enc.Hex.parse('aa'.repeat(131))
    expect(CryptoJS.HmacSHA256('Test Using Larger Than Block-Size Key - Hash Key First', key).toString())
      .toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54')
  })
})
