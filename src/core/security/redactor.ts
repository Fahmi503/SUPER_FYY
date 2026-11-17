export class Redactor {
  private static readonly SENSITIVE_KEYS = new Set([
    "password",
    "password_hash",
    "token",
    "access_token",
    "secret",
    "api_key",
    "apikey",
    "salt",
    "private_key",
    "authorization",
    "cookie",
    "session_id"
  ]);

  /**
   * Recursively scrubs sensitive credentials from metadata objects before persistence.
   */
  static sanitize(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitize(item));
    }

    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (this.SENSITIVE_KEYS.has(lowerKey)) {
        clean[key] = "[REDACTED]";
      } else if (typeof value === "object") {
        clean[key] = this.sanitize(value);
      } else {
        clean[key] = value;
      }
    }
    return clean;
  }
}

export const sanitizeMetadata = (obj: any): any => Redactor.sanitize(obj);
