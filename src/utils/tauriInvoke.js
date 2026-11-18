import { invoke as nativeInvoke } from '@tauri-apps/api/core';
import { reportTauriFailure } from '@/services/runtimeLogs';

export async function invoke(command, args) {
  try {
    // 只传两个参数：调用方从未使用 options，多传会让测试里的调用参数对不上。
    return await nativeInvoke(command, args);
  } catch (error) {
    reportTauriFailure(command, error, args);
    throw error;
  }
}
