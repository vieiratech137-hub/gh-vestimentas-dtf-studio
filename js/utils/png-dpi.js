const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function readUint32(bytes, offset) {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 255;
  bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255;
  bytes[offset + 3] = value & 255;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let c = index;
    for (let bit = 0; bit < 8; bit += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[index] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPhysChunk(dpi) {
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const type = new Uint8Array([112, 72, 89, 115]);
  const data = new Uint8Array(9);
  writeUint32(data, 0, pixelsPerMeter);
  writeUint32(data, 4, pixelsPerMeter);
  data[8] = 1;

  const crcSource = new Uint8Array(type.length + data.length);
  crcSource.set(type, 0);
  crcSource.set(data, type.length);

  const chunk = new Uint8Array(4 + type.length + data.length + 4);
  writeUint32(chunk, 0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  writeUint32(chunk, chunk.length - 4, crc32(crcSource));

  return chunk;
}

export async function embedPngDpi(blob, dpi) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const signature = bytes.slice(0, 8);

  if (!signature.every((value, index) => value === PNG_SIGNATURE[index])) {
    return blob;
  }

  const parts = [bytes.slice(0, 8)];
  const physChunk = createPhysChunk(dpi);
  let offset = 8;
  let inserted = false;

  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const typeBytes = bytes.slice(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const chunkEnd = offset + 12 + length;

    if (type !== "pHYs") {
      parts.push(bytes.slice(offset, chunkEnd));
    }

    if (type === "IHDR" && !inserted) {
      parts.push(physChunk);
      inserted = true;
    }

    offset = chunkEnd;
  }

  return new Blob(parts, { type: "image/png" });
}
