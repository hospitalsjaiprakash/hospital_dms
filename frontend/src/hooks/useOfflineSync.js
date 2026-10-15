import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import api, { documentApi } from '../services/api';
import * as offlineQueue from '../services/offlineQueue';
import * as actionQueue from '../services/actionQueue';

/**
 * useOfflineSync
 * --------------
 * Global hook that:
 *  - Tracks online/offline status
 *  - Keeps a live count of queued uploads
 *  - Automatically syncs pending items when the device comes back online
 *  - Exposes manual retry for failed items
 *
 * Mount this ONCE at the app root level (inside AuthProvider so it always runs).
 *
 * Returns:
 *   { isOnline, queueCount, isSyncing, retryAll, refreshCount }
 */
export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);

  // ── Refresh badge count ───────────────────────────────────────────────────
  const refreshCount = useCallback(async () => {
    try {
      const docsCount = await offlineQueue.count();
      const actionsCount = await actionQueue.countActions();
      setQueueCount(docsCount + actionsCount);
    } catch {
      // IndexedDB might not be available in some edge cases — ignore
    }
  }, []);

  // ── Sync loop ─────────────────────────────────────────────────────────────
  const syncPending = useCallback(async () => {
    if (isSyncingRef.current) return;
    if (!navigator.onLine) return;

    // Reset any stuck 'syncing' items from a previous crashed session
    await offlineQueue.resetSyncing();
    await actionQueue.resetSyncingActions();

    const pendingDocs = await offlineQueue.getPending();
    const pendingActions = await actionQueue.getPendingActions();
    
    const totalPending = pendingDocs.length + pendingActions.length;
    if (totalPending === 0) {
      await refreshCount();
      return;
    }

    isSyncingRef.current = true;
    setIsSyncing(true);

    const toastId = toast.loading(
      `Syncing ${totalPending} offline action${totalPending > 1 ? 's' : ''}...`,
      { duration: Infinity }
    );

    let successCount = 0;
    let failCount = 0;

    // 1. Process Actions (e.g. Discharge, Readmit) first
    for (const action of pendingActions) {
      if (!navigator.onLine) break;
      try {
        await actionQueue.updateActionStatus(action.id, 'syncing');
        
        // Execute the generic API request
        await api({
          url: action.url,
          method: action.method,
          data: action.data
        });
        
        await actionQueue.removeAction(action.id);
        successCount++;
      } catch (err) {
        console.error('[useOfflineSync] Failed to sync action:', action.id, err);
        await actionQueue.updateActionStatus(action.id, 'failed');
        failCount++;
      }
    }

    // 2. Process Documents next
    for (const item of pendingDocs) {
      if (!navigator.onLine) {
        // Network dropped mid-sync — stop and leave remaining as pending
        break;
      }
      try {
        await offlineQueue.updateStatus(item.id, 'syncing');

        const formData = new FormData();
        formData.append('file', item.fileBlob, item.fileName);
        formData.append('patient_id', item.patientId);
        formData.append('doc_type', item.docType);
        if (item.notes) formData.append('notes', item.notes);

        await documentApi.upload(formData);
        await offlineQueue.remove(item.id);
        successCount++;
      } catch (err) {
        console.error('[useOfflineSync] Failed to sync item:', item.id, err);
        await offlineQueue.updateStatus(item.id, 'failed');
        failCount++;
      }
    }

    toast.dismiss(toastId);

    if (successCount > 0) {
      toast.success(
        `✅ ${successCount} offline action${successCount > 1 ? 's' : ''} synced successfully!`,
        { duration: 5000 }
      );
      window.dispatchEvent(new CustomEvent('offline-sync-complete', { detail: { successCount } }));
    }
    if (failCount > 0) {
      toast.error(
        `⚠️ ${failCount} action${failCount > 1 ? 's' : ''} failed to sync. Tap "Retry" to try again.`,
        { duration: 8000 }
      );
    }

    isSyncingRef.current = false;
    setIsSyncing(false);
    await refreshCount();
  }, [refreshCount]);

  // ── Online/offline listeners ──────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncPending();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // On mount: reset stale syncing flags and show initial count
    offlineQueue.resetSyncing().then(() => refreshCount());

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncPending, refreshCount]);

  // ── Manual retry of failed items ──────────────────────────────────────────
  const retryAll = useCallback(async () => {
    await offlineQueue.retryFailed();
    await actionQueue.retryFailedActions();
    await refreshCount();
    syncPending();
  }, [syncPending, refreshCount]);

  return { isOnline, queueCount, isSyncing, retryAll, refreshCount };
}
