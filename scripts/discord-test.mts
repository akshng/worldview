/** Send a test message to the configured Discord webhook: npm run discord:test */
import { existsSync } from "node:fs";
for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const { sendDiscord, discordWebhook } = await import("../src/lib/notify/discord");
if (!discordWebhook()) {
  console.error("DISCORD_WEBHOOK_URL is missing or not a Discord webhook URL (add it to .env.local).");
  process.exit(1);
}
await sendDiscord("**[WorldView]** Connected — WorldView updates will arrive here.", [
  { title: "Connected", description: "Daily morning briefing (7:30) and other WorldView updates will be posted to this channel as **WorldView**." },
]);
console.log("Sent.");
