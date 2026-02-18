import { z } from "zod";

const ERROR_CODE_REGEX = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

export const ValidationDetailSchema = z
  .object({
    path: z.string(),
    expected: z.string(),
    received: z.string(),
  })
  .strict();

export const ErrorDetailSchema = z
  .object({
    code: z
      .string()
      .regex(ERROR_CODE_REGEX, "code must be uppercase snake_case"),
    message: z.string(),
    details: z.array(ValidationDetailSchema).optional(),
  })
  .strict();

export type ValidationDetail = z.infer<typeof ValidationDetailSchema>;
export type MrpError = z.infer<typeof ErrorDetailSchema>;

function pathToDotted(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "(root)";
  }

  return path.map((segment) => String(segment)).join(".");
}

function stringifyIssueValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function issueExpected(issue: z.ZodIssue): string {
  const maybeExpected = (issue as z.ZodIssue & { expected?: unknown }).expected;
  if (maybeExpected !== undefined) {
    return stringifyIssueValue(maybeExpected);
  }

  return issue.message || "valid value";
}

function issueReceived(issue: z.ZodIssue): string {
  const maybeReceived = (issue as z.ZodIssue & { received?: unknown }).received;
  if (maybeReceived !== undefined) {
    return stringifyIssueValue(maybeReceived);
  }

  const maybeInput = (issue as z.ZodIssue & { input?: unknown }).input;
  if (maybeInput !== undefined) {
    return stringifyIssueValue(maybeInput);
  }

  return "unknown";
}

export function zodErrorToDetails(zodError: z.ZodError): ValidationDetail[] {
  return zodError.issues.map((issue) => ({
    path: pathToDotted(issue.path),
    expected: issueExpected(issue),
    received: issueReceived(issue),
  }));
}
