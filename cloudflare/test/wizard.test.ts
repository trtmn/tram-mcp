import { afterEach, describe, expect, it, vi } from "vitest";

import { handleSubmit, loginFormPage } from "../src/wizard";

afterEach(() => vi.unstubAllGlobals());

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 }));
}

describe("loginFormPage", () => {
  it("renders the TestRail form with a masked secret field and no OAuth field", () => {
    const html = loginFormPage();
    expect(html).toContain("Connect to TestRail");
    expect(html).toContain('name="secret"');
    expect(html).toContain('type="password"');
    expect(html).toContain('action="/submit"');
    expect(html).not.toContain("oauth_req");
  });

  it("shows an error banner and preserves entered values", () => {
    const html = loginFormPage({ error: "Bad creds", values: { username: "u@c.com" } });
    expect(html).toContain("Bad creds");
    expect(html).toContain("u@c.com");
  });

  it("embeds the CSRF token as a hidden field when provided", () => {
    expect(loginFormPage({ token: "tok123" })).toContain(
      'name="wizard_token" value="tok123"',
    );
    expect(loginFormPage()).not.toContain("wizard_token");
  });
});

describe("handleSubmit", () => {
  it("saves and returns creds when TestRail validates", async () => {
    vi.stubGlobal("fetch", okFetch());
    const res = await handleSubmit({
      instance_url: "https://c.testrail.io/",
      username: "u@c.com",
      auth_method: "api_key",
      secret: "k",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.creds).toEqual({
        url: "https://c.testrail.io",
        username: "u@c.com",
        auth_method: "api_key",
        secret: "k",
      });
    }
  });

  it("rejects missing fields with a 400 form page and preserves the token", async () => {
    const res = await handleSubmit({
      wizard_token: "tok123",
      instance_url: "",
      username: "",
      auth_method: "api_key",
      secret: "",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.page).toContain("All fields are required");
      expect(res.page).toContain('name="wizard_token" value="tok123"');
    }
  });

  it("maps a TestRail 401 to a credential error page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const res = await handleSubmit({
      instance_url: "https://c.testrail.io",
      username: "u@c.com",
      auth_method: "api_key",
      secret: "bad",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.page).toContain("rejected those credentials");
    }
  });
});
