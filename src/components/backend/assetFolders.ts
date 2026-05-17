import type { AssetFolder } from '@/types/config';

// Render boxes used by the low-res / replace filters. Mirrors the bounding
// boxes the frontend renders images in (`.quiz-image` and `.image-guess-image`
// — see specs/admin-backend.md §Low-resolution filter). An image is "low-res"
// when both its natural dimensions are smaller than the box it appears in.
export const RENDER_BOX_QUIZ = { w: 1920, h: 540 };
export const RENDER_BOX_IMAGE_GUESS = { w: 1920, h: 648 };

// Collect all folder paths recursively.
export function getAllFolderPaths(folders: AssetFolder[], prefix = ''): string[] {
  return folders.flatMap(f => {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    return [p, ...getAllFolderPaths(f.subfolders, p)];
  });
}
