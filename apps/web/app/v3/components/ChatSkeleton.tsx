'use client';

// Skeleton loading component for chat
export function ChatSkeleton() {
  return (
    <div className="flex-1 overflow-hidden p-4 animate-pulse">
      {/* Fake messages */}
      <div className="space-y-4">
        {/* User message */}
        <div className="flex justify-end">
          <div className="bg-gray-700 rounded-lg p-3 max-w-[70%]">
            <div className="h-4 bg-gray-600 rounded w-48 mb-2"></div>
            <div className="h-3 bg-gray-600/50 rounded w-16"></div>
          </div>
        </div>
        
        {/* Assistant message */}
        <div className="flex justify-start">
          <div className="bg-gray-800 rounded-lg p-3 max-w-[70%]">
            <div className="h-4 bg-gray-700 rounded w-64 mb-2"></div>
            <div className="h-4 bg-gray-700 rounded w-56 mb-2"></div>
            <div className="h-4 bg-gray-700 rounded w-40 mb-2"></div>
            <div className="h-3 bg-gray-700/50 rounded w-16"></div>
          </div>
        </div>
        
        {/* User message */}
        <div className="flex justify-end">
          <div className="bg-gray-700 rounded-lg p-3 max-w-[70%]">
            <div className="h-4 bg-gray-600 rounded w-32 mb-2"></div>
            <div className="h-3 bg-gray-600/50 rounded w-16"></div>
          </div>
        </div>
        
        {/* Assistant message */}
        <div className="flex justify-start">
          <div className="bg-gray-800 rounded-lg p-3 max-w-[70%]">
            <div className="h-4 bg-gray-700 rounded w-72 mb-2"></div>
            <div className="h-4 bg-gray-700 rounded w-48 mb-2"></div>
            <div className="h-3 bg-gray-700/50 rounded w-16"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Skeleton for sidebar channels
export function ChannelsSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-gray-700/30">
          <div className="h-4 bg-gray-600 rounded w-24"></div>
          <div className="h-4 bg-gray-600 rounded w-4"></div>
        </div>
      ))}
    </div>
  );
}
