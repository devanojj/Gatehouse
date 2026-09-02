import "server-only";

import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Where attachment bytes live.
 *
 * Two backends, one seam — the same shape as `email.ts`. With the S3 variables
 * set, objects go to any S3-compatible bucket (AWS, R2, MinIO, Spaces) over
 * signed HTTPS. Without them, they go to a directory on disk, which is what
 * makes attachments work in local development with no credentials at all.
 *
 * A serverless deployment has no durable disk, so the local backend is refused
 * in production: better a loud misconfiguration than files that vanish.
 */

/** Keys are generated here, never supplied by a request. */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;

export type StorageBackend = "s3" | "local";

type S3Config = {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

function s3Config(): S3Config | null {
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;

  const region = process.env.S3_REGION?.trim() || "us-east-1";
  const endpoint = (
    process.env.S3_ENDPOINT?.trim() || `https://s3.${region}.amazonaws.com`
  ).replace(/\/$/, "");

  return {
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    // Anything that is not AWS itself — R2, MinIO, a local gateway — generally
    // wants the bucket in the path rather than in the hostname.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.trim() === "true",
  };
}

export function storageBackend(): StorageBackend {
  return s3Config() ? "s3" : "local";
}

/** For the settings page: what an operator needs to know, never a credential. */
export function describeStorage(): string {
  const config = s3Config();
  if (config) {
    return `S3-compatible bucket "${config.bucket}" in ${config.region}`;
  }
  return `local directory ${localRoot()}`;
}

/**
 * The development directory. The `turbopackIgnore` comments keep the bundler
 * from concluding that a configurable path means the whole project has to be
 * traced into the deployment — these calls only ever run on the local backend.
 */
function localRoot(): string {
  return resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    process.env.ATTACHMENTS_DIR?.trim() || ".gatehouse-uploads",
  );
}

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes("..")) {
    throw new Error("Refusing to use a storage key that was not generated here.");
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  assertKey(key);

  const config = s3Config();
  if (config) {
    await s3Request(config, "PUT", key, body, contentType);
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Attachment storage is not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.",
    );
  }

  const path = join(/*turbopackIgnore: true*/ localRoot(), key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

/** Null when the object is gone — a row can outlive its bytes. */
export async function getObject(key: string): Promise<Buffer | null> {
  assertKey(key);

  const config = s3Config();
  if (config) {
    const response = await s3Request(config, "GET", key);
    if (response.status === 404) return null;
    return Buffer.from(await response.arrayBuffer());
  }

  try {
    return await readFile(join(/*turbopackIgnore: true*/ localRoot(), key));
  } catch {
    return null;
  }
}

// --------------------------------------------------------- S3 request signing

/**
 * Signature Version 4, by hand.
 *
 * The AWS SDK is a large dependency for two verbs, and Gatehouse already talks
 * to Resend with `fetch`. Only PUT and GET of a single object are needed, so
 * the canonical request has no query string to sort.
 */
async function s3Request(
  config: S3Config,
  method: "PUT" | "GET",
  key: string,
  body?: Buffer,
  contentType?: string,
): Promise<Response> {
  const endpoint = new URL(config.endpoint);
  const encodedKey = key.split("/").map(encodeRfc3986).join("/");

  const host = config.forcePathStyle
    ? endpoint.host
    : `${config.bucket}.${endpoint.host}`;
  const path = config.forcePathStyle
    ? `${endpoint.pathname.replace(/\/$/, "")}/${config.bucket}/${encodedKey}`
    : `${endpoint.pathname.replace(/\/$/, "")}/${encodedKey}`;

  const payloadHash = createHash("sha256")
    .update(body ?? Buffer.alloc(0))
    .digest("hex");

  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders
    .map((name) => `${name}:${headers[name].trim()}\n`)
    .join("");
  const signedHeaderList = signedHeaders.join(";");

  const canonicalRequest = [
    method,
    path,
    "",
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  let signingKey = createHmac("sha256", `AWS4${config.secretAccessKey}`)
    .update(dateStamp)
    .digest();
  for (const part of [config.region, "s3", "aws4_request"]) {
    signingKey = createHmac("sha256", signingKey).update(part).digest();
  }
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const response = await fetch(`${endpoint.protocol}//${host}${path}`, {
    method,
    headers: {
      ...headers,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaderList}, Signature=${signature}`,
    },
    body: body ? new Uint8Array(body) : undefined,
  });

  if (!response.ok && !(method === "GET" && response.status === 404)) {
    // The body of an S3 error is XML describing the request, not a secret.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Object storage rejected the ${method} (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  return response;
}

/** `encodeURIComponent`, plus the four characters AWS wants escaped too. */
function encodeRfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
