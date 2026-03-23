/**
 * Jest global setup — shims import.meta.env for Vite-style env vars.
 * This runs before each test file via jest.config.json `setupFiles`.
 */

// Provide a default env so tests that don't override still get a valid object
(globalThis as unknown as Record<string, unknown>)["__importMetaEnv__"] = {
  VITE_IPFS_API_KEY: "test-api-key",
  VITE_IPFS_API_SECRET: "test-api-secret",
  VITE_IPFS_GATEWAY: "https://gateway.pinata.cloud/ipfs",
};
