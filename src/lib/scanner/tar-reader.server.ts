// Minimal streaming TAR reader for Cloudflare Workers.
// Yields { name, body } for each regular file entry.
// Supports POSIX ustar + GNU 'L' long-name extension.

export interface TarEntry {
  name: string;
  body: Uint8Array;
}

function readString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const stop = offset + length;
  while (end < stop && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(offset, end));
}

function readOctal(bytes: Uint8Array, offset: number, length: number): number {
  const s = readString(bytes, offset, length).trim();
  return s ? parseInt(s, 8) : 0;
}

export function* readTar(buf: Uint8Array): Generator<TarEntry> {
  let offset = 0;
  let longName: string | null = null;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    // Empty block = end of archive
    let allZero = true;
    for (let i = 0; i < 512; i++) if (header[i] !== 0) { allZero = false; break; }
    if (allZero) break;

    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] || 0x30);
    const prefix = readString(header, 345, 155);

    const blocks = Math.ceil(size / 512);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > buf.length) break;
    const body = buf.subarray(bodyStart, bodyEnd);

    if (typeflag === "L") {
      // GNU long-name: body contains the real name for next entry
      longName = new TextDecoder().decode(body).replace(/\0+$/, "");
    } else if (typeflag === "0" || typeflag === "\0") {
      const fullName = longName ?? (prefix ? `${prefix}/${name}` : name);
      longName = null;
      yield { name: fullName, body };
    } else {
      // Skip directories, symlinks, hardlinks, etc.
      longName = null;
    }
    offset = bodyStart + blocks * 512;
  }
}

// Decompress a gzipped Uint8Array using Web Streams (available in Workers).
export async function gunzip(gzipped: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const stream = new Response(gzipped as BlobPart).body!.pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
