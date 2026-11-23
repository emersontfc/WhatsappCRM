import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadProductFile, productFilename } from "../backend/services/catalogDeliverables.ts";
import { commerceService } from "../backend/services/commerceService.ts";
import { createOrderTool } from "../backend/tools/commerce/createOrder.ts";
import { getProductsCatalogTool } from "../backend/tools/commerce/getProductsCatalog.ts";
import type { ToolContext } from "../backend/tools/types.ts";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), download: vi.fn(), send: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc, storage: { from: () => ({ download: mocks.download }) } }
}));
vi.mock("../backend/whatsappManager.ts", () => ({ whatsappManager: { sendMessage: mocks.send } }));
const ctx: ToolContext = { userId: "company", role: "lead", phone: "841234567", jid: "841234567@s.whatsapp.net", whatsappManager: {} };

function file(originalname: string, data: string, encoding: BufferEncoding = "utf8") {
  return { originalname, buffer: Buffer.from(data, encoding) } as Express.Multer.File;
}
function query(data: unknown) {
  const result = { data, error: null };
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain), is: vi.fn(() => chain),
    order: vi.fn(() => chain), insert: vi.fn(() => chain), update: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result),
    then: <T>(resolve: (value: typeof result) => T) => Promise.resolve(result).then(resolve)
  };
  return chain;
}

beforeEach(() => vi.resetAllMocks());

const pdf = Buffer.from("%PDF-1.7\nLivro");
const pdfItem = { product_name: "Livro", quantity: 1,
  deliverable_snapshot: { type: "digital", path: "company/file", name: "livro.pdf" } };
const paidOrder = { status: "paid", order_number: "AGX-TEST", customer_phone: "841234567", order_items: [pdfItem] };

function downloadFile(content = pdf) {
  mocks.download.mockImplementation(() => ({
    asStream: async () => ({ data: new ReadableStream({
      start(controller) { controller.enqueue(content); controller.close(); }
    }), error: null })
  }));
}

