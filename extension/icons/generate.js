const fs = require('fs');
const zlib = require('zlib');

function createPNG(size) {
  const rawData = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    rawData[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const cx = x / size, cy = y / size;

      let alpha = 0;
      const margin = 0.06;
      const radius = 0.19;
      const inBounds = cx > margin && cx < 1 - margin && cy > margin && cy < 1 - margin;
      if (inBounds) {
        const dx = Math.max(0, Math.abs(cx - 0.5) - (0.5 - margin - radius));
        const dy = Math.max(0, Math.abs(cy - 0.5) - (0.5 - margin - radius));
        if (dx * dx + dy * dy <= radius * radius) {
          alpha = 255;
        }
      }

      const isBolt = checkBolt(cx, cy);
      if (isBolt) {
        rawData[px] = 0;
        rawData[px + 1] = 229;
        rawData[px + 2] = 160;
        rawData[px + 3] = 255;
      } else {
        rawData[px] = 10;
        rawData[px + 1] = 14;
        rawData[px + 2] = 20;
        rawData[px + 3] = alpha;
      }
    }
  }

  const deflated = zlib.deflateSync(rawData);
  const chunks = [];
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(makeChunk('IHDR', ihdr));
  chunks.push(makeChunk('IDAT', deflated));
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function checkBolt(cx, cy) {
  const points = [
    [0.56, 0.12], [0.31, 0.53], [0.45, 0.53],
    [0.41, 0.88], [0.69, 0.44], [0.53, 0.44]
  ];
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0], yi = points[i][1];
    const xj = points[j][0], yj = points[j][1];
    if (((yi > cy) !== (yj > cy)) && (cx < (xj - xi) * (cy - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type);
  const crcData = Buffer.concat([typeB, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, typeB, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

[16, 48, 128].forEach(size => {
  const png = createPNG(size);
  fs.writeFileSync('icon' + size + '.png', png);
  console.log('Created icon' + size + '.png (' + png.length + ' bytes)');
});
