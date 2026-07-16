import { describe, expect, it } from "vitest";

import type { Env } from "../src/env";
import { checkConfig, configView, getCredentials } from "../src/env";

const FULL_ENV = {
  TESTRAIL_URL: "https://corp.testrail.io/",
  TESTRAIL_USERNAME: "bot@corp.com",
  TESTRAIL_API_KEY: "corp-key",
} as unknown as Env;

const EMPTY_ENV = {} as unknown as Env;

describe("checkConfig", () => {
  it("passes with complete worker secrets", () => {
    expect(checkConfig(FULL_ENV)).toBeNull();
  });

  it("lists every missing variable", () => {
    const msg = checkConfig(EMPTY_ENV)!;
    expect(msg).toContain("TESTRAIL_URL");
    expect(msg).toContain("TESTRAIL_USERNAME");
    expect(msg).toContain("TESTRAIL_API_KEY or TESTRAIL_PASSWORD");
  });

  it("accepts complete per-client headers with an empty env", () => {
    expect(
      checkConfig(EMPTY_ENV, {
        testrailUrl: "https://me.testrail.io",
        testrailUsername: "me@me.com",
        testrailPassword: "pw",
      }),
    ).toBeNull();
  });
});

describe("getCredentials", () => {
  it("strips trailing slashes and prefers api_key", () => {
    const creds = getCredentials(FULL_ENV);
    expect(creds.url).toBe("https://corp.testrail.io");
    expect(creds.secret).toBe("corp-key");
  });

  it("per-client values override worker secrets", () => {
    const creds = getCredentials(FULL_ENV, {
      testrailUrl: "https://mine.testrail.io",
      testrailUsername: "me@me.com",
      testrailApiKey: "my-key",
    });
    expect(creds.url).toBe("https://mine.testrail.io");
    expect(creds.username).toBe("me@me.com");
    expect(creds.secret).toBe("my-key");
  });

  it("never pairs a client username with the worker secret", () => {
    expect(() =>
      getCredentials(FULL_ENV, { testrailUsername: "me@me.com" }),
    ).toThrow(/Missing TestRail configuration/);
  });

  it("never pairs a client URL with the worker secret (credential isolation)", () => {
    // A client supplying only a URL must NOT borrow the Worker's username/key
    // and transmit them to the client-controlled host.
    expect(() =>
      getCredentials(FULL_ENV, { testrailUrl: "https://attacker.testrail.io" }),
    ).toThrow(/Missing TestRail configuration/);
  });

  it("any client-supplied field switches to client-only resolution", () => {
    // Client supplies a full set; env values are completely ignored.
    const creds = getCredentials(
      { TESTRAIL_URL: "https://corp.testrail.io" } as unknown as Env,
      {
        testrailUrl: "https://mine.testrail.io",
        testrailUsername: "me@me.com",
        testrailApiKey: "my-key",
      },
    );
    expect(creds.url).toBe("https://mine.testrail.io");
    expect(creds.secret).toBe("my-key");
  });

  it("client password auth works (full client connection, env ignored)", () => {
    const creds = getCredentials(FULL_ENV, {
      testrailUrl: "https://mine.testrail.io",
      testrailUsername: "me@me.com",
      testrailPassword: "pw",
    });
    expect(creds.url).toBe("https://mine.testrail.io");
    expect(creds.secret).toBe("pw");
  });
});

describe("configView", () => {
  it("never exposes the secret", () => {
    const view = configView(FULL_ENV);
    expect(JSON.stringify(view)).not.toContain("corp-key");
    expect(view.auth_method).toBe("api_key");
  });

  it("labels the source 'worker secrets' when the OAuth provider is bound", () => {
    const workerEnv = { ...FULL_ENV, OAUTH_PROVIDER: {} } as unknown as Env;
    expect(configView(workerEnv).credential_source).toBe("worker secrets");
  });

  it("labels the source 'local' when there is no OAuth provider (stdio run)", () => {
    expect(configView(FULL_ENV).credential_source).toBe("local (env or ~/.tram-mcp)");
  });
});
