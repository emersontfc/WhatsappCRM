import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, abortSignal } = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { rpc } }));

import { directProofCandidate, processDirectPaymentProof, selectDirectPaymentProof } from "../backend/services/directPaymentProofs.ts";
import { proofAttachmentMime } from "../backend/services/paymentProofAttachments.ts";

describe("private WhatsApp payment attachments", () => {
  beforeEach(() => {
    rpc.mockReset().mockReturnValue({ abortSignal });
    abortSignal.mockReset();
  });

  it("recognises short, explicit PDF/image evidence captions and leaves unrelated media alone", () => {
    expect(directProofCandidate({ imageMessage: {} })).toMatchObject({ explicit: false, orderNumbers: [] });
    expect(directProofCandidate({ imageMessage: { caption: "Esta cor ainda está disponível?" } })).toBeNull();
    expect(directProofCandidate({ videoMessage: { caption: "Comprovativo AGX-A" } })).toBeNull();
    expect(directProofCandidate({ documentMessage: { fileName: "prova.PDF", caption: "AGX-abc-12 e agx-abc-12" } }))
      .toMatchObject({ explicit: true, orderNumbers: ["AGX-ABC-12"], filename: "prova.PDF" });
    expect(directProofCandidate({ documentMessage: { fileName: "prova.docx", caption: "Paguei o pedido" } }))
      .toMatchObject({ explicit: true });
  });

  it("checks actual bytes independently of the WhatsApp filename and MIME", () => {
    expect(proofAttachmentMime(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    expect(proofAttachmentMime(Buffer.from("ffd8ff00", "hex"))).toBe("image/jpeg");
    expect(proofAttachmentMime(Buffer.from("89504e470d0a1a0a00", "hex"))).toBe("image/png");
    expect(proofAttachmentMime(Buffer.from("RIFF0123WEBP"))).toBe("image/webp");
    expect(proofAttachmentMime(Buffer.from("<html>confirmado</html>"))).toBeNull();
    expect(proofAttachmentMime(Buffer.alloc(0))).toBeNull();
  });

  it("asks for one order and creates a scoped task without accessing files when there are two explicit references", async () => {
    abortSignal.mockResolvedValue({ data: true, error: null });
    const candidate = directProofCandidate({ imageMessage: { caption: "Comprovativo AGX-A ou AGX-B" } })!;
    const selection = await selectDirectPaymentProof("seller-id", "owned-contact", candidate);
    expect(selection).toEqual({ status: "ambiguous" });
    const load = vi.fn();
    const reply = await processDirectPaymentProof({ userId: "seller-id", contactId: "owned-contact", sourceMessageId: "msg-id", candidate },
      selection, { load });
    expect(reply).toContain("um único código AGX");
    expect(load).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("agentx_record_direct_proof_intake_event", {
      p_user: "seller-id", p_contact: "owned-contact", p_source_message: "msg-id", p_reason: "ambiguous_order"
    });
  });
});
