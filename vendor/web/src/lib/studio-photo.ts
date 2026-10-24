// generated from the Modisign monorepo, do not edit
import { ImportError } from "@/lib/import-progress";

export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif";
export const STUDIO_MEDIA_ACCEPT = `video/*,${PHOTO_ACCEPT}`;
export type OwnPhoto = { file: File; url: string; width: number; height: number };

export function isPhotoFile(file: File) {
  return /^image\//i.test(file.type) || /\.(jpe?g|png|webp|avif|hei[cf])$/i.test(file.name);
}

const PHOTO_CHOICE = "Choose a JPEG, PNG, WebP or AVIF photo.";

// Decodes the photo once; the caller closes the bitmap and owns the blob URL.
export async function openStudioPhoto(file: File, signal: AbortSignal): Promise<{ photo: OwnPhoto; image: ImageBitmap }> {
  if (/\.(hei[cf])$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)) throw new ImportError(`isn’t supported in Studio. ${PHOTO_CHOICE}`, "unsupported_photo");
  if (!/^image\/(jpeg|png|webp|avif)$/i.test(file.type) && !/\.(jpe?g|png|webp|avif)$/i.test(file.name)) throw new ImportError(`isn’t a supported photo format. ${PHOTO_CHOICE}`, "unsupported_photo");
  let image: ImageBitmap;
  try { image = await createImageBitmap(file); } catch { throw new ImportError(`couldn’t be opened. The photo may be damaged. ${PHOTO_CHOICE}`, "photo_damaged"); }
  // createImageBitmap takes no signal, so a canceled decode that still resolves is closed here.
  if (signal.aborted) image.close();
  signal.throwIfAborted();
  if (image.width <= 0 || image.height <= 0) {
    image.close();
    throw new ImportError(`has no readable picture. ${PHOTO_CHOICE}`, "photo_damaged");
  }
  return { photo: { file, url: URL.createObjectURL(file), width: image.width, height: image.height }, image };
}

export async function readStudioPhoto(file: File, signal: AbortSignal): Promise<OwnPhoto> {
  const { photo, image } = await openStudioPhoto(file, signal);
  image.close();
  return photo;
}
