/**
 * Type augmentations for non-standard Navigator APIs used in this project.
 */

// ---------------------------------------------------------------------------
// WebMCP — navigator.modelContext
// ---------------------------------------------------------------------------

interface WebMCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<{
    content: Array<{type: string; text: string}>;
  }>;
}

interface WebMCPModelContext {
  registerTool(tool: WebMCPToolDefinition): void;
}

// ---------------------------------------------------------------------------
// WebGPU — navigator.gpu
// ---------------------------------------------------------------------------

interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance';
}

interface GPUAdapter {
  readonly name: string;
  requestDevice(descriptor?: Record<string, unknown>): Promise<GPUDevice>;
}

interface GPUDevice {
  readonly lost: Promise<GPUDeviceLostInfo>;
  destroy(): void;
}

interface GPUDeviceLostInfo {
  readonly message: string;
  readonly reason: 'destroyed' | undefined;
}

interface GPU {
  requestAdapter(
    options?: GPURequestAdapterOptions,
  ): Promise<GPUAdapter | null>;
}

// ---------------------------------------------------------------------------
// Storage Buckets — navigator.storageBuckets
//
// Not in the DOM lib. Workers reach this through the same `Navigator` type,
// since `lib.webworker` is not in tsconfig's `lib` and worker code here is
// checked against `lib.dom`.
// ---------------------------------------------------------------------------

interface StorageBucketOptions {
  /** Ask for the bucket to be exempt from automatic eviction. */
  persisted?: boolean;
  /** 'relaxed' lets the browser batch writes; 'strict' flushes them. */
  durability?: 'strict' | 'relaxed';
  expires?: number;
}

interface StorageBucket {
  readonly name: string;
  /** This bucket's own OPFS root, separate from every other bucket's. */
  getDirectory(): Promise<FileSystemDirectoryHandle>;
  persist(): Promise<boolean>;
  persisted(): Promise<boolean>;
  estimate(): Promise<StorageEstimate>;
}

interface StorageBucketManager {
  open(name: string, options?: StorageBucketOptions): Promise<StorageBucket>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Navigator augmentation
// ---------------------------------------------------------------------------

interface Navigator {
  /** WebMCP model context for registering tools (experimental API). */
  modelContext?: WebMCPModelContext;

  /** WebGPU entry point (experimental API, not available in all browsers). */
  gpu?: GPU;

  /** Storage Buckets (Chromium only at the time of writing). */
  storageBuckets?: StorageBucketManager;
}
