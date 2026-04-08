import { NextRequest, NextResponse } from 'next/server';
import { Receiver } from '@upstash/qstash';

import {
  queueAgentAuthoredMentionRelay,
  seedAgentAuthoredMentionWorkflowState,
} from '@/lib/agent-authored-mention-relay';
import { updateLongRunningRun } from '@/lib/long-running-runs';
import { createWorkflowRequestId } from '@/lib/mention-workflow';
import { prisma } from '@/lib/prisma';
import { runRelayMessagePostprocess } from '@/lib/relay-message-postprocess';
import type {
  AgentForwardPayload,
  LongRunWorkerPayload,
  RelayPostprocessWorkerPayload,
  WorkerPayload,
} from '@/lib/qstash';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function extractAssistantText(resText: string) {
  let agentReply: string | null = null;

  try {
    const resJson = JSON.parse(resText);
    agentReply = resJson?.choices?.[0]?.message?.content || null;
  } catch {
    const lines = resText.split('\n').filter((line) => line.startsWith('data: '));
    const chunks: string[] = [];
    for (const line of lines) {
      const data = line.slice(6);
      if (data === '[DONE]') break;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta) chunks.push(delta);
      } catch {}
    }
    if (chunks.length > 0) {
      agentReply = chunks.join('');
    }
  }

  return agentReply?.trim() ? agentReply.trim() : null;
}

function sanitizeAgentReply(agentReply: string) {
  return agentReply
    .replace(/^\*\*[A-Za-z0-9_🦅🤖📱🌊📈🚀 ]+ → #[a-zA-Z0-9_-]+\*\*\n*/m, '')
    .replace(/^\[CC INTER-AGENT\].*?\n*/m, '')
    .replace(/^📨 \[[^\]]+\]\s*/m, '')
    .trim();
}