describe("commerce catalog and private files", () => {
  it("accepts a PDF and an image with matching file headers", () => {
    expect(productFilename(file("../Livro.pdf", "%PDF-1.7"))).toBe("Livro.pdf");
    expect(productFilename(file("Imagem.png", "89504e470d0a1a0a", "hex"))).toBe("Imagem.png");
    expect(productFilename(file("Livro.pdf", "<html>"))).toBeNull();
  });

  it("looks up the live account catalog without selecting private content", async () => {
    const lookup = query([{ id: "book", name: "Introdução", category: "Educação", price: 30, stock: 2 }]);
    mocks.from.mockReturnValue(lookup);
    mocks.rpc.mockResolvedValue({ data: "lead", error: null });
    const response = await getProductsCatalogTool.execute({ category: "educacao", search: "introducao" }, ctx);
    expect(response.success).toBe(true);
    expect(response.data[0].name).toBe("Introdução");
    expect(lookup.eq).toHaveBeenCalledWith("user_id", ctx.userId);
    expect(mocks.rpc).toHaveBeenCalledWith("agentx_capture_sales_lead", expect.objectContaining({ p_user: ctx.userId, p_phone: ctx.phone }));
    expect(lookup.select).toHaveBeenCalledWith("id,name,description,price,currency,category,stock");
  });

  it("rejects nonexistent products instead of creating a zero-price order", async () => {
    mocks.from.mockReturnValue(query([]));
    const result = await createOrderTool.execute({ productName: "Unknown" }, ctx);
    expect(result.success).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reports a legacy schema failure without sending the SQL error to a customer", async () => {
    mocks.from.mockReturnValue(query([{ id: "book", name: "Livro", price: 30, stock: 2 }]));
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42703", message: "column last_action of relation leads does not exist" } });
    const result = await createOrderTool.execute({ productName: "Livro" }, ctx);
    expect(result).toMatchObject({ success: false, code: "SALES_SCHEMA_REQUIRED" });
    expect(JSON.stringify(result)).not.toContain("last_action");
  });

  it("sends the actual private file once after exclusively claiming a paid order", async () => {
    downloadFile();
    mocks.from.mockReturnValueOnce(query(paidOrder)).mockReturnValueOnce(query(null));
    expect((await commerceService.fulfillOrder("order", ctx.userId)).delivered).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.from.mockReturnValueOnce(query(paidOrder)).mockReturnValueOnce(query({ id: "order" }))
      .mockReturnValueOnce(query({ id: "order" })).mockReturnValueOnce(query(null));
    mocks.send.mockResolvedValue({ key: { id: "wa-id" } });
    expect((await commerceService.fulfillOrder("order", ctx.userId)).delivered).toBe(true);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(ctx.userId, "258841234567@s.whatsapp.net",
      expect.stringContaining("Pagamento confirmado"), pdf, "document", undefined, "application/pdf", "livro.pdf");
    expect(mocks.download).toHaveBeenLastCalledWith("company/file", {}, { signal: expect.any(AbortSignal) });
  });

  it("does not load a file from another account or a relative path that escapes the folder", async () => {
    for (const path of ["other/file", "company/../other/file", "company/%2e%2e/other/file"]) {
      await expect(loadProductFile(ctx.userId, path, "livro.pdf")).rejects.toThrow("não pertence ao catálogo");
    }
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("stops reading when the remaining file limit is reached", async () => {
    downloadFile();
    await expect(loadProductFile(ctx.userId, "company/file", "livro.pdf", 4)).rejects.toThrow("20 MiB");
  });

  it("leaves delivery available for retry when the private file cannot be fetched", async () => {
    mocks.from.mockReturnValueOnce(query(paidOrder));
    mocks.download.mockReturnValue({ asStream: async () => ({ data: null, error: { message: "not found" } }) });
    expect(await commerceService.fulfillOrder("order", ctx.userId)).toMatchObject({
      delivered: false, message: expect.stringContaining("Verifique o ficheiro no catálogo")
    });
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("releases the claim only when the first attachment failed before WhatsApp was connected", async () => {
    downloadFile();
    const recovery = query(null);
    mocks.from.mockReturnValueOnce(query(paidOrder)).mockReturnValueOnce(query({ id: "order" })).mockReturnValueOnce(recovery);
    mocks.send.mockRejectedValue(new Error("WhatsApp session not connected."));
    expect(await commerceService.fulfillOrder("order", ctx.userId)).toMatchObject({
      delivered: false, message: expect.stringContaining("Ligue a sessão")
    });
    expect(recovery.update).toHaveBeenCalledWith({ delivery_error: "WhatsApp desligado", delivery_started_at: null });
  });

  it("does not release the claim after a partially acknowledged delivery", async () => {
    downloadFile();
    const recovery = query(null);
    const order = { ...paidOrder, order_items: [pdfItem, pdfItem] };
    mocks.from.mockReturnValueOnce(query(order)).mockReturnValueOnce(query({ id: "order" })).mockReturnValueOnce(recovery);
    mocks.send.mockResolvedValueOnce({ key: { id: "doc-1" } }).mockRejectedValueOnce(new Error("WhatsApp session not connected."));
    expect(await commerceService.fulfillOrder("order", ctx.userId)).toMatchObject({
      delivered: false, message: expect.stringContaining("por confirmar")
    });
    expect(recovery.update).toHaveBeenCalledWith({ delivery_error: "Envio parcial por verificar" });
  });

  it("retains payment state when WhatsApp does not acknowledge the send", async () => {
    const order = {
      status: "paid", order_number: "AGX-TEST", customer_phone: "841234567",
      order_items: [{ product_name: "Livro", quantity: 1, deliverable_snapshot: { type: "digital", text: "Example" } }]
    };
    const failure = query(null);
    mocks.from.mockReturnValueOnce(query(order)).mockReturnValueOnce(query({ id: "order" })).mockReturnValueOnce(failure);
    mocks.send.mockRejectedValue(new Error("timeout"));
    expect((await commerceService.fulfillOrder("order", ctx.userId)).delivered).toBe(false);
    expect(failure.update).toHaveBeenCalledWith({ delivery_error: "Envio por confirmar" });
  });
});
