'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSafeAuth } from '../../hooks/useSafeClerk';
import PageLayout from '../../components/PageLayout';

interface Task {
  id: string;
  agentId: string | null;
  agentName: string | null;
  channelKey: string;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  result: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-600/20 text-yellow-400',
  processing: 'bg-blue-600/20 text-blue-400',
  completed: 'bg-green-600/20 text-green-400',
  failed: 'bg-red-600/20 text-red-400',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '⏳',
  processing: '⚙️',
  completed: '✅',
  failed: '❌',
};

export default function QueuePage() {
  const { isSignedIn, isLoaded } = useSafeAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [summary, setSummary] = useState({ pending: 0, processing: 0, completed: 0, failed: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      loadTasks();
      // Poll every 10 seconds
      const interval = setInterval(loadTasks, 10000);
      return () => clearInterval(interval);
    } else {
      setIsLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  const loadTasks = async () => {
    try {
      const url = filter === 'all' 
        ? '/api/agents/queue?limit=100' 
        : `/api/agents/queue?status=${filter}&limit=100`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks);
        setSummary(data.summary);
      }
    } catch (e) {
      console.error('Failed to load tasks:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isSignedIn) loadTasks();
  }, [filter]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('fr-CH', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!isLoaded || isLoading) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-pulse">📋</div>
            <p className="text-gray-400">Loading queue...</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (!isSignedIn) {
    return (
      <PageLayout>
        <div className="bg-gray-800 rounded-xl p-8 text-center max-w-md mx-auto">
          <h1 className="text-2xl font-bold mb-4">🔐 Sign in required</h1>
          <Link href="/sign-in" className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
            Sign In
          </Link>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout maxWidth="4xl">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">📋 Task Queue</h1>
            <p className="text-gray-400 text-sm">Agent tasks and their status</p>
          </div>
          <Link
            href="/agents"
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            ← Back to Agents
          </Link>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 text-center">
            <p className="text-2xl font-bold text-yellow-400">{summary.pending}</p>
            <p className="text-xs text-gray-400">Pending</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 text-center">
            <p className="text-2xl font-bold text-blue-400">{summary.processing}</p>
            <p className="text-xs text-gray-400">Processing</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 text-center">
            <p className="text-2xl font-bold text-green-400">{summary.completed}</p>
            <p className="text-xs text-gray-400">Completed</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 text-center">
            <p className="text-2xl font-bold text-red-400">{summary.failed}</p>
            <p className="text-xs text-gray-400">Failed</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2">
          {['all', 'pending', 'processing', 'completed', 'failed'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-lg text-sm ${
                filter === s 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              {s === 'all' ? 'All' : STATUS_ICONS[s]} {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Tasks List */}
        {tasks.length === 0 ? (
          <div className="bg-gray-800 rounded-xl p-8 text-center border border-gray-700">
            <div className="text-4xl mb-4">📋</div>
            <h2 className="text-xl font-semibold mb-2">No tasks</h2>
            <p className="text-gray-400">Task queue is empty</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map(task => (
              <div key={task.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[task.status]}`}>
                        {STATUS_ICONS[task.status]} {task.status}
                      </span>
                      <span className="text-xs bg-purple-600/20 text-purple-400 px-2 py-0.5 rounded">
                        P{task.priority}
                      </span>
                      {task.agentName && (
                        <span className="text-xs bg-gray-700 px-2 py-0.5 rounded">
                          🤖 {task.agentName}
                        </span>
                      )}
                      <span className="text-xs text-gray-500">
                        #{task.channelKey}
                      </span>
                    </div>
                    <h3 className="font-medium mt-2">{task.title}</h3>
                    {task.description && (
                      <p className="text-sm text-gray-400 mt-1">{task.description}</p>
                    )}
                    {task.result && (
                      <p className={`text-sm mt-2 p-2 rounded ${
                        task.status === 'failed' ? 'bg-red-600/10 text-red-400' : 'bg-green-600/10 text-green-400'
                      }`}>
                        {task.result}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p>Created: {formatDate(task.createdAt)}</p>
                    {task.startedAt && <p>Started: {formatDate(task.startedAt)}</p>}
                    {task.completedAt && <p>Done: {formatDate(task.completedAt)}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
