'use client';

export function PreviewBanner() {
  // Read from window.location or a data attribute set by the server
  const isDev = typeof window !== 'undefined' && window.location.hostname.includes('preview');

  if (!isDev) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-black text-center py-2 px-4">
      <p className="text-sm font-semibold">
        🔍 Preview Deployment
      </p>
      <p className="text-xs mt-1 opacity-90">
        This is a preview deployment. Changes here are temporary and will be cleaned up when the PR is closed.
      </p>
    </div>
  );
}
