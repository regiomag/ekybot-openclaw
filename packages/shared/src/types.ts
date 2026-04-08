import { z } from 'zod';

// User types
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  createdAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

// Message types
export const MessageSchema = z.object({
  id: z.string(),
  userId: z.string(),
  content: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  createdAt: z.date(),
});

export type Message = z.infer<typeof MessageSchema>;

// API Response types
export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};
