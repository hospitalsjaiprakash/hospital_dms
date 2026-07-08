import React from 'react';
import { WifiOff, Upload, RefreshCw, CheckCircle } from 'lucide-react';

/**
 * OfflineBanner
 * -------------
 * A fixed bottom-of-screen notification strip that shows:
 *  - Offline status with a red indicator
 *  - Pending upload count with a retry button
 *  - Animated sync spinner when actively syncing
 *
 * Props:
 *   isOnline    : bool
 *   queueCount  : number  — total pending + failed items
 *   isSyncing   : bool
 *   retryAll    : () => void
 */
export default function OfflineBanner({ isOnline, queueCount, isSyncing, retryAll }) {
  // Only render if offline OR there are queued items
  if (isOnline && queueCount === 0) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9998] flex flex-col"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Offline indicator — only when no network */}
      {!isOnline && (
        <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-between gap-3 text-sm shadow-lg">
          <div className="flex items-center gap-2 font-semibold">
            <WifiOff size={15} className="flex-shrink-0" />
            <span>No internet connection</span>
          </div>
          <span className="text-red-200 text-xs font-medium">
            GPS coordinates still captured
          </span>
        </div>
      )}

      {/* Queue status bar — only when there are items queued */}
      {queueCount > 0 && (
        <div
          className={`px-4 py-2.5 flex items-center justify-between gap-3 text-sm shadow-lg border-t ${
            isOnline
              ? 'bg-amber-500 border-amber-400 text-white'
              : 'bg-amber-600 border-amber-500 text-white'
          }`}
        >
          <div className="flex items-center gap-2 font-semibold min-w-0">
            {isSyncing ? (
              <RefreshCw size={15} className="flex-shrink-0 animate-spin" />
            ) : (
              <Upload size={15} className="flex-shrink-0" />
            )}
            <span className="truncate">
              {isSyncing
                ? 'Syncing uploads...'
                : `${queueCount} upload${queueCount !== 1 ? 's' : ''} pending`}
            </span>
          </div>

          {!isSyncing && isOnline && (
            <button
              onClick={retryAll}
              className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white font-bold text-xs px-3 py-1.5 rounded-full flex-shrink-0 transition-colors border border-white/30"
            >
              <RefreshCw size={11} />
              Retry Now
            </button>
          )}

          {!isSyncing && !isOnline && (
            <span className="text-amber-100 text-xs font-medium flex-shrink-0">
              Will sync on reconnect
            </span>
          )}

          {isSyncing && (
            <span className="text-amber-100 text-xs font-medium flex-shrink-0 flex items-center gap-1">
              <CheckCircle size={11} />
              Auto-syncing...
            </span>
          )}
        </div>
      )}
    </div>
  );
}
