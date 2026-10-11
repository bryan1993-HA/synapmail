/**
 * A real 1x1 PNG, built in memory rather than read from disk: the bytes a bench uploads
 * are the bytes it compares against, so "the route serves exactly what was stored" (or
 * "the preview holds a pixel") is measured and not assumed.
 */
import { deflateSync } from 'node:zlib'

export function onePixelPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = buf => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit, truecolour
  // One scanline: filter byte 0, then an opaque violet pixel.
  const idat = deflateSync(Buffer.from([0, 0x7c, 0x3a, 0xed]))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ])
}

/** The same pixel wrapped as an ICO (one 1x1 entry whose payload is the PNG, as browsers accept). */
export function onePixelIco() {
  const png = onePixelPng()
  const header = Buffer.from([0, 0, 1, 0, 1, 0]) // reserved, type 1 = icon, 1 image
  const entry = Buffer.alloc(16)
  entry[0] = 1; entry[1] = 1 // 1x1
  entry.writeUInt16LE(1, 4) // colour planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(header.length + entry.length, 12)
  return Buffer.concat([header, entry, png])
}
