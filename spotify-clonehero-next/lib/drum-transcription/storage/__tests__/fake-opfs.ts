/**
 * Minimal in-memory fake of the File System Access API surface that
 * opfs.ts/stem-cache.ts use (`navigator.storage.getDirectory`,
 * `FileSystemDirectoryHandle`, `FileSystemFileHandle`). jsdom doesn't
 * implement OPFS, and there's no real browser to fall back to in Jest, so
 * this stands in for it — a flat `Map<path, ArrayBuffer>` keyed by the full
 * path from the OPFS root, with directory handles that are just path
 * prefixes (directories always "exist" implicitly; only files are tracked).
 */

function toArrayBuffer(
  data: string | ArrayBuffer | Uint8Array<ArrayBufferLike>,
): ArrayBuffer {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data).buffer as ArrayBuffer;
  }
  if (data instanceof Uint8Array) {
    return data.slice().buffer as ArrayBuffer;
  }
  return data.slice(0);
}

class FakeFile {
  constructor(private readonly buf: ArrayBuffer) {}
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.buf.slice(0);
  }
  async text(): Promise<string> {
    return new TextDecoder().decode(this.buf);
  }
}

class FakeWritable {
  private pending: ArrayBuffer | null = null;
  constructor(
    private readonly path: string,
    private readonly store: Map<string, ArrayBuffer>,
  ) {}
  async write(
    data: string | ArrayBuffer | Uint8Array<ArrayBufferLike>,
  ): Promise<void> {
    this.pending = toArrayBuffer(data);
  }
  async close(): Promise<void> {
    this.store.set(this.path, this.pending ?? new ArrayBuffer(0));
  }
}

class FakeFileHandle {
  readonly kind = 'file' as const;
  constructor(
    private readonly path: string,
    private readonly store: Map<string, ArrayBuffer>,
  ) {}
  async getFile(): Promise<FakeFile> {
    const data = this.store.get(this.path);
    if (data === undefined) {
      throw new DOMException(`Not found: ${this.path}`, 'NotFoundError');
    }
    return new FakeFile(data);
  }
  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this.path, this.store);
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory' as const;
  constructor(
    private readonly prefix: string,
    private readonly store: Map<string, ArrayBuffer>,
  ) {}
  async getFileHandle(
    name: string,
    options?: {create?: boolean},
  ): Promise<FakeFileHandle> {
    const path = `${this.prefix}/${name}`;
    if (!this.store.has(path)) {
      if (!options?.create) {
        throw new DOMException(`Not found: ${path}`, 'NotFoundError');
      }
      this.store.set(path, new ArrayBuffer(0));
    }
    return new FakeFileHandle(path, this.store);
  }
  async getDirectoryHandle(
    name: string,
    _options?: {create?: boolean},
  ): Promise<FakeDirectoryHandle> {
    return new FakeDirectoryHandle(`${this.prefix}/${name}`, this.store);
  }
  async removeEntry(
    name: string,
    options?: {recursive?: boolean},
  ): Promise<void> {
    const path = `${this.prefix}/${name}`;
    if (options?.recursive) {
      for (const key of [...this.store.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) this.store.delete(key);
      }
    } else {
      this.store.delete(path);
    }
  }
  /**
   * Async-iterates immediate children (files and subdirectories), mirroring
   * `FileSystemDirectoryHandle.entries()`. Subdirectories are inferred from
   * stored file paths since the fake only tracks files, not empty dirs.
   */
  async *entries(): AsyncGenerator<
    [string, FakeFileHandle | FakeDirectoryHandle]
  > {
    const prefix = `${this.prefix}/`;
    const seen = new Set<string>();
    for (const key of this.store.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      const segment = slash === -1 ? rest : rest.slice(0, slash);
      if (seen.has(segment)) continue;
      seen.add(segment);
      if (slash === -1) {
        yield [segment, new FakeFileHandle(key, this.store)];
      } else {
        yield [
          segment,
          new FakeDirectoryHandle(`${this.prefix}/${segment}`, this.store),
        ];
      }
    }
  }
}

/**
 * Installs a fake `navigator.storage.getDirectory()` backed by an in-memory
 * store. Returns a handle to reset/inspect the store between tests.
 */
export function installFakeOPFS(): {
  store: Map<string, ArrayBuffer>;
  reset: () => void;
} {
  const store = new Map<string, ArrayBuffer>();
  const root = new FakeDirectoryHandle('', store);

  Object.defineProperty(globalThis.navigator, 'storage', {
    value: {getDirectory: async () => root},
    configurable: true,
  });

  return {store, reset: () => store.clear()};
}
