/**
 * @title IPFS Service Tests
 * @notice Comprehensive test suite for frontend/src/services/ipfs.ts
 *
 * Test output notes:
 *   - All Pinata HTTP calls are mocked (no real network traffic).
 *   - XHR is mocked to support progress tracking assertions.
 *   - The config module is mocked to control credential availability.
 *
 * Security notes:
 *   - API keys are never asserted in error message content.
 *   - HTTP 401 produces a user-friendly auth error, not a raw API response.
 *   - HTTP 413 produces a user-friendly size error.
 *   - Network errors surface a user-friendly message (not a raw stack trace).
 *   - ConfigurationError is thrown before any network call is attempted.
 */

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports
// ---------------------------------------------------------------------------

// Mock the config module so we can control credential availability per test
jest.mock("../config/ipfs", () => {
  const actual = jest.requireActual("../config/ipfs") as Record<string, unknown>;
  return {
    ...actual,
    getIpfsConfig: jest.fn(),
  };
});

import {
  uploadMetadata,
  getMetadata,
  IpfsError,
  ValidationError,
  UploadError,
  FetchError,
  TokenMetadata,
} from "./ipfs";
import {
  ConfigurationError,
  getIpfsConfig,
  PINATA_PIN_FILE_URL,
  PINATA_PIN_JSON_URL,
  DEFAULT_GATEWAY,
} from "../config/ipfs";

const mockGetIpfsConfig = getIpfsConfig as jest.MockedFunction<typeof getIpfsConfig>;

// ---------------------------------------------------------------------------
// Default valid config returned by the mock
// ---------------------------------------------------------------------------

const VALID_CONFIG = {
  apiKey: "test-api-key",
  apiSecret: "test-api-secret",
  gateway: DEFAULT_GATEWAY,
  pinFileUrl: PINATA_PIN_FILE_URL,
  pinJsonUrl: PINATA_PIN_JSON_URL,
};

// ---------------------------------------------------------------------------
// XHR mock
// ---------------------------------------------------------------------------

class MockXHR {
  upload = { addEventListener: jest.fn() };
  timeout = 0;
  status = 200;
  responseText = JSON.stringify({ IpfsHash: "QmImageCID123" });
  _listeners: Record<string, Array<(e?: unknown) => void>> = {};

  addEventListener(event: string, cb: (e?: unknown) => void) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
  }
  open = jest.fn();
  setRequestHeader = jest.fn();
  send = jest.fn().mockImplementation(() => {
    setTimeout(() => this._trigger("load"), 0);
  });

  _trigger(event: string, arg?: unknown) {
    (this._listeners[event] ?? []).forEach((cb) => cb(arg));
  }
}

let mockXhrInstance: MockXHR;
const MockXHRConstructor = jest.fn().mockImplementation(() => {
  mockXhrInstance = new MockXHR();
  return mockXhrInstance;
});
(globalThis as unknown as Record<string, unknown>).XMLHttpRequest = MockXHRConstructor;

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(
  name = "token.png",
  type = "image/png",
  sizeBytes = 1024
): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

const VALID_METADATA: TokenMetadata = {
  name: "CoolToken",
  description: "A cool token",
  image: "ipfs://QmImageCID",
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetIpfsConfig.mockReturnValue(VALID_CONFIG);
  MockXHRConstructor.mockClear();
  mockFetch.mockReset();
  // Default XHR: successful image upload
  MockXHRConstructor.mockImplementation(() => {
    mockXhrInstance = new MockXHR();
    return mockXhrInstance;
  });
});

// ---------------------------------------------------------------------------
// uploadMetadata — credential validation
// ---------------------------------------------------------------------------