function hasUsableAssistantContent(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSentinelReply(reply: string | null) {
  const SENTINEL_REPLIES = ['NO_REPLY', 'HEARTBEAT_OK', 'ANNOUNCE_SKIP'];
  const trimmed = reply?.trim() || '';
  return (
    SENTINEL_REPLIES.includes(trimmed) ||
    SENTINEL_REPLIES.some((sentinel) => trimmed.startsWith(sentinel))
  );
}

async function handleLongRun(payload: LongRunWorkerPayload, startTime: number) {
  const {
    runId,
    requestId,
    channelKey,
    userId,
    agentDisplayName,
    openclawAgentId,
    pendingMessageId,
    gatewayUrl,
    gatewayToken,
    sessionKey,
    requestBody,
  } = payload;

  console.log(
    `[Worker] long-run: runId=${runId} requestId=${requestId} channel=#${channelKey} agent=${openclawAgentId}`
  );

  await updateLongRunningRun({
    runId,
    status: 'accepted',
    phase: 'analysis',
    progressHint: 'Run pris en charge par le worker',
    lastHeartbeatAt: new Date(),
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-openclaw-agent-id': openclawAgentId,
    'x-openclaw-session-key': sessionKey,
    'ngrok-skip-browser-warning': 'true',
    'User-Agent': 'Ekybot/long-run-worker',
  };
  if (gatewayToken) {
    headers.Authorization = `Bearer ${gatewayToken}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 290000);

  try {
    await updateLongRunningRun({
      runId,
      status: 'working',
      phase: 'execution',
      progressHint: 'Agent en cours de traitement',
      lastHeartbeatAt: new Date(),
    });

    const res = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Gateway returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }

    const resText = await res.text();
    const extractedReply = extractAssistantText(resText);

    if (!extractedReply || isSentinelReply(extractedReply)) {
      throw new Error('Aucune réponse texte exploitable renvoyée par le gateway');
    }

    const finalContent = sanitizeAgentReply(extractedReply);
    if (!hasUsableAssistantContent(finalContent)) {
      throw new Error('Réponse assistant vide après nettoyage');
    }

    await prisma.message.update({
      where: { id: pendingMessageId },
      data: {
        content: finalContent,
        authorType: 'main-agent',
        authorName: agentDisplayName || 'Agent',
      },
    });

    await updateLongRunningRun({
      runId,
      status: 'completed',
      phase: 'done',
      progressHint: 'Run terminé',
      lastHeartbeatAt: new Date(),
      lastRenderedAt: new Date(),
      finalMessageId: pendingMessageId,
    });

    console.log(
      `[Worker] long-run completed: runId=${runId} requestId=${requestId} duration=${Date.now() - startTime}ms`
    );

    return NextResponse.json({
      success: true,
      kind: 'long-run',
      runId,
      requestId,
      duration: Date.now() - startTime,
    });
  } catch (error: any) {
    const failureMessage =
      error?.name === 'AbortError'
        ? '❌ La tâche longue a dépassé le délai maximal du worker.'
        : `❌ ${error?.message || 'La tâche longue a échoué.'}`;

    await prisma.message
      .update({
        where: { id: pendingMessageId },
        data: {
          content: failureMessage,
          authorType: 'system',
          authorName: '⚙️ Système',
        },
      })
      .catch(() => null);

    await updateLongRunningRun({
      runId,
      status: 'failed',
      phase: 'error',
      progressHint: failureMessage,
      lastHeartbeatAt: new Date(),
      lastRenderedAt: new Date(),
      finalMessageId: pendingMessageId,
    });

    console.error('[Worker] long-run ERROR:', error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'long-run failed', kind: 'long-run', runId },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleAgentForward(payload: AgentForwardPayload, startTime: number) {
  const {
    sourceAgent,
    targetAgentId,
    channelName,
    sessionId,
    agentDisplayName,
    content,
    images,
    gatewayUrl,
    gatewayToken,
    userId,
  } = payload;

  console.log(
    `[Worker] agent-forward: ${sourceAgent} → ${targetAgentId} (#${channelName}) | gwUrl=${gatewayUrl?.slice(0, 40)} | hasToken=${!!gatewayToken} | sessionId=${sessionId?.slice(0, 20)}`
  );

  const publicGatewayUrl = process.env.GATEWAY_PUBLIC_URL || 'https://gateway.ekybot.com';
  let httpUrl = (gatewayUrl || publicGatewayUrl)
    .replace(/^ws:\/\//, 'http://')
    .replace(/^wss:\/\//, 'https://');
  if (httpUrl.includes('localhost') || httpUrl.includes('127.0.0.1')) {
    console.log(`[Worker] Replacing local gateway URL "${httpUrl}" with public "${publicGatewayUrl}"`);
    httpUrl = publicGatewayUrl;
  }

  const sessionKey = `agent:${targetAgentId}:ekybot:${channelName}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-openclaw-agent-id': targetAgentId,
    'x-openclaw-session-key': sessionKey,
    'User-Agent': 'Ekybot/3.0-qstash',
  };
  if (gatewayToken) {
    headers.Authorization = `Bearer ${gatewayToken}`;
  }

  let userContent: any = content;
  if (images && images.length > 0) {
    userContent = [
      { type: 'text', text: content },
      ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
    ];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 58000);

  try {
    const res = await fetch(`${httpUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: `openclaw:${targetAgentId}`,
        messages: [{ role: 'user', content: userContent }],
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const resText = await res.text().catch(() => '');
      console.error(
        `[Worker] Forward FAILED: ${sourceAgent} → ${targetAgentId} (${res.status}) — ${resText.slice(0, 300)}`
      );
      return NextResponse.json(
        {
          error: `Gateway returned ${res.status}`,
          detail: resText.slice(0, 300),
        },
        { status: 500 }
      );
    }

    const resText = await res.text();
    const extractedReply = extractAssistantText(resText);

    if (!extractedReply) {
      console.log(
        `[Worker] Forward OK but no text reply from ${targetAgentId} (${Date.now() - startTime}ms)`
      );
      return NextResponse.json({
        success: true,
        hasReply: false,
        duration: Date.now() - startTime,
      });
    }

    if (isSentinelReply(extractedReply)) {
      console.log(
        `[Worker] Filtered sentinel reply: "${extractedReply.slice(0, 30)}" from ${targetAgentId}`
      );
      return NextResponse.json({
        success: true,
        hasReply: false,
        filtered: extractedReply.slice(0, 20),
        duration: Date.now() - startTime,
      });
    }

    const agentReply = sanitizeAgentReply(extractedReply);
    if (!hasUsableAssistantContent(agentReply)) {
      console.warn(
        `[Worker] Filtered empty assistant reply after sanitize for ${targetAgentId} → #${channelName}`
      );
      return NextResponse.json({
        success: true,
        hasReply: false,
        filtered: 'empty_after_sanitize',
        duration: Date.now() - startTime,
      });
    }
    const contentStart = agentReply.slice(0, 100);
    const existingMsg = await prisma.message.findFirst({
      where: {
        sessionId,
        role: 'assistant',
        content: { startsWith: contentStart },
        createdAt: { gt: new Date(Date.now() - 30000) },
      },
    });

    if (!existingMsg) {
      const agentResponse = await prisma.message.create({
        data: {
          sessionId,
          userId,
          role: 'assistant',
          content: agentReply,
          createdAt: new Date(),
          authorType: 'sub-agent',
          authorName: agentDisplayName || `🤖 ${targetAgentId}`,
        },
      });
      console.log(
        `[Worker] Agent response SAVED: ${targetAgentId} → #${channelName} (${agentReply.length} chars, msgId: ${agentResponse.id}, ${Date.now() - startTime}ms)`
      );

      if (userId && channelName && targetAgentId) {
        const requestId = createWorkflowRequestId(channelName);
        const mentionQueue = await queueAgentAuthoredMentionRelay({
          userId,
          channelKey: channelName,
          sourceAgentId: targetAgentId,
          sourceAgentName: agentDisplayName || targetAgentId,
          content: agentReply,
          requestId,
        });

        if (mentionQueue.count > 0) {
          await seedAgentAuthoredMentionWorkflowState({
            userId,
            channelKey: channelName,
            requestId,
            hostAgentId: targetAgentId,
            actorName: agentDisplayName || targetAgentId,
            originalPrompt: agentReply,
            mentionIds: mentionQueue.mentionIds,
            targetAgentNames: mentionQueue.targetAgentNames,
          });
          console.log(
            `[Worker] Agent-authored @mention queued for ${mentionQueue.targetAgentNames.join(', ')} in #${channelName} requestId=${requestId}`
          );
        }
      }
    } else {
      console.log(`[Worker] DEDUP: skipping duplicate save for ${targetAgentId} → #${channelName}`);
    }

    return NextResponse.json({
      success: true,
      hasReply: true,
      duration: Date.now() - startTime,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleRelayPostprocess(payload: RelayPostprocessWorkerPayload, startTime: number) {
  console.log(
    `[Worker] relay-postprocess: notification=${payload.notificationId} message=${payload.messageId} channel=#${payload.channelKey}`
  );

  await runRelayMessagePostprocess(payload);

  return NextResponse.json({
    success: true,
    kind: 'relay-postprocess',
    notificationId: payload.notificationId,
    messageId: payload.messageId,
    duration: Date.now() - startTime,
  });
}

async function handler(req: NextRequest) {
  const startTime = Date.now();
  console.log(`[Worker] ========== CALLED at ${new Date().toISOString()} ==========`);

  try {
    const payload: WorkerPayload = await req.json();

    if (payload.kind === 'long-run') {
      return handleLongRun(payload, startTime);
    }

    if (payload.kind === 'relay-postprocess') {
      return handleRelayPostprocess(payload, startTime);
    }

    return handleAgentForward(payload as AgentForwardPayload, startTime);
  } catch (error: any) {
    console.error('[Worker] agent-forward ERROR:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'worker failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  console.log(
    `[Worker] POST /api/workers/agent-forward HIT at ${new Date().toISOString()} | sig=${!!req.headers.get('upstash-signature')}`
  );
  const signingKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (signingKey && nextSigningKey) {
    const signature = req.headers.get('upstash-signature');
    if (signature) {
      try {
        const receiver = new Receiver({ currentSigningKey: signingKey, nextSigningKey });
        const body = await req.text();
        const canonicalUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/api/workers/agent-forward`;
        const isValid = await receiver
          .verify({ signature, body, url: canonicalUrl })
          .catch(() => receiver.verify({ signature, body, url: req.url }).catch(() => false));
        if (isValid) {
          console.log('[Worker] QStash signature verified ✅');
          const newReq = new NextRequest(req.url, { method: 'POST', headers: req.headers, body });
          return handler(newReq);
        }
        console.warn(
          '[Worker] QStash signature verification failed — allowing request during debug phase'
        );
        const newReq = new NextRequest(req.url, { method: 'POST', headers: req.headers, body });
        return handler(newReq);
      } catch (err: any) {
        console.error('[Worker] Signature error:', err.message, '— allowing request during debug phase');
        return handler(req);
      }
    }
  }

  console.warn('[Worker] QStash signing keys not configured — skipping signature verification');
  return handler(req);
}
