import { invoke as nativeInvoke } from '@tauri-apps/api/core';
import { reportTauriFailure } from '@/services/runtimeLogs';

export async function invoke(command, args, options) {
  try {
    return await nativeInvoke(command, args, options);
  } catch (error) {
    reportTauriFailure(command, error);
    throw error;
  }
}
