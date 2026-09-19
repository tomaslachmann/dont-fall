import type { FastifyInstance } from "fastify";
import { getGameSettings, type SettingsDeps } from "./settings.service.js";

/**
 * Game-settings route — thin by contract: parse nothing, delegate to the
 * service, send the payload. The values themselves live where they belong
 * (`maxPlayers` in config, `onlinePlayers` in friends presence), never here.
 */
export const registerSettingsRoutes = (app: FastifyInstance, deps: SettingsDeps): void => {
  app.get("/game-settings", async () => getGameSettings(deps));
};
