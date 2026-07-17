type NestedApiError = {
  code?: string;
  message?: string;
};

export type CliApiErrorBody = {
  code?: string;
  message?: string | string[] | NestedApiError;
  statusCode?: number;
};

export function parseCliApiErrorBody(body: unknown): {
  code?: string;
  message?: string;
} {
  if (!body || typeof body !== "object") {
    return {};
  }

  const parsed = body as CliApiErrorBody;

  if (typeof parsed.message === "string") {
    return { code: parsed.code, message: parsed.message };
  }

  if (Array.isArray(parsed.message)) {
    return { code: parsed.code, message: parsed.message.join(", ") };
  }

  if (parsed.message && typeof parsed.message === "object") {
    const nested = parsed.message;
    return {
      code: nested.code ?? parsed.code,
      message:
        typeof nested.message === "string" ? nested.message : undefined,
    };
  }

  return { code: parsed.code };
}

export function readCliApiErrorMessage(
  body: unknown,
  fallback: string,
): { code?: string; message: string } {
  const parsed = parseCliApiErrorBody(body);
  return {
    code: parsed.code,
    message: parsed.message ?? fallback,
  };
}
