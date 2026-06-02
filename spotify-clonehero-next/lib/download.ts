/**
 * Trigger a browser download of a Blob/File under a chosen file name.
 *
 * Appends a temporary anchor to the document (required by Firefox) and revokes
 * the object URL afterwards. Browser-only.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
