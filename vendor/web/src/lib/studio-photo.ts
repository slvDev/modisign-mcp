// generated from the Modisign monorepo, do not edit
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif";
export const STUDIO_MEDIA_ACCEPT = `video/*,${PHOTO_ACCEPT}`;
export type OwnPhoto = { file: File; url: string; width: number; height: number };

export function isPhotoFile(file: File) {
  return /^image\//i.test(file.type) || /\.(jpe?g|png|webp|avif|hei[cf])$/i.test(file.name);
}

export async function readStudioPhoto(file: File, signal: AbortSignal): Promise<OwnPhoto> {
  const extension = file.name.split(".").at(-1);
  if (/\.(hei[cf])$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)) throw new Error("This browser cannot read HEIC photos. Try JPEG, PNG, WebP or AVIF.");
  if (!/^image\/(jpeg|png|webp|avif)$/i.test(file.type) && !/\.(jpe?g|png|webp|avif)$/i.test(file.name)) {
    throw new Error(`This browser cannot read ${extension === undefined ? "this format" : extension.toUpperCase()} photos. Try JPEG, PNG, WebP or AVIF.`);
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await createImageBitmap(file);
    try {
      signal.throwIfAborted();
      if (image.width <= 0 || image.height <= 0) throw new Error("This photo has no readable picture.");
      return { file, url, width: image.width, height: image.height };
    } finally { image.close(); }
  } catch (error) {
    URL.revokeObjectURL(url);
    if (signal.aborted) throw error;
    throw new Error("This photo could not be opened. Try JPEG, PNG, WebP or AVIF.");
  }
}
