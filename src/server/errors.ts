/** A user-facing error with plain English + Hindi text. */
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public messageHi?: string,
  ) {
    super(message);
  }
}

export const Errors = {
  notLoggedIn: () => new AppError("NOT_LOGGED_IN", 401, "Please log in again.", "कृपया फिर से लॉगिन करें।"),
  forbidden: () => new AppError("FORBIDDEN", 403, "You are not allowed to do this.", "आपको यह करने की अनुमति नहीं है।"),
  badInput: (msg = "Some values are missing or wrong.") =>
    new AppError("BAD_INPUT", 400, msg, "कुछ जानकारी गलत या अधूरी है।"),
  badOrigin: () => new AppError("BAD_ORIGIN", 403, "Request blocked (wrong origin).", "अनुरोध रोका गया।"),
  idempotencyMissing: () => new AppError("NO_IDEMPOTENCY_KEY", 400, "Missing entry key. Reload the page.", "पेज दोबारा खोलें।"),
  idempotencyConflict: () =>
    new AppError("IDEMPOTENCY_CONFLICT", 409, "This entry key was already used for different data. Reload the page.", "पेज दोबारा खोलें।"),
};

/** Maps database errors raised by our triggers / constraints to plain messages. */
export function fromDbError(e: unknown): AppError | null {
  const err = e as { code?: string; message?: string; constraint?: string };
  const msg = err?.message ?? "";
  if (msg.startsWith("DAY_LOCKED"))
    return new AppError("DAY_LOCKED", 409, "This day is locked. Ask the owner to make a correction.", "यह दिन बंद हो चुका है। मालिक से सुधार करवाएँ।");
  if (msg.startsWith("POSTING_RULE"))
    return new AppError("POSTING_RULE", 422, "This entry type cannot go to that account.", "यह प्रविष्टि इस खाते में नहीं जा सकती।");
  if (msg.startsWith("IMMUTABLE"))
    return new AppError("IMMUTABLE", 409, "Saved entries cannot be changed. Use a correction.", "सेव की गई प्रविष्टि बदली नहीं जा सकती।");
  if (msg.startsWith("UNBALANCED"))
    return new AppError("UNBALANCED", 500, "Internal posting error (unbalanced). Nothing was saved.", "कुछ भी सेव नहीं हुआ।");
  if (err?.code === "23505")
    return new AppError("DUPLICATE", 409, "This already exists.", "यह पहले से मौजूद है।");
  if (err?.code === "23514" || err?.code === "22003" || err?.code === "22P02")
    return new AppError("BAD_INPUT", 400, "A value is not allowed.", "कोई मान सही नहीं है।");
  return null;
}
