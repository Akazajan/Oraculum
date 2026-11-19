/**
 * A single-flight gate for form submissions.
 *
 * The point is that one user action produces at most one request: a second click
 * while the first request is in flight is ignored rather than queued, and the
 * gate reopens as soon as the task settles — including when it fails, so a
 * recoverable error leaves the control usable.
 */

export type SubmissionOutcome<T> =
  | { status: "completed"; value: T }
  | { status: "ignored" };

export interface SubmissionGate {
  isInFlight(): boolean;
  run<T>(task: () => Promise<T>): Promise<SubmissionOutcome<T>>;
}

export function createSubmissionGate(): SubmissionGate {
  let inFlight = false;

  return {
    isInFlight: () => inFlight,

    async run<T>(task: () => Promise<T>): Promise<SubmissionOutcome<T>> {
      if (inFlight) return { status: "ignored" };

      inFlight = true;
      try {
        return { status: "completed", value: await task() };
      } finally {
        inFlight = false;
      }
    },
  };
}

export type BookingSubmissionFieldName =
  | "workspaceId"
  | "planType"
  | "startDate"
  | "endDate"
  | "seatCount"
  | "notes";

export type BookingSubmissionFieldErrors = Partial<
  Record<BookingSubmissionFieldName, string>
>;

export interface BookingSubmissionErrorResult {
  fieldErrors: BookingSubmissionFieldErrors;
  formError: string | null;
}

function cleanMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const message = value.trim();
    return message || null;
  }
  if (Array.isArray(value)) {
    const messages = value
      .map(cleanMessage)
      .filter((message): message is string => message !== null);
    return messages.length > 0 ? messages.join(" ") : null;
  }
  return null;
}

function fieldNameFromKey(key: string): BookingSubmissionFieldName | null {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();

  if (normalized === "workspace" || normalized === "workspace_id") return "workspaceId";
  if (normalized === "plan" || normalized === "plan_type") return "planType";
  if (normalized === "start" || normalized === "start_date") return "startDate";
  if (normalized === "end" || normalized === "end_date") return "endDate";
  if (
    normalized === "seat" ||
    normalized === "seats" ||
    normalized === "seat_count"
  ) {
    return "seatCount";
  }
  if (normalized === "note" || normalized === "notes") return "notes";
  return null;
}

function fieldNameFromMessage(message: string): BookingSubmissionFieldName | null {
  const normalized = message.toLowerCase();
  if (/\b(workspace ?id|workspace_id|workspace)\b/.test(normalized)) {
    return "workspaceId";
  }
  if (/\b(plan ?type|plan_type|plan)\b/.test(normalized)) return "planType";
  if (/\b(start ?date|start_date)\b/.test(normalized)) return "startDate";
  if (/\b(end ?date|end_date)\b/.test(normalized)) return "endDate";
  if (/\b(seat ?count|seat_count|seats?\b)/.test(normalized)) {
    return "seatCount";
  }
  if (/\bnotes?\b/.test(normalized)) return "notes";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Converts transport errors from the booking API into field names used by the
 * form. Validation messages and capacity conflicts keep their server text.
 */
export function mapBookingSubmissionError(error: unknown): BookingSubmissionFieldErrors {
  const source = isRecord(error) ? error : {};
  const data = isRecord(source.data) ? source.data : null;
  const payload = isRecord(source.payload) ? source.payload : data;
  const fieldErrors: BookingSubmissionFieldErrors = {};

  const mappedContainers = [
    source.fieldErrors,
    source.fields,
    source.errors,
    data?.fieldErrors,
    data?.fields,
    data?.errors,
    payload?.fieldErrors,
    payload?.fields,
    payload?.errors,
  ];

  for (const container of mappedContainers) {
    if (isRecord(container)) {
      for (const [key, value] of Object.entries(container)) {
        const field = fieldNameFromKey(key);
        const message = cleanMessage(value);
        if (field && message) fieldErrors[field] = message;
      }
    }

    if (Array.isArray(container)) {
      for (const entry of container) {
        if (!isRecord(entry)) {
          const message = cleanMessage(entry);
          if (message) {
            const field = fieldNameFromMessage(message);
            if (field) fieldErrors[field] = message;
          }
          continue;
        }

        const field =
          fieldNameFromKey(typeof entry.field === "string" ? entry.field : "") ??
          fieldNameFromKey(typeof entry.name === "string" ? entry.name : "") ??
          fieldNameFromKey(typeof entry.key === "string" ? entry.key : "") ??
          fieldNameFromKey(typeof entry.property === "string" ? entry.property : "") ??
          fieldNameFromKey(typeof entry.path === "string" ? entry.path : "");
        const message = cleanMessage(entry.message ?? entry.error ?? entry.detail);
        if (field && message) fieldErrors[field] = message;
      }
    }
  }

  const rawMessage =
    cleanMessage(source.serverMessage) ??
    cleanMessage(payload?.message) ??
    cleanMessage(data?.message) ??
    cleanMessage(source.message);

  const validationMessages =
    (Array.isArray(payload?.message) && payload.message) ||
    (Array.isArray(data?.message) && data.message) ||
    (Array.isArray(source.errors) && source.errors) ||
    [];

  for (const value of validationMessages) {
    const message = cleanMessage(value);
    if (!message) continue;
    const field = fieldNameFromMessage(message);
    if (field) fieldErrors[field] = message;
  }

  if (rawMessage && Object.keys(fieldErrors).length === 0) {
    const field = fieldNameFromMessage(rawMessage);
    if (field) fieldErrors[field] = rawMessage;
  }

  const status =
    typeof source.status === "number"
      ? source.status
      : typeof payload?.status === "number"
        ? payload.status
        : typeof data?.status === "number"
          ? data.status
          : null;
  const code =
    typeof source.code === "string"
      ? source.code
      : typeof payload?.code === "string"
        ? payload.code
        : typeof data?.code === "string"
          ? data.code
          : null;

  if (
    rawMessage &&
    !fieldErrors.seatCount &&
    (status === 409 ||
      code?.toLowerCase().includes("avail") ||
      code?.toLowerCase().includes("conflict") ||
      /\b(available seats?|availability|seat|capacity|unavailable)\b/i.test(rawMessage))
  ) {
    fieldErrors.seatCount = rawMessage;
  }

  return fieldErrors;
}

export function mapServerBookingError(error: unknown): BookingSubmissionFieldErrors {
  return mapBookingSubmissionError(error);
}

export function mapBookingServerError(error: unknown): BookingSubmissionFieldErrors {
  return mapBookingSubmissionError(error);
}

export function mapBookingSubmissionErrors(error: unknown): BookingSubmissionFieldErrors {
  return mapBookingSubmissionError(error);
}

export function getBookingSubmissionError(
  error: unknown
): BookingSubmissionErrorResult {
  const source = isRecord(error) ? error : {};
  const data = isRecord(source.data) ? source.data : null;
  const payload = isRecord(source.payload) ? source.payload : data;
  const formError =
    cleanMessage(source.serverMessage) ??
    cleanMessage(payload?.message) ??
    cleanMessage(data?.message) ??
    cleanMessage(source.message);

  return {
    fieldErrors: mapBookingSubmissionError(error),
    formError,
  };
}
