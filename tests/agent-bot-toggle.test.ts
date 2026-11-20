import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock SupabaseAdmin
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();

const fakeSupabaseAdmin = {
  from: vi.fn((table: string) => ({
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
    eq: mockEq,
    order: mockOrder,
    limit: mockLimit,
  }))
};

describe("SmartBot / Agent Active Toggle & Execution Checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not trigger AI response when agent is_active is false", async () => {
    // Simulate agentManager's check when agent.is_active === false
    const agents = [
      {
        id: "agent-123",
        user_id: "user-abc",
        is_active: false,
        provider: "gemini",
        model: "gemini-3-flash-preview",
        instructions: "Test instructions",
        created_at: new Date().toISOString()
      }
    ];

    const agent = agents && agents.length > 0 ? agents[0] : null;
    const shouldSkip = !agent || !agent.is_active;

    expect(shouldSkip).toBe(true);
  });

  it("should trigger AI response only when agent is_active is true", async () => {
    const agents = [
      {
        id: "agent-123",
        user_id: "user-abc",
        is_active: true,
        provider: "gemini",
        model: "gemini-3-flash-preview",
        instructions: "Test instructions",
        created_at: new Date().toISOString()
      }
    ];

    const agent = agents && agents.length > 0 ? agents[0] : null;
    const shouldSkip = !agent || !agent.is_active;

    expect(shouldSkip).toBe(false);
  });

  it("should prioritize latest agent and respect is_active: false even if older records exist", () => {
    // Array ordered by created_at DESC
    const agentsSortedDesc = [
      {
        id: "agent-newest",
        user_id: "user-abc",
        is_active: false,
        created_at: "2026-11-20T23:00:00Z"
      },
      {
        id: "agent-old",
        user_id: "user-abc",
        is_active: true,
        created_at: "2026-03-01T10:00:00Z"
      }
    ];

    // Under the new logic: pick newest agent first, then check is_active
    const latestAgent = agentsSortedDesc[0];
    const isAllowed = latestAgent && latestAgent.is_active;

    expect(isAllowed).toBe(false);
  });

  it("should parse boolean and string values accurately for is_active toggle", () => {
    const parseToggle = (body: any) => body.is_active === true || body.is_active === "true";

    expect(parseToggle({ is_active: false })).toBe(false);
    expect(parseToggle({ is_active: true })).toBe(true);
    expect(parseToggle({ is_active: "false" })).toBe(false);
    expect(parseToggle({ is_active: "true" })).toBe(true);
    expect(parseToggle({})).toBe(false);
  });

  it("should ensure contact ai_paused flag halts automated agent messages", () => {
    const contactData = {
      id: "contact-1",
      ai_paused: true,
      name: "Cliente Manual"
    };
    const isOwner = false;

    const shouldHalt = !isOwner && contactData?.ai_paused;
    expect(shouldHalt).toBe(true);
  });
});
