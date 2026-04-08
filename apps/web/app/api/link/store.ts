// In-memory store for link codes
// Codes expire after 5 minutes

interface LinkData {
  encryptedData: string;
  createdAt: number;
  expiresAt: number;
  retrieved: boolean;
}

// Simple in-memory store (works in dev, serverless needs DB later)
const linkStore = new Map<string, LinkData>();

const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// Generate random 6-digit code
export function generateCode(): string {
  return Math.random().toString(10).substring(2, 8).padStart(6, '0');
}

// Clean expired entries
function cleanExpired() {
  const now = Date.now();
  for (const [code, data] of linkStore.entries()) {
    if (now > data.expiresAt) {
      linkStore.delete(code);
    }
  }
}

export function storeLink(encryptedData: string): { code: string; expiresAt: number } {
  cleanExpired();
  
  // Generate unique code
  let code: string;
  let attempts = 0;
  do {
    code = generateCode();
    attempts++;
  } while (linkStore.has(code) && attempts < 100);
  
  const now = Date.now();
  const expiresAt = now + EXPIRY_MS;
  
  linkStore.set(code, {
    encryptedData,
    createdAt: now,
    expiresAt,
    retrieved: false,
  });
  
  console.log(`[LINK STORE] Created code ${code}, expires in 5 min`);
  
  return { code, expiresAt };
}

export function getLink(code: string): LinkData | null {
  cleanExpired();
  
  const data = linkStore.get(code);
  if (!data) return null;
  
  if (Date.now() > data.expiresAt) {
    linkStore.delete(code);
    return null;
  }
  
  return data;
}

export function markRetrieved(code: string): boolean {
  const data = linkStore.get(code);
  if (!data) return false;
  
  data.retrieved = true;
  linkStore.set(code, data);
  console.log(`[LINK STORE] Code ${code} marked as retrieved`);
  
  return true;
}

export function checkStatus(code: string): 'waiting' | 'retrieved' | 'expired' | 'not-found' {
  cleanExpired();
  
  const data = linkStore.get(code);
  if (!data) return 'not-found';
  
  if (Date.now() > data.expiresAt) {
    linkStore.delete(code);
    return 'expired';
  }
  
  return data.retrieved ? 'retrieved' : 'waiting';
}
