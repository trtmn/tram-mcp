import { describe, expect, it } from "vitest";

import type { Env } from "../src/env";
import { checkConfig, configView, getCredentials, propsFromHeaders } from "../src/env";

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
    expect(creds.authMethod).toBe("api_key");
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

  it("client password works while env has only an api key", () => {
    const creds = getCredentials(FULL_ENV, {
      testrailUsername: "me@me.com",
      testrailPassword: "pw",
    });
    expect(creds.authMethod).toBe("password");
    expect(creds.secret).toBe("pw");
  });
});

describe("propsFromHeaders / configView", () => {
  it("extracts the X-TestRail-* headers", () => {
    const headers = new Headers({
      "X-TestRail-URL": "https://h.testrail.io",
      "X-TestRail-Username": "h@h.com",
      "X-TestRail-API-Key": "hkey",
    });
    expect(propsFromHeaders(headers)).toEqual({
      testrailUrl: "https://h.testrail.io",
      testrailUsername: "h@h.com",
      testrailApiKey: "hkey",
      testrailPassword: undefined,
    });
  });

  it("configView never exposes the secret", () => {
    const view = configView(FULL_ENV);
    expect(JSON.stringify(view)).not.toContain("corp-key");
    expect(view.auth_method).toBe("api_key");
    expect(view.credential_source).toBe("worker secrets");
  });
});
