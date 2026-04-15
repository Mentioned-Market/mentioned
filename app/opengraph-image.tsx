import { ImageResponse } from 'next/og';
import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const alt = 'Mentioned - Trade Predictions on What Gets Said';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  const logoData = readFileSync(join(process.cwd(), 'public/src/img/__White Logo.png'));
  const logoBase64 = `data:image/png;base64,${logoData.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          backgroundColor: '#000000',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '64px 72px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background grid dots */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            display: 'flex',
          }}
        />

        {/* Glow orbs */}
        <div
          style={{
            position: 'absolute',
            top: -120,
            right: -80,
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(242,183,31,0.2) 0%, transparent 70%)',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -100,
            left: 200,
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(242,183,31,0.12) 0%, transparent 70%)',
            display: 'flex',
          }}
        />

        {/* Logo */}
        <img
          src={logoBase64}
          width={360}
          height={96}
          style={{ objectFit: 'contain', objectPosition: 'left' }}
        />

        {/* Main content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 820 }}>
          {/* YES / NO pills */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                backgroundColor: 'rgba(52,199,89,0.15)',
                border: '1px solid rgba(52,199,89,0.4)',
                borderRadius: 999,
                padding: '6px 18px',
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: '#34C759',
                  display: 'flex',
                }}
              />
              <span style={{ color: '#34C759', fontSize: 15, fontWeight: 600 }}>YES</span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                backgroundColor: 'rgba(255,59,48,0.15)',
                border: '1px solid rgba(255,59,48,0.4)',
                borderRadius: 999,
                padding: '6px 18px',
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: '#FF3B30',
                  display: 'flex',
                }}
              />
              <span style={{ color: '#FF3B30', fontSize: 15, fontWeight: 600 }}>NO</span>
            </div>
          </div>

          <div
            style={{
              fontSize: 68,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1.05,
              letterSpacing: '-1px',
            }}
          >
            Trade on What Gets Said
          </div>

          <div
            style={{
              fontSize: 24,
              color: 'rgba(255,255,255,0.55)',
              lineHeight: 1.4,
              fontWeight: 400,
            }}
          >
            Mention markets for speeches, podcasts, earnings calls &amp; more.
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', width: '100%' }}>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 16 }}>
            mentioned.market
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
