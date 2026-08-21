/**
 * Minimal in-memory fake of the File System Access API surface that
 * opfs.ts/stem-cache.ts use (`navigator.storage.getDirectory`,
 * `FileSystemDirectoryHandle`, `FileSystemFileHandle`). jsdom doesn't
 * implement OPFS, and there's no real browser to fall back to in Jest, so
 * this stands in for it — a flat `Map<path, ArrayBuffer>` keyed by the full
 * path from the OPFS root, with directory handles that are just path
 * prefixes (directories always "exist" implicitly; only files are tracked).
 *
 * Two platform semantics matter to code under test and are reproduced here:
 *
 *   - `createWritable()` writes to a swap buffer and commits it to the file
 *     on `close()`. A writable that is never closed leaves the file's
 *     previous contents untouched, so an interrupted write is never visible
 *     as a truncated payload. Closing without writing commits an empty
 *     buffer (the swap starts empty, `keepExistingData` being false).
 *   - `getFileHandle(name, {create: true})` materializes a zero-length file
 *     when `name` is absent, and leaves an existing file's contents alone.
 *
 * Files also carry a modification time, because the stem cache dates an entry
 * by the time on its marker file. The clock does not move on its own: a test
 * that cares about order calls `setNow` between writes, and one that does not
 * gets equal times, which is a real case the pruner has to order anyway. A
 * file put straight into `store` by a test has no time and reads as 0 — the
 * same answer a real entry written before markers existed gives, and a value
 * no write through the fake can produce.
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
  constructor(
    private readonly buf: ArrayBuffer,
    readonly lastModified: number,
  ) {}
  get size(): number {
    return this.buf.byteLength;
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.buf.slice(0);
  }
  async text(): Promise<string> {
    return new TextDecoder().decode(this.buf);
  }
}

/** Swap buffer: accumulates writes and commits them to the store on close.
 * Nothing it has written is observable until then. */
class FakeWritable {
  private readonly chunks: Uint8Array[] = [];
  constructor(
    private readonly path: string,
    private readonly store: Map<string, ArrayBuffer>,
    private readonly clock: Clock,
  ) {}
  async write(
    data: string | ArrayBuffer | Uint8Array<ArrayBufferLike>,
  ): Promise<void> {
    this.chunks.push(new Uint8Array(toArrayBuffer(data)));
  }
  async close(): Promise<void> {
    const total = this.chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.store.set(this.path, merged.buffer as ArrayBuffer);
    this.clock.stamp(this.path);
  }
}

class FakeFileHandle {
  readonly kind = 'file' as const;
  constructor(
    private readonly path: string,
    private readonly store: Map<string, ArrayBuffer>,
    private readonly clock: Clock,
  ) {}
  async getFile(): Promise<FakeFile> {
    const data = this.store.get(this.path);
    if (data === undefined) {
      throw new DOMException(`Not found: ${this.path}`, 'NotFoundError');
    }
    return new FakeFile(data, this.clock.timeOf(this.path));
  }
  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this.path, this.store, this.clock);
  }
}

/** Paths `removeEntry` refuses, modelling OPFS refusing to remove a
 *  directory that holds a file open in another context. */
const unremovable = new Set<string>();

class FakeDirectoryHandle {
  readonly kind = 'directory' as const;
  constructor(
    private readonly prefix: string,
    private readonly store: Map<string, ArrayBuffer>,
    private readonly clock: Clock,
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
      this.clock.stamp(path);
    }
    return new FakeFileHandle(path, this.store, this.clock);
  }
  async getDirectoryHandle(
    name: string,
    _options?: {create?: boolean},
  ): Promise<FakeDirectoryHandle> {
    return new FakeDirectoryHandle(
      `${this.prefix}/${name}`,
      this.store,
      this.clock,
    );
  }
  async removeEntry(
    name: string,
    options?: {recursive?: boolean},
  ): Promise<void> {
    const path = `${this.prefix}/${name}`;
    if (unremovable.has(path)) {
      throw new DOMException(`In use: ${path}`, 'NoModificationAllowedError');
    }
    // A name that matches nothing is a NotFoundError on the platform, not a
    // silent success. Code that tells "deleted it" from "it was not there"
    // depends on the difference.
    let removed = false;
    if (options?.recursive) {
      for (const key of [...this.store.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) {
          this.store.delete(key);
          this.clock.forget(key);
          removed = true;
        }
      }
    } else {
      removed = this.store.delete(path);
      this.clock.forget(path);
    }
    if (!removed) {
      throw new DOMException(`Not found: ${path}`, 'NotFoundError');
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
        yield [segment, new FakeFileHandle(key, this.store, this.clock)];
      } else {
        yield [
          segment,
          new FakeDirectoryHandle(
            `${this.prefix}/${segment}`,
            this.store,
            this.clock,
          ),
        ];
      }
    }
  }
}

/** Modification times, and the time later writes are stamped with. */
class Clock {
  private readonly times = new Map<string, number>();
  private now = EPOCH;

  set(ms: number): void {
    this.now = ms;
  }
  stamp(path: string): void {
    this.times.set(path, this.now);
  }
  forget(path: string): void {
    this.times.delete(path);
  }
  timeOf(path: string): number {
    return this.times.get(path) ?? 0;
  }
  reset(): void {
    this.times.clear();
    this.now = EPOCH;
  }
}

/**
 * Where the clock starts. A real `lastModified` is never 0, so a file written
 * through the fake must not read as 0 either: 0 is what a test means when it
 * puts bytes straight into `store`, and code under test is entitled to treat
 * it as "undated".
 */
const EPOCH = 1_700_000_000_000;

/**
 * Installs a fake `navigator.storage.getDirectory()` backed by an in-memory
 * store. Returns a handle to reset/inspect the store between tests, and
 * `setNow` to choose the time later writes are stamped with, and
 * `refuseRemovalOf` to make one path undeletable.
 */
export function installFakeOPFS(): {
  store: Map<string, ArrayBuffer>;
  reset: () => void;
  setNow: (ms: number) => void;
  refuseRemovalOf: (path: string) => void;
} {
  const store = new Map<string, ArrayBuffer>();
  const clock = new Clock();
  const root = new FakeDirectoryHandle('', store, clock);

  Object.defineProperty(globalThis.navigator, 'storage', {
    value: {getDirectory: async () => root},
    configurable: true,
  });

  return {
    store,
    reset: () => {
      store.clear();
      clock.reset();
      unremovable.clear();
    },
    setNow: (ms: number) => clock.set(ms),
    refuseRemovalOf: (path: string) => unremovable.add(path),
  };
}
