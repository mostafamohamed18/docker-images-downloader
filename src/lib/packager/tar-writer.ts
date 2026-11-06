// Streaming USTAR tar writer.
//
// Produces a valid tar stream where each entry is one file. Use addFile()
// with a byte length up front, then feed chunks via write(). Call finalize()
// to append the two 512-byte zero blocks.

const BLOCK = 512;

function pad(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, "0") + " ";
}

function writeString(view: Uint8Array, offset: number, str: string, len: number) {
  for (let i = 0; i < len; i++) {
    view[offset + i] = i < str.length ? str.charCodeAt(i) : 0;
  }
}

function headerBlock(name: string, size: number, mode = 0o644): Uint8Array {
  const header = new Uint8Array(BLOCK);
  // Handle long names via ustar prefix split when possible.
  let fname = name;
  let prefix = "";
  if (fname.length > 100) {
    const slash = fname.lastIndexOf("/", 100);
    if (slash > 0 && fname.length - slash - 1 <= 100 && slash <= 155) {
      prefix = fname.slice(0, slash);
      fname = fname.slice(slash + 1);
    } else {
      throw new Error(`tar name too long: ${name}`);
    }
  }
  writeString(header, 0, fname, 100);
  writeString(header, 100, pad(mode, 8), 8);
  writeString(header, 108, pad(0, 8), 8); // uid
  writeString(header, 116, pad(0, 8), 8); // gid
  writeString(header, 124, pad(size, 12), 12); // size
  writeString(header, 136, pad(Math.floor(Date.now() / 1000), 12), 12); // mtime
  // checksum placeholder = 8 spaces
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  header[156] = 0x30; // typeflag '0' = regular file
  writeString(header, 257, "ustar", 6);
  writeString(header, 263, "00", 2);
  if (prefix) writeString(header, 345, prefix, 155);

  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += header[i];
  writeString(header, 148, pad(sum, 8), 8);
  return header;
}

export interface TarSink {
  write(chunk: Uint8Array): Promise<void> | void;
}

export class TarWriter {
  private pending = 0;
  constructor(private sink: TarSink) {}

  async addFileFromChunks(
    name: string,
    size: number,
    chunks: AsyncIterable<Uint8Array>,
  ): Promise<void> {
    await this.sink.write(headerBlock(name, size));
    let written = 0;
    for await (const c of chunks) {
      written += c.byteLength;
      if (written > size) {
        throw new Error(
          `tar entry ${name} overflow: wrote ${written} of declared ${size}`,
        );
      }
      await this.sink.write(c);
    }
    if (written !== size) {
      throw new Error(
        `tar entry ${name} underflow: wrote ${written} of ${size}`,
      );
    }
    const rem = size % BLOCK;
    if (rem !== 0) {
      await this.sink.write(new Uint8Array(BLOCK - rem));
    }
    this.pending++;
  }

  async addFileBytes(name: string, bytes: Uint8Array): Promise<void> {
    async function* one() {
      yield bytes;
    }
    await this.addFileFromChunks(name, bytes.byteLength, one());
  }

  async finalize(): Promise<void> {
    await this.sink.write(new Uint8Array(BLOCK * 2));
  }
}

// Helper: sink that appends to an array of chunks (Blob fallback path).
export function createArraySink(): { sink: TarSink; chunks: Uint8Array[] } {
  const chunks: Uint8Array[] = [];
  return {
    chunks,
    sink: {
      write(c) {
        chunks.push(c);
      },
    },
  };
}

// Helper: sink that writes to a WritableStreamDefaultWriter.
export function createStreamSink(
  writer: WritableStreamDefaultWriter<Uint8Array>,
): TarSink {
  return { write: (c) => writer.write(c) };
}
