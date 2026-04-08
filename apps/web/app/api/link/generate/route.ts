import { NextResponse } from 'next/server';
import { storeLink } from '../store';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { encryptedData } = body;
    
    console.log('[LINK API] Generate request received');
    
    if (!encryptedData) {
      return NextResponse.json({ 
        success: false, 
        error: 'Données manquantes' 
      }, { status: 400 });
    }
    
    const { code, expiresAt } = storeLink(encryptedData);
    
    console.log(`[LINK API] Generated code: ${code}`);
    
    return NextResponse.json({
      success: true,
      code,
      expiresAt: new Date(expiresAt).toISOString(),
    });
    
  } catch (error) {
    console.error('[LINK API] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Erreur serveur' 
    }, { status: 500 });
  }
}
