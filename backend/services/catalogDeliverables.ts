import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.ts";

export const PRODUCT_FILE_BUCKET = "agentx-product-files";
export const PRODUCT_FILE_LIMIT = 20 * 1024 * 1024;
export class ProductFileError extends Error {}

function productFileType(buffer: Buffer) {
  const hex = buffer.subarray(0, 12).toString("hex");
  if (hex.startsWith("255044462d")) return { extension: "pdf", mimetype: "application/pdf" };
  if (hex.startsWith("89504e470d0a1a0a")) return { extension: "png", mimetype: "image/png" };
  if (hex.startsWith("ffd8ff")) return { extension: "jpg", mimetype: "image/jpeg" };
  if (hex.startsWith("52494646") && hex.slice(16) === "57454250") return { extension: "webp", mimetype: "image/webp" };
  if (hex.startsWith("504b0304") && buffer.subarray(30, 58).toString() === "mimetypeapplication/epub+zip") {
    return { extension: "epub", mimetype: "application/epub+zip" };
  }
  return null;
}

function safeFilename(name: string, extension: string) {
  const stem = name.replace(/^.*[\\/]/, "").replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\.[^.]*$/, "").trim().slice(0, 110);
  return `${stem || "ficheiro"}.${extension}`;
}

export function productFilename(file: Express.Multer.File): string | null {
  const extension = file.originalname.split(".").at(-1)?.toLowerCase();
  const format = productFileType(file.buffer);
  if (!format || !extension || (extension !== format.extension && !(format.extension === "jpg" && extension === "jpeg"))) return null;
  return safeFilename(file.originalname, extension);
}

export async function loadProductFile(userId: string, path: string, name: string, limit = PRODUCT_FILE_LIMIT) {
  const folder = `${userId}/`;
  if (!path.startsWith(folder) || !path.slice(folder.length).split("/")
    .every((part) => /^[a-z0-9_.-]+$/i.test(part) && part !== "." && part !== "..")) {
    throw new ProductFileError("O ficheiro não pertence ao catálogo da conta.");
  }

  const { data, error } = await supabaseAdmin.storage.from(PRODUCT_FILE_BUCKET)
    .download(path, {}, { signal: AbortSignal.timeout(20_000) }).asStream();
  if (error || !data) throw new ProductFileError("O ficheiro não está disponível no armazenamento. Verifique o ficheiro no catálogo.");

  const reader = data.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ProductFileError("Os ficheiros excedem o limite de 20 MiB por pedido.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const content = Buffer.concat(chunks, size);
  const format = productFileType(content);
  if (!format) throw new ProductFileError("O ficheiro no catálogo tem um formato inválido.");
  const extension = format.extension === "jpg" && /\.jpeg$/i.test(name) ? "jpeg" : format.extension;
  return { content, name: safeFilename(name, extension), mimetype: format.mimetype };
}

export async function storeProductFile(userId: string, file: Express.Multer.File, name: string) {
  const path = `${userId}/${randomUUID()}`;
  const { error } = await supabaseAdmin.storage.from(PRODUCT_FILE_BUCKET)
    .upload(path, file.buffer, { contentType: "application/octet-stream", upsert: false });
  if (error) throw error;
  return { deliverable_path: path, deliverable_name: name };
}
