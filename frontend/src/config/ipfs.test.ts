/**
 * @title IPFS Config Tests
 * @notice Unit tests for getIpfsConfig() — validates credential reading,
 *         ConfigurationError messages, and default gateway fallback.
 *
 * Security notes:
 *   - Tests confirm ConfigurationError is thrown (not a silent failure)
 *     when credentials are absent, preventing silent unauthenticated calls.
 */

import {
  getIpfsConfig,
  ConfigurationError,
  PINATA_PIN_FILE_URL,
  PINATA_PIN_JSON_URL,
  DEFAULT_GATEWAY,
  MAX_IMAGE_SIZE_BYTES,
  ACCEPTED_IMAGE_TYPES,
} from "./ipfs";

// Save and restore process.env around each test
const originalEnv = process.env;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    VITE_IPFS_API_KEY: "my-api-key",
    VITE_IPFS_API_SECRET: "my-api-secret",
  };
  delete process.env.VITE_IPFS_GATEWAY;
});

afterEach(() => {
  process.env = originalEnv;
});

describe("getIpfsConfig — happy path", () => {
  test("returns apiKey from process.env", () => {
    const config = getIpfsConfig();
    expect(config.apiKey).toBe("my-api-key");
  });

  test("returns apiSecret from process.env", () => {
    const config = getIpfsConfig();
    expect(config.apiSecret).toBe("my-api-secret");
  });

  test("returns default Pinata gateway when VITE_IPFS_GATEWAY is not set", () => {
    const config = getIpfsConfig();
    expect(config.gateway).toBe(DEFAULT_GATEWAY);
  });

  test("returns custom gateway when VITE_IPFS_GATEWAY is set", () => {
    process.env.VITE_IPFS_GATEWAY = "https://my-custom-gateway.io/ipfs";
    const config = getIpfsConfig();
    expect(config.gateway).toBe("https://my-custom-gateway.io/ipfs");
  });

  test("returns correct pinFileUrl", () => {
    const config = getIpfsConfig();
    expect(config.pinFileUrl).toBe(PINATA_PIN_FILE_URL);
  });

  test("returns correct pinJsonUrl", () => {
    const config = getIpfsConfig();
    expect(config.pinJsonUrl).toBe(PINATA_PIN_JSON_URL);
  });

  test("trims whitespace from apiKey", () => {
    process.env.VITE_IPFS_API_KEY = "  spaced-key  ";
    const config = getIpfsConfig();
    expect(config.apiKey).toBe("spaced-key");
  });

  test("trims whitespace from apiSecret", () => {
    process.env.VITE_IPFS_API_SECRET = "  spaced-secret  ";
    const config = getIpfsConfig();
    expect(config.apiSecret).toBe("spaced-secret");
  });
});

describe("getIpfsConfig — missing credentials", () => {
  test("throws ConfigurationError when VITE_IPFS_API_KEY is undefined", () => {
    delete process.env.VITE_IPFS_API_KEY;
    expect(() => getIpfsConfig()).toThrow(ConfigurationError);
  });

  test("throws ConfigurationError when VITE_IPFS_API_KEY is empty string", () => {
    process.env.VITE_IPFS_API_KEY = "";
    expect(() => getIpfsConfig()).toThrow(ConfigurationError);
  });

  test("throws ConfigurationError when VITE_IPFS_API_KEY is whitespace only", () => {
    process.env.VITE_IPFS_API_KEY = "   ";
    expect(() => getIpfsConfig()).toThrow(ConfigurationError);
  });

  test("error message mentions VITE_IPFS_API_KEY", () => {
    delete process.env.VITE_IPFS_API_KEY;
    expect(() => getIpfsConfig()).toThrow(/VITE_IPFS_API_KEY/);
  });

  test("throws ConfigurationError when VITE_IPFS_API_SECRET is undefined", () => {
    delete process.env.VITE_IPFS_API_SECRET;
    expect(() => getIpfsConfig()).toThrow(ConfigurationError);
  });

  test("throws ConfigurationError when VITE_IPFS_API_SECRET is empty string", () => {
    process.env.VITE_IPFS_API_SECRET = "";
    expect(() => getIpfsConfig()).toThrow(ConfigurationError);
  });

  test("error message mentions VITE_IPFS_API_SECRET", () => {
    delete process.env.VITE_IPFS_API_SECRET;
    expect(() => getIpfsConfig()).toThrow(/VITE_IPFS_API_SECRET/);
  });

  test("ConfigurationError has correct name property", () => {
    delete process.env.VITE_IPFS_API_KEY;
    try {
      getIpfsConfig();
    } catch (e) {
      expect((e as Error).name).toBe("ConfigurationError");
    }
  });
});

describe("module constants", () => {
  test("PINATA_PIN_FILE_URL points to pinFileToIPFS endpoint", () => {
    expect(PINATA_PIN_FILE_URL).toContain("pinFileToIPFS");
  });

  test("PINATA_PIN_JSON_URL points to pinJSONToIPFS endpoint", () => {
    expect(PINATA_PIN_JSON_URL).toContain("pinJSONToIPFS");
  });

  test("DEFAULT_GATEWAY is a valid HTTPS URL", () => {
    expect(DEFAULT_GATEWAY).toMatch(/^https:\/\//);
  });

  test("MAX_IMAGE_SIZE_BYTES is 5 MB", () => {
    expect(MAX_IMAGE_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  test("ACCEPTED_IMAGE_TYPES includes image/jpeg", () => {
    expect(ACCEPTED_IMAGE_TYPES).toContain("image/jpeg");
  });

  test("ACCEPTED_IMAGE_TYPES includes image/png", () => {
    expect(ACCEPTED_IMAGE_TYPES).toContain("image/png");
  });

  test("ACCEPTED_IMAGE_TYPES includes image/gif", () => {
    expect(ACCEPTED_IMAGE_TYPES).toContain("image/gif");
  });
});
