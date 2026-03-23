/**
 * @title IPFS Service
 * @notice Uploads token images and metadata JSON to IPFS via the Pinata
 *         pinning API, and resolves ipfs:// URIs via the Pinata gateway.
 *
 * @dev
 *   - uploadMetadata()  pins an image file then pins a metadata JSON object,
 *     returning the metadata URI as `ipfs://<CID>`.
 *   - getMetadata()     fetches and parses a metadata JSON from an ipfs:// URI
 *     via the configured Pinata gateway.
 *
 * Security assumptions:
 *   - API credentials are never logged or exposed in error messages.
 *   - File size and MIME type are validated client-side before any network call.
 *   - All Pinata responses are validated for the expected `IpfsHash` field.
 */

import {
  getIpfsConfig,
  ConfigurationError,
  MAX_IMAGE_SIZE_BYTES,
  ACCEPTED_IMAGE_TYPES,
} from "../config/ipfs";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** NFT-style metadata object pinned to IPFS. */
export interface TokenMetadata {
  name: string;
  description: string;
  image: string; // ipfs://<CID>
}

/** Progress callback — receives a value between 0 and 1. */
export type UploadProgressCallback = (progress: number) => void;

/** Options for uploadMetadata. */
export interface UploadOptions {
  /** Called periodically during the image upload with progress 0–1. */
  onProgress?: UploadProgressCallback;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Base class for all IPFS service errors. */
export class IpfsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpfsError";
  }
}

/** Thrown when the image file fails validation. */
export class ValidationError extends IpfsError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Thrown when a Pinata API call fails. */
export class UploadError extends IpfsError {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/** Thrown when fetching / parsing metadata fails. */
export class FetchError extends IpfsError {
  constructor(message: string) {
    super(message);
    this.name = "FetchError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * @notice Validates image file size and MIME type.
 * @param  image  The File object to validate.
 * @throws ValidationError if the file is too large or has an unsupported type.
 */
function validateImage(image: File): void {
  if (!ACCEPTED_IMAGE_TYPES.includes(image.type)) {
    throw new ValidationError(
      `Unsupported file type "${image.type}". Accepted types: JPEG, PNG, GIF.`
    );
  }
  if (image.size > MAX_IMAGE_SIZE_BYTES) {
    const sizeMb = (image.size / (1024 * 1024)).toFixed(2);
    throw new ValidationError(
      `Image is ${sizeMb} MB. Maximum allowed size is 5 MB.`
    );
  }
}

/**
 * @notice Converts an ipfs:// URI to an HTTP gateway URL.
 * @param  uri      The ipfs:// URI to convert.
 * @param  gateway  The HTTP gateway base URL.
 */
function ipfsUriToGatewayUrl(uri: string, gateway: string): string {
  if (!uri.startsWith("ipfs://")) {
    throw new FetchError(`Invalid IPFS URI: "${uri}". Must start with ipfs://`);
  }
  const cid = uri.slice("ipfs://".length);
  return `${gateway.replace(/\/$/, "")}/${cid}`;
}

/**
 * @notice Pins a file to IPFS via Pinata's pinFileToIPFS endpoint.
 * @dev    Uses XMLHttpRequest to support upload progress tracking.
 * @param  image      The image File to upload.
 * @param  config     Pinata config (keys, URLs).
 * @param  onProgress Optional progress callback (0–1).
 * @returns           The IPFS CID of the pinned file.
 */
async function pinFileToPinata(
  image: File,
  config: ReturnType<typeof getIpfsConfig>,
  onProgress?: UploadProgressCallback
): Promise<string> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", image);

    const xhr = new XMLHttpRequest();

    // Progress tracking
    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded / event.total);
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        try {
          const data = JSON.parse(xhr.responseText) as { IpfsHash?: string };
          if (!data.IpfsHash) {
            reject(
              new UploadError(
                "Image upload succeeded but no CID was returned. Please try again."
              )
            );
            return;
          }
          onProgress?.(1);
          resolve(data.IpfsHash);
        } catch {
          reject(new UploadError("Unexpected response from image upload. Please try again."));
        }
      } else if (xhr.status === 401) {
        reject(
          new UploadError(
            "Authentication failed. Check that VITE_IPFS_API_KEY and VITE_IPFS_API_SECRET are correct."
          )
        );
      } else if (xhr.status === 413) {
        reject(new UploadError("Image is too large for the server. Maximum size is 5 MB."));
      } else {
        reject(
          new UploadError(
            `Image upload failed (HTTP ${xhr.status}). Please check your connection and try again.`
          )
        );
      }
    });

    xhr.addEventListener("error", () => {
      reject(
        new UploadError(
          "Network error during image upload. Please check your connection and try again."
        )
      );
    });

    xhr.addEventListener("timeout", () => {
      reject(new UploadError("Image upload timed out. Please try again."));
    });

    xhr.timeout = 60_000; // 60 s
    xhr.open("POST", config.pinFileUrl);
    xhr.setRequestHeader("pinata_api_key", config.apiKey);
    xhr.setRequestHeader("pinata_secret_api_key", config.apiSecret);
    xhr.send(formData);
  });
}

