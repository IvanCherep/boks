const defaultMaximumBodyBytes = 256 * 1024;

export class HttpRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
  }
}

/** Read a JSON object without letting a chunked request bypass the body limit. */
export async function readBoundedJsonObject(
  request: Request,
  maximumBytes = defaultMaximumBodyBytes
): Promise<Record<string, unknown>> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const bytes = Number(declaredLength);
    if (!Number.isFinite(bytes) || bytes < 0) {
      throw new HttpRequestError("Invalid Content-Length header.", 400);
    }
    if (bytes > maximumBytes) {
      throw new HttpRequestError("Request body is too large.", 413);
    }
  }

  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new HttpRequestError("Request body is too large.", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpRequestError("Request body must be valid JSON.", 400);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpRequestError("Request body must be a JSON object.", 400);
  }
  return parsed as Record<string, unknown>;
}

export function publicRequestError(error: unknown, fallback: string) {
  if (error instanceof HttpRequestError) {
    return { message: error.message, status: error.status };
  }
  return { message: fallback, status: 500 };
}
