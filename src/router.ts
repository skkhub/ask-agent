import type { Config } from "./config.ts";
import type { Provider, Effort } from "./providers.ts";
import { msg } from "./i18n.ts";

export interface RouteDecision {
  profile: string;
  effort: Effort;
}

export async function route(
  userText: string,
  config: Config,
  routerProvider: Provider,
): Promise<RouteDecision> {
  const keys = Object.keys(config.profiles);
  const menu = keys.map((k) => `- ${k}: ${config.profiles[k].description}`).join("\n");
  const fallback: RouteDecision = { profile: config.router, effort: "off" };
  const prompt = msg().routerPrompt(keys, menu, userText);

  try {
    const res = await routerProvider.chat([{ role: "user", content: prompt }], [], "off");
    const text = res.content ?? "";
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    const parsed = json ? JSON.parse(json) : {};

    const profile = keys.find((k) => k === parsed.profile) ?? config.router;
    const effort: Effort = ["off", "low", "high"].includes(parsed.effort)
      ? parsed.effort
      : "off";
    return { profile, effort };
  } catch {
    return fallback;
  }
}
