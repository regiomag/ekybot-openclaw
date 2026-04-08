type MessageStreamPayload = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

type MessageStreamListener = (message: MessageStreamPayload) => void;

const globalForMessageStreams = globalThis as unknown as {
  ekybotMessageStreams?: Map<string, Set<MessageStreamListener>>;
  ekybotChannelStreams?: Map<string, Set<MessageStreamListener>>;
};

function getMessageStreams() {
  if (!globalForMessageStreams.ekybotMessageStreams) {
    globalForMessageStreams.ekybotMessageStreams = new Map();
  }
  return globalForMessageStreams.ekybotMessageStreams;
}

function getChannelStreams() {
  if (!globalForMessageStreams.ekybotChannelStreams) {
    globalForMessageStreams.ekybotChannelStreams = new Map();
  }
  return globalForMessageStreams.ekybotChannelStreams;
}

function getStreamKey(userId: string, channelName: string) {
  return `${userId}:${channelName}`;
}

export function subscribeToMessageStream(
  userId: string,
  channelName: string,
  listener: MessageStreamListener,
) {
  const streams = getMessageStreams();
  const streamKey = getStreamKey(userId, channelName);
  const listeners = streams.get(streamKey) ?? new Set<MessageStreamListener>();
  listeners.add(listener);
  streams.set(streamKey, listeners);

  return () => {
    const currentListeners = streams.get(streamKey);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      streams.delete(streamKey);
    }
  };
}

export function subscribeToChannelMessages(
  channelName: string,
  listener: MessageStreamListener,
) {
  const streams = getChannelStreams();
  const streamKey = channelName.toLowerCase();
  const listeners = streams.get(streamKey) ?? new Set<MessageStreamListener>();
  listeners.add(listener);
  streams.set(streamKey, listeners);

  return () => {
    const currentListeners = streams.get(streamKey);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      streams.delete(streamKey);
    }
  };
}

export function publishMessageStreamEvent(params: {
  userId: string;
  channelName: string;
  message: MessageStreamPayload;
}) {
  const userScopedListeners = getMessageStreams().get(getStreamKey(params.userId, params.channelName));
  if (userScopedListeners && userScopedListeners.size > 0) {
    for (const listener of userScopedListeners) {
      listener(params.message);
    }
  }

  const channelScopedListeners = getChannelStreams().get(params.channelName.toLowerCase());
  if (channelScopedListeners && channelScopedListeners.size > 0) {
    for (const listener of channelScopedListeners) {
      listener(params.message);
    }
  }
}
