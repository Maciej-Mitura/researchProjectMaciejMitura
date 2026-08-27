import { getApiBaseUrl } from '@/features/analysis/api/config';

export type HealthCheckResult =
  | { reachable: true }
  | { reachable: false; message: string };

export async function checkAnalysisServer(): Promise<HealthCheckResult> {
  try {
    const baseUrl = getApiBaseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
      if (!response.ok) {
        return {
          reachable: false,
          message: `Server responded with HTTP ${response.status}.`,
        };
      }
      return { reachable: true };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { reachable: false, message: 'Health check timed out.' };
    }
    const message = error instanceof Error ? error.message : 'Health check failed.';
    return { reachable: false, message };
  }
}
