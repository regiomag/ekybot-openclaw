import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { AnthropicProvider } from '@ekybot/ai';
import { db } from '@ekybot/db';

const t = initTRPC.create();

const router = t.router;
const publicProcedure = t.procedure;

// Initialize AI provider
const anthropic = new AnthropicProvider(process.env.ANTHROPIC_API_KEY || '');

export const appRouter = router({
  // Chat mutation - now with DB persistence
  chat: publicProcedure
    .input(
      z.object({
        messages: z.array(
          z.object({
            role: z.enum(['user', 'assistant', 'system']),
            content: z.string(),
          })
        ),
        clerkId: z.string().optional(),
        sessionId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const response = await anthropic.chat({
        messages: input.messages,
        model: 'claude-sonnet-4-5',
        maxTokens: 4096,
      });

      // If we have a clerkId, persist to DB
      if (input.clerkId) {
        try {
          // Get or create user
          let user = await db.user.findUnique({
            where: { clerkId: input.clerkId },
          });

          if (!user) {
            user = await db.user.create({
              data: {
                authProvider: 'clerk',
                authSubject: input.clerkId,
                clerkId: input.clerkId,
                email: `${input.clerkId}@temp.ekybot.com`, // Will be updated later
              },
            });
          }

          // Get or create session
          let sessionId = input.sessionId;
          if (!sessionId) {
            const session = await db.session.create({
              data: {
                userId: user.id,
                title: input.messages[0]?.content.substring(0, 50) || 'New Chat',
              },
            });
            sessionId = session.id;
          }

          // Save the user message (last one in array)
          const lastUserMessage = input.messages[input.messages.length - 1];
          if (lastUserMessage && lastUserMessage.role === 'user') {
            await db.message.create({
              data: {
                sessionId,
                userId: user.id,
                content: lastUserMessage.content,
                role: 'user',
              },
            });
          }

          // Save the assistant response
          await db.message.create({
            data: {
              sessionId,
              userId: user.id,
              content: response.content,
              role: 'assistant',
              model: 'claude-sonnet-4-5',
              tokens: response.tokens?.total,
            },
          });

          // Log API usage
          if (response.tokens && response.cost) {
            await db.apiUsage.create({
              data: {
                userId: user.id,
                model: 'claude-sonnet-4-5',
                tokens: response.tokens.total || 0,
                cost: response.cost,
              },
            });
          }
        } catch (dbError) {
          console.error('DB Error (non-blocking):', dbError);
          // Don't fail the request if DB fails
        }
      }

      return {
        message: {
          role: 'assistant' as const,
          content: response.content,
        },
        usage: response.tokens,
        cost: response.cost,
      };
    }),

  // Get user's chat sessions
  getSessions: publicProcedure
    .input(z.object({ clerkId: z.string() }))
    .query(async ({ input }) => {
      const user = await db.user.findUnique({
        where: { clerkId: input.clerkId },
        include: {
          sessions: {
            orderBy: { updatedAt: 'desc' },
            take: 20,
          },
        },
      });
      return user?.sessions || [];
    }),

  // Get messages for a session
  getMessages: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const messages = await db.message.findMany({
        where: { sessionId: input.sessionId },
        orderBy: { createdAt: 'asc' },
      });
      return messages;
    }),

  // Get user's API usage stats
  getUsage: publicProcedure
    .input(z.object({ clerkId: z.string() }))
    .query(async ({ input }) => {
      const user = await db.user.findUnique({
        where: { clerkId: input.clerkId },
      });
      
      if (!user) return { totalCost: 0, totalTokens: 0, breakdown: [] };

      const usage = await db.apiUsage.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      const totalCost = usage.reduce((sum: number, u: { cost: number }) => sum + u.cost, 0);
      const totalTokens = usage.reduce((sum: number, u: { tokens: number }) => sum + u.tokens, 0);

      return { totalCost, totalTokens, breakdown: usage };
    }),

  health: publicProcedure.query(() => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }),
});

export type AppRouter = typeof appRouter;
