/**
 * The page geometry that needs no PDF library.
 *
 * Split out from `pdf-geometry.js` for one reason, and it is worth stating plainly: that module
 * imports pdf-lib, `pages.js` imported *this* pair of functions from it, and `pages.js` is
 * imported by the document session — so every page of the app was downloading 425 KB of
 * pdf-lib before it could render, for two lines of arithmetic.
 *
 * ⚠️ **Nothing that reaches app code may import pdf-lib at the top level.** Both copies of it
 * are meant to be lazily loaded: one inside the PDF worker, one in the main-thread fallback.
 * If you add a helper here, keep it dependency-free.
 */

/** Round an arbitrary angle to the nearest quarter turn, as 0, 90, 180 or 270. */
export function normalizeRotation(angle) {
  return (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
}

// A crop only matters if it actually removes something; a full-page rect is a no-op and not
// worth rewriting the page boxes for.
export function isCropMeaningful(crop) {
  if (!crop) return false;
  return crop.x > 0.001 || crop.y > 0.001 || crop.width < 0.999 || crop.height < 0.999;
}
