import type { IncomingMessage, ServerResponse } from "node:http";

export const LOCAL_BIND_HOST = "127.0.0.1";
export const MAX_JSON_BODY_BYTES = 8 * 1024;

export class RequestBodyParseError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "RequestBodyParseError";
  }
}

function getContentType(request: IncomingMessage): string | null {
  const rawHeader = request.headers["content-type"];
  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  return header?.split(";")[0]?.trim().toLowerCase() ?? null;
}

function getContentLength(request: IncomingMessage): number | null {
  const rawHeader = request.headers["content-length"];
  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!header) {
    return null;
  }

  const parsed = Number(header);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<Record<string, unknown>> {
  if (getContentType(request) !== "application/json") {
    throw new RequestBodyParseError(415, "Content-Type must be application/json.");
  }

  const declaredLength = getContentLength(request);
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new RequestBodyParseError(413, `Request body too large. Max ${maxBytes} bytes.`);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new RequestBodyParseError(413, `Request body too large. Max ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new RequestBodyParseError(400, "Invalid JSON body.");
  }
}
