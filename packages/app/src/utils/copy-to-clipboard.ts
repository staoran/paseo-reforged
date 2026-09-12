import * as Clipboard from "expo-clipboard";

/** Copies text and reports whether the platform confirmed the operation */
export async function copyToClipboard(text: string): Promise<boolean> {
  return Clipboard.setStringAsync(text);
}
