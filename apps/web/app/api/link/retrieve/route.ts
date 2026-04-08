import { NextResponse } from 'next/server';
import { getLink, markRetrieved } from '../store';
export const dynamic = 'force-dynamic';


async function handleRetrieve(code: string | null) {
  console.log(`[LINK RETRIEVE] Request for code: ${code}`);
  
  if (!code) {
    return NextResponse.json({ 
      success: false,
      error: 'Code manquant' 
    }, { status: 400 });
  }
  
  const data = getLink(code.toUpperCase());
  
  if (!data) {
    // Try lowercase too
    const dataLower = getLink(code.toLowerCase());
    if (!dataLower) {
      return NextResponse.json({ 
        success: false,
        error: 'Code invalide ou expiré' 
      }, { status: 404 });
    }
    markRetrieved(code.toLowerCase());
    return NextResponse.json({
      success: true,
      encryptedData: dataLower.encryptedData,
    });
  }
  
  markRetrieved(code.toUpperCase());
  
  console.log(`[LINK RETRIEVE] Returning encrypted data for code: ${code}`);
  
  return NextResponse.json({
    success: true,
    encryptedData: data.encryptedData,
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    return handleRetrieve(code);
  } catch (error) {
    console.error('[LINK RETRIEVE] Error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Erreur serveur' 
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = body.code;
    return handleRetrieve(code);
  } catch (error) {
    console.error('[LINK RETRIEVE] Error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Erreur serveur' 
    }, { status: 500 });
  }
}
