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
// Navigator augmentation
// ---------------------------------------------------------------------------

interface Navigator {
  /** WebMCP model context for registering tools (experimental API). */
  modelContext?: WebMCPModelContext;

  /** WebGPU entry point (experimental API, not available in all browsers). */
  gpu?: GPU;
}
