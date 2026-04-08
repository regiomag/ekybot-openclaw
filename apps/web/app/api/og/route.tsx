import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          position: 'relative',
        }}
      >
        {/* Accent glow */}
        <div
          style={{
            position: 'absolute',
            top: '50px',
            right: '200px',
            width: '400px',
            height: '400px',
            borderRadius: '50%',
            background: 'rgba(37, 99, 235, 0.08)',
          }}
        />

        {/* Logo */}
        <img
          src="https://ekybot.com/logo.png"
          width={160}
          height={160}
          style={{ borderRadius: '24px', marginBottom: '24px' }}
        />

        {/* Title */}
        <div
          style={{
            fontSize: '64px',
            fontWeight: 'bold',
            color: '#ffffff',
            marginBottom: '12px',
            letterSpacing: '-1px',
          }}
        >
          EkyBot
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: '28px',
            color: '#94a3b8',
            marginBottom: '16px',
          }}
        >
          Votre équipe d&apos;IA sur votre machine
        </div>

        {/* Features */}
        <div
          style={{
            display: 'flex',
            gap: '24px',
            fontSize: '20px',
            color: '#64748b',
            marginBottom: '40px',
          }}
        >
          <span>🤖 Multi-agents</span>
          <span>•</span>
          <span>💰 Dashboard coûts</span>
          <span>•</span>
          <span>🔒 Self-hosted</span>
        </div>

        {/* URL */}
        <div
          style={{
            fontSize: '22px',
            fontWeight: 'bold',
            color: '#3b82f6',
          }}
        >
          ekybot.com
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
