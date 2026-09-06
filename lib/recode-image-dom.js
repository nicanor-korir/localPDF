// The DOM half of the image re-encoder, for browsers without OffscreenCanvas — Safari before
// 16.4 — where the whole job has to run on the main thread.

import { recodeImageWith } from './recode-image.js';

export function recodeImageOnMainThread(request) {
  return recodeImageWith(request, {
    createCanvas: (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    toJpeg: (canvas, quality) =>
      new Promise((resolve) => {
        canvas.toBlob(
          async (blob) => resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null),
          'image/jpeg',
          quality,
        );
      }),
  });
}
