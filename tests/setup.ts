// Minimal ImageData for decoding tests (the browser provides the real one).
class TestImageData {
  data: Uint8ClampedArray;
  constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
}
(globalThis as { ImageData?: unknown }).ImageData ??= TestImageData;
