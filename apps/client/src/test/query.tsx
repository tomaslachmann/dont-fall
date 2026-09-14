import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createApiQueryClient } from "../lib/api/query.js";

/**
 * Test-only: wraps UI in a fresh QueryClient. Every Screen/hook that reads
 * through React Query needs a provider above it, and sharing one client
 * across tests would leak cache between them — so each mount gets its own.
 */
export const WithQuery = ({ children }: { children: ReactNode }) => {
  const [client] = useState(createApiQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
