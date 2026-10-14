export class ToolError extends Error {
  constructor(message: string, public details: Record<string, unknown> = {}) { super(message); }
}
export class ApiError extends ToolError {
  constructor(public status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `Modisign returned HTTP ${status}.`, body);
  }
}
export class OfflineError extends ToolError {
  constructor() { super("Cannot reach Modisign. Check your connection and MODISIGN_URL."); }
}
export function denied(reason: string) {
  if (reason === "sign_in") return new ToolError("Sign in with the login tool or run npx -y @modisign/mcp login, then retry.", { reason, login_command: "npx -y @modisign/mcp login" });
  if (reason === "pro") return new ToolError("This overlay configuration needs Pro. Upgrade at https://modisign.app/pricing, then retry.", { reason, upgrade_url: "https://modisign.app/pricing" });
  return new ToolError("Modisign did not authorize this render.", { reason });
}
export function errorResult(error: unknown): Record<string, unknown> {
  if (error instanceof ToolError) return { error: error.message, ...error.details };
  return { error: "Local operation failed. Run modisign-mcp doctor and retry." };
}
export function isMissing(error: unknown) { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
