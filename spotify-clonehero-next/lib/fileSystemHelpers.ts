export async function writeFile(
  fileHandle: FileSystemFileHandle,
  contents: string,
) {
  // Create a FileSystemWritableFileStream to write to.
  const writable = await fileHandle.createWritable();

  // Write the contents of the file to the stream.
  await writable.write(contents);

  // Close the file and write the contents to disk.
  await writable.close();
}

export async function readJsonFile(fileHandle: FileSystemFileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  return JSON.parse(text);
}

export async function readTextFile(fileHandle: FileSystemFileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  return text;
}
