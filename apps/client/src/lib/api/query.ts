import { QueryClient } from "@tanstack/react-query";

/**
 * The app's React Query client factory — one shared instance in `main.tsx`,
 * a fresh one per test (`src/test/query.tsx`). All API reads (`useAccount`,
 * `useGameSettings`, the Lobby's Track list) go through it instead of their
 * own `useEffect` fetches, so they share one cache and nobody hand-rolls
 * loading state or a context again.
 *
 * The defaults preserve this app's existing fetch behaviour: no blind
 * retries (a 401/404 is an answer, not a reason to hammer the API three
 * times) and no refetch on window focus (menu data refreshes on mount while
 * stale, never on a timer — the lobby tick lesson, ADR 0056's spirit).
 */
export const createApiQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
