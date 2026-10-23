export function compressToBase64(input: string): string
export function decompressFromBase64(input: string): string

export function compressToUTF16(input: string): string
export function decompressFromUTF16(compressed: string): string

export function compressToUint8Array(uncompressed: string): Uint8Array
export function decompressFromUint8Array(compressed: Uint8Array): string

export function compressToEncodedURIComponent(input: string): string
export function decompressFromEncodedURIComponent(compressed: string): string

export function compress(input: string): string
export function decompress(compressed: string): string

declare const lzstring: {
  compressToBase64: typeof compressToBase64
  decompressFromBase64: typeof decompressFromBase64
  compressToUTF16: typeof compressToUTF16
  decompressFromUTF16: typeof decompressFromUTF16
  compressToUint8Array: typeof compressToUint8Array
  decompressFromUint8Array: typeof decompressFromUint8Array
  compressToEncodedURIComponent: typeof compressToEncodedURIComponent
  decompressFromEncodedURIComponent: typeof decompressFromEncodedURIComponent
  compress: typeof compress
  decompress: typeof decompress
}

export default lzstring
