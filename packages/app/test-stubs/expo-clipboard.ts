let clipboardString = "";

export async function setStringAsync(content: string): Promise<void> {
  clipboardString = content;
}

export function getClipboardStringForTests(): string {
  return clipboardString;
}
