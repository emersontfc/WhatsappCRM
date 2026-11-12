import { describe, it, expect } from "vitest";

const ROLE_HIERARCHY: Record<string, number> = {
  superadmin: 100,
  admin: 80,
  manager: 60,
  operator: 40,
  user: 20
};

function hasPermission(userRole: string, requiredRole: string): boolean {
  const userRank = ROLE_HIERARCHY[userRole] || 0;
  const requiredRank = ROLE_HIERARCHY[requiredRole] || 0;
  return userRank >= requiredRank;
}

function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.split(" ")[1]?.trim();
  return token && token.length > 10 ? token : null;
}

describe("Authentication & RBAC Control", () => {
  it("enforces role hierarchy where superadmin outranks all roles", () => {
    expect(hasPermission("superadmin", "admin")).toBe(true);
    expect(hasPermission("superadmin", "manager")).toBe(true);
    expect(hasPermission("superadmin", "operator")).toBe(true);
    expect(hasPermission("superadmin", "user")).toBe(true);
  });

  it("allows admin to access manager, operator, and user actions", () => {
    expect(hasPermission("admin", "manager")).toBe(true);
    expect(hasPermission("admin", "operator")).toBe(true);
    expect(hasPermission("admin", "user")).toBe(true);
    expect(hasPermission("admin", "superadmin")).toBe(false);
  });

  it("prevents operator or user from executing admin-only operations", () => {
    expect(hasPermission("user", "admin")).toBe(false);
    expect(hasPermission("operator", "admin")).toBe(false);
    expect(hasPermission("manager", "admin")).toBe(false);
  });

  it("correctly extracts Bearer token from HTTP Authorization header", () => {
    const validHeader = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz";
    expect(extractBearerToken(validHeader)).toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz");
  });

  it("rejects malformed, empty or non-Bearer authorization headers", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Basic user:pass")).toBeNull();
    expect(extractBearerToken("Bearer ")).toBeNull();
  });
});

