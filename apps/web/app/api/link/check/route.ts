import { NextResponse } from 'next/server';
import { checkStatus } from '../store';
export const dynamic = 'force-dynamic';


export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    
    if (!code) {
      return NextResponse.json({ 
        status: 'error',
        error: 'Code manquant' 
      }, { status: 400 });
    }
    
    const status = checkStatus(code);
    
    return NextResponse.json({ status });
    
  } catch (error) {
    console.error('[LINK CHECK] Error:', error);
    return NextResponse.json({ 
      status: 'error',
      error: 'Erreur serveur' 
    }, { status: 500 });
  }
}
