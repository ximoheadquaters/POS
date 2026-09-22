export const LIVE_DATA_REFRESH_MS = 30_000;

export const liveDataQueryOptions = {
  refetchInterval: LIVE_DATA_REFRESH_MS,
  refetchOnMount: false,
  refetchOnReconnect: true,
  refetchOnWindowFocus: true,
};
