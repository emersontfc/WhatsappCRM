import { beforeEach, describe, expect, it, vi } from "vitest";
import { productFilename } from "../backend/services/catalogDeliverables.ts";
import { commerceService } from "../backend/services/commerceService.ts";
import { createOrderTool } from "../backend/tools/commerce/createOrder.ts";
import { getProductsCatalogTool } from "../backend/tools/commerce/getProductsCatalog.ts";
import type { ToolContext } from "../backend/tools/types.ts";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), sign: vi.fn(), send: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc, storage: { from: () => ({ createSignedUrl: mocks.sign }) } }
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

  it("only sends after a paid order has been exclusively claimed", async () => {
    const order = {
      status: "paid", order_number: "AGX-TEST", customer_phone: "841234567",
      order_items: [{ product_name: "Livro", quantity: 1, deliverable_snapshot: {
        type: "digital", path: "company/file", name: "livro.pdf"
      } }]
    };
    mocks.from.mockReturnValueOnce(query(order)).mockReturnValueOnce(query(null));
    mocks.sign.mockResolvedValue({ data: { signedUrl: "https://storage.invalid/book" } });
    expect((await commerceService.fulfillOrder("order", ctx.userId)).delivered).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.from.mockReturnValueOnce(query(order)).mockReturnValueOnce(query({ id: "order" }))
      .mockReturnValueOnce(query(null)).mockReturnValueOnce(query(null));
    mocks.send.mockResolvedValue({ key: { id: "wa-id" } });
    expect((await commerceService.fulfillOrder("order", ctx.userId)).delivered).toBe(true);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(ctx.userId, ctx.jid,
      expect.stringContaining("https://storage.invalid/book"));
    expect(mocks.sign).toHaveBeenLastCalledWith("company/file", 86400, { download: "livro.pdf" });
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
