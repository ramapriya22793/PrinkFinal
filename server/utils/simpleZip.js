const zlib = require('zlib');

function calculateCRC32(buf) {
  if (typeof zlib.crc32 === 'function') {
    return zlib.crc32(buf);
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Lightweight, zero-dependency ZIP file generator.
 */
class SimpleZip {
  constructor() {
    this.files = [];
  }

  /**
   * Add a file to the ZIP archive.
   * @param {string} name - File path/name inside zip (e.g. "184347_PG-PM-01_01.jpg")
   * @param {Buffer} contentBuffer - File content buffer
   */
  addFile(name, contentBuffer) {
    const filenameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const uncompressedSize = contentBuffer.length;
    const crc = calculateCRC32(contentBuffer);
    
    // Raw deflate compression
    const compressedData = zlib.deflateRawSync(contentBuffer);
    const compressedSize = compressedData.length;

    const date = new Date();
    const dosTime = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() >> 1) & 0x1F);
    const dosDate = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F);

    this.files.push({
      nameBuf: filenameBuf,
      compressedData,
      uncompressedSize,
      compressedSize,
      crc,
      dosTime,
      dosDate
    });
  }

  /**
   * Build complete ZIP archive buffer.
   * @returns {Buffer} ZIP archive buffer
   */
  toBuffer() {
    const parts = [];
    const cdEntries = [];
    let offset = 0;

    for (const file of this.files) {
      // Local Header
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0, 6);
      header.writeUInt16LE(8, 8); // Deflate
      header.writeUInt16LE(file.dosTime, 10);
      header.writeUInt16LE(file.dosDate, 12);
      header.writeUInt32LE(file.crc, 14);
      header.writeUInt32LE(file.compressedSize, 18);
      header.writeUInt32LE(file.uncompressedSize, 22);
      header.writeUInt16LE(file.nameBuf.length, 26);
      header.writeUInt16LE(0, 28);

      const fileOffset = offset;
      parts.push(header, file.nameBuf, file.compressedData);
      offset += header.length + file.nameBuf.length + file.compressedData.length;

      // Central Dir Header
      const cdHeader = Buffer.alloc(46);
      cdHeader.writeUInt32LE(0x02014b50, 0);
      cdHeader.writeUInt16LE(20, 4);
      cdHeader.writeUInt16LE(20, 6);
      cdHeader.writeUInt16LE(0, 8);
      cdHeader.writeUInt16LE(8, 10);
      cdHeader.writeUInt16LE(file.dosTime, 12);
      cdHeader.writeUInt16LE(file.dosDate, 14);
      cdHeader.writeUInt32LE(file.crc, 16);
      cdHeader.writeUInt32LE(file.compressedSize, 20);
      cdHeader.writeUInt32LE(file.uncompressedSize, 24);
      cdHeader.writeUInt16LE(file.nameBuf.length, 28);
      cdHeader.writeUInt16LE(0, 30);
      cdHeader.writeUInt16LE(0, 32);
      cdHeader.writeUInt16LE(0, 34);
      cdHeader.writeUInt16LE(0, 36);
      cdHeader.writeUInt32LE(0, 38);
      cdHeader.writeUInt32LE(fileOffset, 42);

      cdEntries.push(cdHeader, file.nameBuf);
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const buf of cdEntries) {
      parts.push(buf);
      cdSize += buf.length;
    }

    // End of Central Dir Record
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.files.length, 8);
    eocd.writeUInt16LE(this.files.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);

    parts.push(eocd);
    return Buffer.concat(parts);
  }
}

module.exports = SimpleZip;
