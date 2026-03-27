import { describe, it, expect } from "vitest";
import {
  getWebhookHeader,
  parseWebhookJsonObject,
  parseWebhookTimestamp,
  parseWebhookBranchRef,
} from "../scm-webhook-utils.js";

describe("getWebhookHeader", () => {
  it("returns header value for exact case match", () => {
    const headers = { "Content-Type": "application/json" };
    expect(getWebhookHeader(headers, "Content-Type")).toBe("application/json");
  });

  it("returns header value for case-insensitive match", () => {
    const headers = { "X-GitHub-Event": "push" };
    expect(getWebhookHeader(headers, "x-github-event")).toBe("push");
    expect(getWebhookHeader(headers, "X-GITHUB-EVENT")).toBe("push");
  });

  it("returns first element when header value is an array", () => {
    const headers = { "X-Forwarded-For": ["192.168.1.1", "10.0.0.1"] };
    expect(getWebhookHeader(headers, "x-forwarded-for")).toBe("192.168.1.1");
  });

  it("returns undefined for missing header", () => {
    const headers = { "Content-Type": "application/json" };
    expect(getWebhookHeader(headers, "X-Missing-Header")).toBeUndefined();
  });

  it("returns undefined for empty headers object", () => {
    expect(getWebhookHeader({}, "Any-Header")).toBeUndefined();
  });
});

describe("parseWebhookJsonObject", () => {
  it("parses valid JSON object", () => {
    const body = '{"key": "value", "count": 42}';
    const result = parseWebhookJsonObject(body);
    expect(result).toEqual({ key: "value", count: 42 });
  });

  it("parses nested JSON object", () => {
    const body = '{"outer": {"inner": "nested"}}';
    const result = parseWebhookJsonObject(body);
    expect(result).toEqual({ outer: { inner: "nested" } });
  });

  it("throws for JSON array", () => {
    const body = '["item1", "item2"]';
    expect(() => parseWebhookJsonObject(body)).toThrow(
      "Webhook payload must be a JSON object",
    );
  });

  it("throws for primitive values", () => {
    expect(() => parseWebhookJsonObject('"string"')).toThrow(
      "Webhook payload must be a JSON object",
    );
    expect(() => parseWebhookJsonObject("42")).toThrow(
      "Webhook payload must be a JSON object",
    );
    expect(() => parseWebhookJsonObject("true")).toThrow(
      "Webhook payload must be a JSON object",
    );
    expect(() => parseWebhookJsonObject("null")).toThrow(
      "Webhook payload must be a JSON object",
    );
  });

  it("throws for invalid JSON", () => {
    expect(() => parseWebhookJsonObject("not valid json")).toThrow();
  });

  it("throws for empty string", () => {
    expect(() => parseWebhookJsonObject("")).toThrow();
  });
});

describe("parseWebhookTimestamp", () => {
  it("parses valid ISO timestamp", () => {
    const value = "2024-01-15T10:30:00Z";
    const result = parseWebhookTimestamp(value);
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2024-01-15T10:30:00.000Z");
  });

  it("parses timestamp with timezone offset", () => {
    const value = "2024-01-15T10:30:00+05:00";
    const result = parseWebhookTimestamp(value);
    expect(result).toBeInstanceOf(Date);
  });

  it("returns undefined for non-string values", () => {
    expect(parseWebhookTimestamp(null)).toBeUndefined();
    expect(parseWebhookTimestamp(undefined)).toBeUndefined();
    expect(parseWebhookTimestamp(123456789)).toBeUndefined();
    expect(parseWebhookTimestamp({ date: "2024-01-15" })).toBeUndefined();
  });

  it("returns undefined for invalid date string", () => {
    expect(parseWebhookTimestamp("not a date")).toBeUndefined();
    expect(parseWebhookTimestamp("")).toBeUndefined();
  });
});

describe("parseWebhookBranchRef", () => {
  it("strips refs/heads/ prefix and returns branch name", () => {
    expect(parseWebhookBranchRef("refs/heads/main")).toBe("main");
    expect(parseWebhookBranchRef("refs/heads/feature/new-feature")).toBe(
      "feature/new-feature",
    );
  });

  it("returns ref as-is when not prefixed with refs/", () => {
    expect(parseWebhookBranchRef("main")).toBe("main");
    expect(parseWebhookBranchRef("feature/test")).toBe("feature/test");
  });

  it("returns undefined for refs/ prefix without heads/", () => {
    expect(parseWebhookBranchRef("refs/tags/v1.0.0")).toBeUndefined();
    expect(parseWebhookBranchRef("refs/pull/123/head")).toBeUndefined();
  });

  it("returns undefined for non-string values", () => {
    expect(parseWebhookBranchRef(null)).toBeUndefined();
    expect(parseWebhookBranchRef(undefined)).toBeUndefined();
    expect(parseWebhookBranchRef(123)).toBeUndefined();
    expect(parseWebhookBranchRef({})).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseWebhookBranchRef("")).toBeUndefined();
  });
});