describe("uploadMetadata — credential validation", () => {
  test("throws ConfigurationError when API key is missing", async () => {
    mockGetIpfsConfig.mockImplementation(() => {
      throw new ConfigurationError("VITE_IPFS_API_KEY is not set.");
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(
      ConfigurationError
    );
  });

  test("throws ConfigurationError when API secret is missing", async () => {
    mockGetIpfsConfig.mockImplementation(() => {
      throw new ConfigurationError("VITE_IPFS_API_SECRET is not set.");
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(
      ConfigurationError
    );
  });

  test("ConfigurationError message mentions the missing variable", async () => {
    mockGetIpfsConfig.mockImplementation(() => {
      throw new ConfigurationError("VITE_IPFS_API_KEY is not set. Add it to your .env file.");
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(
      /VITE_IPFS_API_KEY/
    );
  });

  test("ConfigurationError is thrown before any network call", async () => {
    mockGetIpfsConfig.mockImplementation(() => {
      throw new ConfigurationError("VITE_IPFS_API_KEY is not set.");
    });
    try { await uploadMetadata(makeFile(), "desc", "Token"); } catch { /* expected */ }
    expect(MockXHRConstructor).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// uploadMetadata — image validation
// ---------------------------------------------------------------------------

describe("uploadMetadata — image validation", () => {
  test("throws ValidationError for unsupported MIME type (webp)", async () => {
    await expect(
      uploadMetadata(makeFile("img.webp", "image/webp"), "desc", "Token")
    ).rejects.toThrow(ValidationError);
  });

  test("throws ValidationError for text/plain file", async () => {
    await expect(
      uploadMetadata(makeFile("file.txt", "text/plain"), "desc", "Token")
    ).rejects.toThrow(ValidationError);
  });

  test("throws ValidationError when image exceeds 5 MB", async () => {
    const bigFile = makeFile("big.png", "image/png", 5 * 1024 * 1024 + 1);
    await expect(
      uploadMetadata(bigFile, "desc", "Token")
    ).rejects.toThrow(ValidationError);
  });

  test("ValidationError message mentions file size in MB", async () => {
    const bigFile = makeFile("big.png", "image/png", 6 * 1024 * 1024);
    await expect(
      uploadMetadata(bigFile, "desc", "Token")
    ).rejects.toThrow(/MB/);
  });

  test("accepts JPEG files without ValidationError", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    await expect(
      uploadMetadata(makeFile("img.jpg", "image/jpeg"), "desc", "Token")
    ).resolves.toBe("ipfs://QmMeta");
  });

  test("accepts PNG files without ValidationError", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    await expect(
      uploadMetadata(makeFile("img.png", "image/png"), "desc", "Token")
    ).resolves.toBe("ipfs://QmMeta");
  });

  test("accepts GIF files without ValidationError", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    await expect(
      uploadMetadata(makeFile("anim.gif", "image/gif"), "desc", "Token")
    ).resolves.toBe("ipfs://QmMeta");
  });

  test("accepts image exactly at the 5 MB limit", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    const exactFile = makeFile("exact.png", "image/png", 5 * 1024 * 1024);
    await expect(
      uploadMetadata(exactFile, "desc", "Token")
    ).resolves.toBe("ipfs://QmMeta");
  });

  test("ValidationError is thrown before any XHR call", async () => {
    try {
      await uploadMetadata(makeFile("img.webp", "image/webp"), "desc", "Token");
    } catch { /* expected */ }
    expect(MockXHRConstructor).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// uploadMetadata — image upload (XHR / pinFileToIPFS)
// ---------------------------------------------------------------------------

describe("uploadMetadata — image upload", () => {
  test("returns metadata URI as ipfs://<CID> on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMetaCID456" }),
    });
    const uri = await uploadMetadata(makeFile(), "A token", "MyToken");
    expect(uri).toBe("ipfs://QmMetaCID456");
  });

  test("sends pinata_api_key header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    await uploadMetadata(makeFile(), "desc", "Token");
    expect(mockXhrInstance.setRequestHeader).toHaveBeenCalledWith(
      "pinata_api_key", "test-api-key"
    );
  });

  test("sends pinata_secret_api_key header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    await uploadMetadata(makeFile(), "desc", "Token");
    expect(mockXhrInstance.setRequestHeader).toHaveBeenCalledWith(
      "pinata_secret_api_key", "test-api-secret"
    );
  });

  test("throws UploadError on HTTP 401 from image upload", async () => {
    MockXHRConstructor.mockImplementationOnce(() => {
      mockXhrInstance = new MockXHR();
      mockXhrInstance.status = 401;
      return mockXhrInstance;
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });

  test("UploadError on 401 mentions authentication", async () => {
    MockXHRConstructor.mockImplementationOnce(() => {
      mockXhrInstance = new MockXHR();
      mockXhrInstance.status = 401;
      return mockXhrInstance;
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(
      /[Aa]uthentication/
    );
  });

  test("throws UploadError on HTTP 413 (server-side file too large)", async () => {
    MockXHRConstructor.mockImplementationOnce(() => {
      mockXhrInstance = new MockXHR();
      mockXhrInstance.status = 413;
      return mockXhrInstance;
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });

  test("throws UploadError on HTTP 500 from image upload", async () => {
    MockXHRConstructor.mockImplementationOnce(() => {
      mockXhrInstance = new MockXHR();
      mockXhrInstance.status = 500;
      return mockXhrInstance;
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });

  test("throws UploadError on XHR network error", async () => {
    MockXHRConstructor.mockImplementationOnce(() => {
      mockXhrInstance = new MockXHR();
      mockXhrInstance.send = jest.fn().mockImplementation(() => {
        setTimeout(() => mockXhrInstance._trigger("error"), 0);
      });
      return mockXhrInstance;
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });

  test("throws UploadError on XHR timeout", async () => {
    MockXHRConstructor.mockImplementationOnce(() => {
      mockXhrInstance = new MockXHR();
      mockXhrInstance.send = jest.fn().mockImplementation(() => {
        setTimeout(() => mockXhrInstance._trigger("timeout"), 0);
      });
      return mockXhrInstance;
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });

  test("throws UploadError when image upload response has no IpfsHash", async () => {
    MockXHRConstructor.mockImplementationOnce(() => {
      mockXhrInstance = new MockXHR();
      mockXhrInstance.responseText = JSON.stringify({ something: "else" });
      return mockXhrInstance;
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });

  test("throws UploadError when image upload response is malformed JSON", async () => {
    MockXHRConstructor.mockImplementationOnce(() => {
      mockXhrInstance = new MockXHR();
      mockXhrInstance.responseText = "not-json{{";
      return mockXhrInstance;
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });
});

// ---------------------------------------------------------------------------
// uploadMetadata — metadata JSON upload (fetch / pinJSONToIPFS)
// ---------------------------------------------------------------------------

describe("uploadMetadata — metadata JSON upload", () => {
  test("constructs metadata with correct name", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    await uploadMetadata(makeFile(), "My description", "CoolToken");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.pinataContent.name).toBe("CoolToken");
  });

  test("constructs metadata with correct description", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    await uploadMetadata(makeFile(), "My description", "CoolToken");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.pinataContent.description).toBe("My description");
  });

  test("constructs metadata with image as ipfs://<imageCID>", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    await uploadMetadata(makeFile(), "desc", "Token");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.pinataContent.image).toBe("ipfs://QmImageCID123");
  });

  test("throws UploadError on HTTP 401 from metadata upload", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });

  test("throws UploadError on HTTP 500 from metadata upload", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });

  test("throws UploadError when metadata response has no IpfsHash", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ something: "else" }),
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });

  test("throws UploadError on network error during metadata upload", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });

  test("throws UploadError when metadata response is not valid JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => { throw new SyntaxError("bad json"); },
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).rejects.toThrow(UploadError);
  });
});

// ---------------------------------------------------------------------------
// uploadMetadata — progress tracking
// ---------------------------------------------------------------------------

describe("uploadMetadata — progress tracking", () => {
  test("calls onProgress with 1 when image upload completes", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    const onProgress = jest.fn();
    await uploadMetadata(makeFile(), "desc", "Token", { onProgress });
    expect(onProgress).toHaveBeenCalledWith(1);
  });

  test("registers upload progress event listener when onProgress is provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    const onProgress = jest.fn();
    await uploadMetadata(makeFile(), "desc", "Token", { onProgress });
    expect(mockXhrInstance.upload.addEventListener).toHaveBeenCalledWith(
      "progress", expect.any(Function)
    );
  });

  test("does not throw when onProgress is not provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    await expect(uploadMetadata(makeFile(), "desc", "Token")).resolves.toBeDefined();
  });

  test("does not register progress listener when onProgress is omitted", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ IpfsHash: "QmMeta" }),
    });
    await uploadMetadata(makeFile(), "desc", "Token");
    expect(mockXhrInstance.upload.addEventListener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getMetadata
// ---------------------------------------------------------------------------

describe("getMetadata", () => {
  test("returns parsed metadata for a valid ipfs:// URI", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => VALID_METADATA,
    });
    const result = await getMetadata("ipfs://QmMetaCID");
    expect(result).toEqual(VALID_METADATA);
  });

  test("resolves URI via the configured Pinata gateway", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => VALID_METADATA,
    });
    await getMetadata("ipfs://QmMetaCID");
    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_GATEWAY}/QmMetaCID`
    );
  });

  test("throws FetchError for a non-ipfs:// URI (https://)", async () => {
    await expect(getMetadata("https://example.com/meta.json")).rejects.toThrow(FetchError);
  });

  test("throws FetchError for an empty URI", async () => {
    await expect(getMetadata("")).rejects.toThrow(FetchError);
  });

  test("throws FetchError on HTTP 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(getMetadata("ipfs://QmMissing")).rejects.toThrow(FetchError);
  });

  test("throws FetchError on HTTP 500", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(getMetadata("ipfs://QmMeta")).rejects.toThrow(FetchError);
  });

  test("throws FetchError on network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(getMetadata("ipfs://QmMeta")).rejects.toThrow(FetchError);
  });

  test("throws FetchError when response is not valid JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => { throw new SyntaxError("bad json"); },
    });
    await expect(getMetadata("ipfs://QmMeta")).rejects.toThrow(FetchError);
  });

  test("throws FetchError when metadata is missing 'name'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ description: "d", image: "ipfs://x" }),
    });
    await expect(getMetadata("ipfs://QmMeta")).rejects.toThrow(FetchError);
  });

  test("throws FetchError when metadata is missing 'description'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ name: "n", image: "ipfs://x" }),
    });
    await expect(getMetadata("ipfs://QmMeta")).rejects.toThrow(FetchError);
  });

  test("throws FetchError when metadata is missing 'image'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ name: "n", description: "d" }),
    });
    await expect(getMetadata("ipfs://QmMeta")).rejects.toThrow(FetchError);
  });

  test("throws FetchError when metadata response is null", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => null,
    });
    await expect(getMetadata("ipfs://QmMeta")).rejects.toThrow(FetchError);
  });

  test("throws ConfigurationError when API keys are missing", async () => {
    mockGetIpfsConfig.mockImplementation(() => {
      throw new ConfigurationError("VITE_IPFS_API_KEY is not set.");
    });
    await expect(getMetadata("ipfs://QmMeta")).rejects.toThrow(ConfigurationError);
  });
});

// ---------------------------------------------------------------------------
// Error type hierarchy
// ---------------------------------------------------------------------------

describe("error type hierarchy", () => {
  test("ValidationError extends IpfsError", () => {
    expect(new ValidationError("x")).toBeInstanceOf(IpfsError);
  });
  test("UploadError extends IpfsError", () => {
    expect(new UploadError("x")).toBeInstanceOf(IpfsError);
  });
  test("FetchError extends IpfsError", () => {
    expect(new FetchError("x")).toBeInstanceOf(IpfsError);
  });
  test("ConfigurationError has correct name", () => {
    expect(new ConfigurationError("x").name).toBe("ConfigurationError");
  });
  test("ValidationError has correct name", () => {
    expect(new ValidationError("x").name).toBe("ValidationError");
  });
  test("UploadError has correct name", () => {
    expect(new UploadError("x").name).toBe("UploadError");
  });
  test("FetchError has correct name", () => {
    expect(new FetchError("x").name).toBe("FetchError");
  });
});
