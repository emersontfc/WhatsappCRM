import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.ts";

export const PRODUCT_FILE_BUCKET = "agentx-product-files";
export const PRODUCT_FILE_LIMIT = 20 * 1024 * 1024;

export function productFilename(file: Express.Multer.File): string | null {
  const extension = file.originalname.split(".").at(-1)?.toLowerCase();
  const hex = file.buffer.subarray(0, 12).toString("hex");
  const supported = extension === "pdf" ? hex.startsWith("255044462d")
    : extension === "png" ? hex.startsWith("89504e470d0a1a0a")
    : extension === "jpg" || extension === "jpeg" ? hex.startsWith("ffd8ff")
    : extension === "webp" ? hex.startsWith("52494646") && hex.slice(16) === "57454250"
    : extension === "epub" ? hex.startsWith("504b0304") && file.buffer.subarray(30, 58).toString() === "mimetypeapplication/epub+zip"
    : false;
  if (!supported) return null;
  const stem = file.originalname.replace(/^.*[\\/]/, "").replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\.[^.]*$/, "").trim().slice(0, 110);
  return `${stem || "ficheiro"}.${extension}`;
}

export async function storeProductFile(userId: string, file: Express.Multer.File, name: string) {
  const path = `${userId}/${randomUUID()}`;
  const { error } = await supabaseAdmin.storage.from(PRODUCT_FILE_BUCKET)
    .upload(path, file.buffer, { contentType: "application/octet-stream", upsert: false });
  if (error) throw error;
  return { deliverable_path: path, deliverable_name: name };
}
