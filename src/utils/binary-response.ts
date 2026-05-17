import type { ResponseData } from '@/types'

export function isBinaryContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase()
  return ct.includes('application/octet-stream') ||
    ct.includes('application/pdf') ||
    ct.includes('image/') ||
    ct.includes('audio/') ||
    ct.includes('video/') ||
    ct.includes('font/') ||
    ct.includes('application/zip') ||
    ct.includes('application/gzip') ||
    ct.includes('application/x-')
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)))
  }
  return btoa(chunks.join(''))
}

export function base64ToBlob(base64: string, contentType = 'application/octet-stream'): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: contentType })
}

export function responseContentType(response: ResponseData): string {
  return response.headers['content-type'] || response.headers['Content-Type'] || response.contentType || 'text/plain'
}

export function responseBodyToBlob(response: ResponseData): Blob {
  const contentType = responseContentType(response)
  if (response.bodyEncoding === 'base64') return base64ToBlob(response.body, contentType)
  return new Blob([response.body], { type: contentType })
}

export function responseDataUrl(response: ResponseData): string {
  const contentType = responseContentType(response)
  if (response.bodyEncoding === 'base64') return `data:${contentType};base64,${response.body}`
  return `data:${contentType};base64,${btoa(unescape(encodeURIComponent(response.body)))}`
}

export function responseFileExtension(contentType: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('html')) return 'html'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('pdf')) return 'pdf'
  if (ct.includes('svg')) return 'svg'
  if (ct.includes('png')) return 'png'
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('zip')) return 'zip'
  return 'txt'
}