/**
 * @notice Pins a JSON object to IPFS via Pinata's pinJSONToIPFS endpoint.
 * @param  metadata  The metadata object to pin.
 * @param  config    Pinata config.
 * @returns          The IPFS CID of the pinned JSON.
 */
async function pinJsonToPinata(
  metadata: TokenMetadata,
  config: ReturnType<typeof getIpfsConfig>
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(config.pinJsonUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        pinata_api_key: config.apiKey,
        pinata_secret_api_key: config.apiSecret,
      },
      body: JSON.stringify({ pinataContent: metadata }),
    });
  } catch {
    throw new UploadError(
      "Network error during metadata upload. Please check your connection and try again."
    );
  }

  if (response.status === 401) {
    throw new UploadError(
      "Authentication failed. Check that VITE_IPFS_API_KEY and VITE_IPFS_API_SECRET are correct."
    );
  }
  if (!response.ok) {
    throw new UploadError(
      `Metadata upload failed (HTTP ${response.status}). Please try again.`
    );
  }

  let data: { IpfsHash?: string };
  try {
    data = (await response.json()) as { IpfsHash?: string };
  } catch {
    throw new UploadError("Unexpected response from metadata upload. Please try again.");
  }

  if (!data.IpfsHash) {
    throw new UploadError(
      "Metadata upload succeeded but no CID was returned. Please try again."
    );
  }

  return data.IpfsHash;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @notice Uploads an image and constructs + pins NFT metadata to IPFS.
 *
 * @param  image        JPEG/PNG/GIF file, ≤5 MB.
 * @param  description  Human-readable description for the token.
 * @param  tokenName    Display name for the token.
 * @param  options      Optional upload options (progress callback).
 * @returns             Metadata URI in `ipfs://<CID>` format.
 *
 * @throws ConfigurationError  if API keys are missing.
 * @throws ValidationError     if the image fails size/type checks.
 * @throws UploadError         if any Pinata API call fails.
 */
export async function uploadMetadata(
  image: File,
  description: string,
  tokenName: string,
  options: UploadOptions = {}
): Promise<string> {
  // 1. Validate credentials before touching the network
  const config = getIpfsConfig();

  // 2. Validate the image file
  validateImage(image);

  // 3. Upload image to Pinata
  const imageCid = await pinFileToPinata(image, config, options.onProgress);

  // 4. Build metadata object
  const metadata: TokenMetadata = {
    name: tokenName,
    description,
    image: `ipfs://${imageCid}`,
  };

  // 5. Pin metadata JSON
  const metadataCid = await pinJsonToPinata(metadata, config);

  return `ipfs://${metadataCid}`;
}

/**
 * @notice Fetches and parses token metadata from an ipfs:// URI via the
 *         configured Pinata gateway.
 *
 * @param  uri  The metadata URI in `ipfs://<CID>` format.
 * @returns     Parsed TokenMetadata object.
 *
 * @throws ConfigurationError  if API keys are missing (gateway still needs config).
 * @throws FetchError          if the URI is invalid or the fetch fails.
 */
export async function getMetadata(uri: string): Promise<TokenMetadata> {
  const config = getIpfsConfig();
  const url = ipfsUriToGatewayUrl(uri, config.gateway);

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new FetchError(
      "Network error while fetching metadata. Please check your connection and try again."
    );
  }

  if (!response.ok) {
    throw new FetchError(
      `Failed to fetch metadata (HTTP ${response.status}). The CID may not be pinned yet.`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new FetchError("Metadata response is not valid JSON.");
  }

  // Basic shape validation
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>).name !== "string" ||
    typeof (data as Record<string, unknown>).description !== "string" ||
    typeof (data as Record<string, unknown>).image !== "string"
  ) {
    throw new FetchError(
      "Metadata is missing required fields (name, description, image)."
    );
  }

  return data as TokenMetadata;
}
