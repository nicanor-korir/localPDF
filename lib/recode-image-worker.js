// The OffscreenCanvas half of the image re-encoder, used inside the PDF worker.
//
// Kept separate from the DOM one so neither drags the other's globals into a bundle with no
// use for them; everything they share lives in recode-image.js.

import { recodeImageWith } from './recode-image.js';

export function recodeImageInWorker(request) {
  return recodeImageWith(request, {
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
    toJpeg: async (canvas, quality) => {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      return new Uint8Array(await blob.arrayBuffer());
    },
  });
}
