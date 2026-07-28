export const LIVE_DATA_REFRESH_MS = 5_000;

export const liveDataQueryOptions = {
  refetchInterval: LIVE_DATA_REFRESH_MS,
  refetchOnMount: 'always' as const,
  refetchOnReconnect: true,
  refetchOnWindowFocus: true,
};
