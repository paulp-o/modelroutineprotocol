import { initStore } from "../core/store.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";

export async function handleInit(
  _args: string[],
  _flags: Record<string, unknown>,
): Promise<Envelope> {
  try {
    const result = await initStore(process.cwd());

    return okEnvelope("init", {
      store_path: result.storePath,
      config_path: result.configPath,
      detected_hosts: result.detectedHosts,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code?: string }).code);
      if (code === "STORE_ALREADY_EXISTS") {
        const path = String((error as { message?: string }).message ?? "").replace(
          /^Store already exists at\s*/,
          "",
        );

        return errEnvelope("init", "STORE_ALREADY_EXISTS", `Store already exists at ${path}`);
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("init", "INTERNAL_ERROR", message);
  }
}
