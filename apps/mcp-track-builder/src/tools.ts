import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

/**
 * Registers one JSON tool: params validated by the SDK against the zod
 * shape, the handler's return serialized as the text payload. Handler
 * failures arrive as tool errors (`isError` with `{ error }` JSON — the
 * API's own message when the API refused) — never protocol errors, so the
 * LLM reads what went wrong and continues the session. Every text payload
 * this registers parses as JSON, success or failure.
 */
export const jsonTool = <Shape extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  shape: Shape,
  handler: (params: z.infer<z.ZodObject<Shape>>) => Promise<unknown>,
): void => {
  server.tool(name, description, shape, async (params) => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(await handler(params), null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
        isError: true,
      };
    }
  });
};

/** A page over `items` — every listing tool answers this shape. */
export const page = <T>(items: readonly T[], offset: number, limit: number): { items: T[]; total: number; offset: number; limit: number } => ({
  items: items.slice(offset, offset + limit),
  total: items.length,
  offset,
  limit,
});
