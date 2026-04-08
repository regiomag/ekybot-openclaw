export interface DeleteRoutineParams {
  routineId: string;
  openclawJobId?: string | null;
  userId?: string | null;
}

export interface DeleteRoutineResult {
  ok: boolean;
  error?: string;
}

export async function deleteRoutineWithSync({
  routineId,
  openclawJobId,
  userId,
}: DeleteRoutineParams): Promise<DeleteRoutineResult> {
  const headers: Record<string, string> = {};
  if (userId) {
    headers['x-user-id'] = userId;
  }

  if (openclawJobId) {
    try {
      await fetch(`/api/routines/sync-cron?jobId=${encodeURIComponent(openclawJobId)}`, {
        method: 'DELETE',
        headers,
      });
    } catch {
      // Best effort only: we still let the user remove the Ekybot routine.
    }
  }

  const deleteRes = await fetch(`/api/routines?id=${encodeURIComponent(routineId)}`, {
    method: 'DELETE',
    headers,
  });

  if (!deleteRes.ok) {
    const errorData = await deleteRes.json().catch(() => null);
    return {
      ok: false,
      error: errorData?.error || 'Failed to delete routine',
    };
  }

  return { ok: true };
}
