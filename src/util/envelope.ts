import YAML from "yaml";

export type ErrorDetail = {
  path: string;
  expected: string;
  received: string;
};

export type EnvelopeSuccess = {
  ok: true;
  command: string;
  ts: string;
  data: Record<string, unknown>;
};

export type EnvelopeError = {
  ok: false;
  command: string;
  ts: string;
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
};

export type Envelope = EnvelopeSuccess | EnvelopeError;

const INTERNAL_ERROR_CODES = new Set([
  "INTERNAL_ERROR",
  "UNHANDLED_ERROR",
]);

export function okEnvelope(command: string, data: Record<string, unknown>): EnvelopeSuccess {
  return {
    ok: true,
    command,
    ts: new Date().toISOString(),
    data,
  };
}

export function errEnvelope(
  command: string,
  code: string,
  message: string,
  details?: ErrorDetail[],
): EnvelopeError {
  return {
    ok: false,
    command,
    ts: new Date().toISOString(),
    error: {
      code,
      message,
      ...(details && details.length > 0 ? { details } : {}),
    },
  };
}

export function printEnvelope(envelope: Envelope): void {
  const text = YAML.stringify(envelope);
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

export function exitCodeFor(envelope: Envelope): 0 | 1 | 2 {
  if (envelope.ok) {
    return 0;
  }

  if (INTERNAL_ERROR_CODES.has(envelope.error.code)) {
    return 2;
  }

  return 1;
}
