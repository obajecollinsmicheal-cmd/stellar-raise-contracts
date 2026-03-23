/**
 * @title IPFS / Pinata Configuration
 * @notice Reads Pinata API credentials from environment variables and
 *         exposes typed config used by the IPFS service.
 *
 * Required env vars (set in .env):
 *   VITE_IPFS_API_KEY     — Pinata API key
 *   VITE_IPFS_API_SECRET  — Pinata API secret
 *   VITE_IPFS_GATEWAY     — (optional) custom gateway, defaults to Pinata public gateway
 */

export interface IpfsConfig {
  apiKey: string;
  apiSecret: string;
  gateway: string;
  pinFileUrl: string;
  pinJsonUrl: string;
}

export const PINATA_PIN_FILE_URL =
  "https://api.pinata.cloud/pinning/pinFileToIPFS";
export const PINATA_PIN_JSON_URL =
  "https://api.pinata.cloud/pinning/pinJSONToIPFS";
export const DEFAULT_GATEWAY = "https://gateway.pinata.cloud/ipfs";

/** Maximum allowed image upload size: 5 MB */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/** Accepted image MIME types */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"];

/**
 * @notice Reads env vars from the runtime environment.
 * @dev    Uses process.env which works in both Vite (via define replacement)
 *         and Jest/Node. In Vite, VITE_* vars are injected into process.env
 *         at build time via the `define` config option or accessed via the
 *         global `__VITE_ENV__` shim. For browser builds, callers should
 *         ensure Vite's `envPrefix` includes VITE_.
 */
function readEnv(key: string): string | undefined {
  return (process.env as Record<string, string | undefined>)[key];
}

/**
 * @notice Reads and validates Pinata credentials from env.
 * @dev    Throws a descriptive ConfigurationError if keys are missing.
 */
export function getIpfsConfig(): IpfsConfig {
  const apiKey = readEnv("VITE_IPFS_API_KEY");
  const apiSecret = readEnv("VITE_IPFS_API_SECRET");

  if (!apiKey || apiKey.trim() === "") {
    throw new ConfigurationError(
      "VITE_IPFS_API_KEY is not set. Add it to your .env file before uploading."
    );
  }
  if (!apiSecret || apiSecret.trim() === "") {
    throw new ConfigurationError(
      "VITE_IPFS_API_SECRET is not set. Add it to your .env file before uploading."
    );
  }

  return {
    apiKey: apiKey.trim(),
    apiSecret: apiSecret.trim(),
    gateway: readEnv("VITE_IPFS_GATEWAY") ?? DEFAULT_GATEWAY,
    pinFileUrl: PINATA_PIN_FILE_URL,
    pinJsonUrl: PINATA_PIN_JSON_URL,
  };
}

/** Thrown when required environment variables are missing. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}
