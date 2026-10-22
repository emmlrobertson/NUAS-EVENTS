import { describe, it, expect } from "vitest";
import { GET } from "../src/app/api/health/route";

describe("Health Check Endpoint (/api/health)", () => {
  it("returns 200 OK and valid status json without leaking credentials", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("nuas-awards-api");
    expect(body.timestamp).toBeDefined();

    // Ensure NO credentials, secrets, or host info are exposed
    const stringified = JSON.stringify(body);
    expect(stringified).not.toContain("postgres");
    expect(stringified).not.toContain("password");
    expect(stringified).not.toContain("5432");
    expect(stringified).not.toContain("DATABASE_URL");
  });
});
