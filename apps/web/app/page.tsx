'use client';

import Link from 'next/link';
import { useSafeAuth } from './hooks/useSafeClerk';
import PageLayout from './components/PageLayout';
import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useTranslation } from '@/i18n/context';

// Native app detection -- same as in settings page
function useIsNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  // Check Capacitor bridge first (works when bridge is injected)
  if ((window as any).Capacitor?.isNativePlatform?.() || (window as any).__EKYBOT_NATIVE__) {
    return true;
  }
  // UA heuristic fallback for remote server.url mode where bridge isn't injected
  const ua = navigator.userAgent || '';
  // iOS: WKWebView without Safari token (also check Macintosh for iPadOS desktop mode)
  const isIosWebView = (/iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) 
    && /AppleWebKit/.test(ua) && !/Safari/.test(ua);
  // Android: WebView with 'wv' flag or Android without Chrome
  const isAndroidWebView = /Android/.test(ua) && (/wv\)/.test(ua) || !/Chrome/.test(ua));
  return isIosWebView || isAndroidWebView;
}

// iOS detection specifically
function useIsIOSApp(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iOS: WKWebView without Safari token (also check Macintosh for iPadOS desktop mode)
  return (/iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) 
    && /AppleWebKit/.test(ua) && !/Safari/.test(ua);
}


/* ═══════════════════════════════════════════
   ANIMATED GRID BACKGROUND — tech 2026 vibe
   ═══════════════════════════════════════════ */
function GridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let w = 0, h = 0;

    const resize = () => {
      w = canvas.width = canvas.offsetWidth * 2;
      h = canvas.height = canvas.offsetHeight * 2;
      ctx.scale(1, 1);
    };
    resize();
    window.addEventListener('resize', resize);

    // Particles
    const particles: { x: number; y: number; vx: number; vy: number; r: number; alpha: number }[] = [];
    const COUNT = 60;
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        r: Math.random() * 2 + 1,
        alpha: Math.random() * 0.5 + 0.1,
      });
    }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);

      // Grid lines
      const gridSize = 60;
      const offset = (t * 0.015) % gridSize;
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.04)';
      ctx.lineWidth = 1;
      for (let x = -gridSize + offset; x < w; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = -gridSize + offset; y < h; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // Particles + connections
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99, 147, 255, ${p.alpha})`;
        ctx.fill();
      }

      // Connection lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(59, 130, 246, ${0.08 * (1 - dist / 150)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Pulsing glow center
      const cx = w / 2, cy = h * 0.4;
      const pulse = Math.sin(t * 0.002) * 0.3 + 0.7;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 400 * pulse);
      grad.addColorStop(0, 'rgba(59, 130, 246, 0.06)');
      grad.addColorStop(1, 'rgba(59, 130, 246, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.7 }}
    />
  );
}

/* ═══════════════════════════════════════════
   GLITCH TEXT — cyberpunk hero effect
   ═══════════════════════════════════════════ */
function GlitchText({ text }: { text: string }) {
  return (
    <span className="relative inline-block">
      <span className="relative z-10">{text}</span>
      <span
        className="absolute top-0 left-0 z-0 text-blue-400/30 animate-glitch-1"
        aria-hidden="true"
      >
        {text}
      </span>
      <span
        className="absolute top-0 left-0 z-0 text-indigo-400/20 animate-glitch-2"
        aria-hidden="true"
      >
        {text}
      </span>
    </span>
  );
}

/* ═══════════════════════════════════════════
   TYPEWRITER for tagline
   ═══════════════════════════════════════════ */
function AnimatedTagline({ text }: { text?: string }) {
  const [displayed, setDisplayed] = useState('');
  const full = text || 'A team of AI agents at your service.';
  const idx = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setDisplayed('');
    const timer = setInterval(() => {
      idx.current++;
      setDisplayed(full.slice(0, idx.current));
      if (idx.current >= full.length) clearInterval(timer);
    }, 45);
    return () => clearInterval(timer);
  }, [full]);

  return (
    <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-400 bg-clip-text text-transparent">
      {displayed}<span className="animate-pulse text-blue-400">|</span>
    </span>
  );
}

/* ═══════════════════════════════════════════
   FADE IN on scroll
   ═══════════════════════════════════════════ */
function FadeIn({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════
   PHONE MOCKUP for screenshots
   ═══════════════════════════════════════════ */
function PhoneMockup({ src, alt, title, subtitle, badge, badgeColor = 'blue', locale }: {
  src: string;
  alt: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeColor?: string;
  locale?: string;
}) {
  const colors: Record<string, string> = {
    blue: 'from-blue-500/20 to-blue-600/20 border-blue-500/30 text-blue-400',
    green: 'from-green-500/20 to-green-600/20 border-green-500/30 text-green-400',
    purple: 'from-purple-500/20 to-purple-600/20 border-purple-500/30 text-purple-400',
  };

  // Use multilingual screenshots based on locale
  let finalSrc = src;
  if (locale) {
    if (src === '/screenshots/01-chat-general.png') {
      finalSrc = `/screenshots/01-chat-${locale}.png`;
    } else if (src === '/screenshots/02-agents.png') {
      finalSrc = `/screenshots/02-agents-${locale}.png`;
    } else if (src === '/screenshots/03-costs.png') {
      finalSrc = `/screenshots/03-costs-${locale}.png`;
    }
  }

  return (
    <div className="flex flex-col items-center group">
      {/* Badge */}
      <div className={`inline-flex items-center gap-1.5 bg-gradient-to-r ${colors[badgeColor]} border px-3 py-1 rounded-full text-xs font-semibold mb-4`}>
        {badge}
      </div>

      {/* Phone frame */}
      <div className="relative mx-auto w-[220px] sm:w-[240px] md:w-[260px]">
        <div className="relative bg-gray-900 rounded-[2.5rem] p-2 shadow-2xl shadow-blue-500/10 border border-gray-700/50 group-hover:border-blue-500/30 transition-all duration-500 group-hover:-translate-y-2 group-hover:shadow-blue-500/20">
          {/* Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-gray-900 rounded-b-2xl z-10" />
          {/* Screen */}
          <div className="rounded-[2rem] overflow-hidden bg-gray-800">
            <Image
              src={finalSrc}
              alt={alt}
              width={428}
              height={926}
              className="w-full h-auto"
              priority
            />
          </div>
        </div>
      </div>

      {/* Title & subtitle */}
      <h3 className="text-xl font-bold mt-6 mb-1 text-white">{title}</h3>
      <p className="text-sm text-gray-400 text-center max-w-[260px] leading-relaxed">{subtitle}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════
   COUNTER animation
   ═══════════════════════════════════════════ */
function AnimatedCounter({ target, suffix = '', prefix = '' }: { target: number; suffix?: string; prefix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        let start = 0;
        const step = target / 40;
        const timer = setInterval(() => {
          start += step;
          if (start >= target) { setCount(target); clearInterval(timer); }
          else setCount(Math.floor(start));
        }, 30);
      }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);

  return <span ref={ref}>{prefix}{count}{suffix}</span>;
}

/* ═══════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════ */
export default function Home() {
  const { t, translations, locale } = useTranslation();
  const isIOSApp = useIsIOSApp(); // Detect iOS app
  let isSignedIn = false;
  let isLoaded = false;
  try {
    const auth = useSafeAuth();
    isSignedIn = auth.isSignedIn === true;
    isLoaded = auth.isLoaded;
  } catch {
    isSignedIn = false;
    isLoaded = true;
  }

  const AuthCTA = ({ primary = true, label, className = '' }: { primary?: boolean; label?: string; className?: string }) => {
    const href = isLoaded && isSignedIn ? '/v3' : '/sign-up';
    const text = isLoaded && isSignedIn ? t('home.ctaLoggedIn') : (label || t('home.cta'));
    if (primary) {
      return (
        <Link href={href} className={`group relative px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-semibold text-lg transition-all shadow-lg shadow-blue-600/25 hover:shadow-xl hover:shadow-blue-600/40 hover:-translate-y-0.5 overflow-hidden ${className}`}>
          <span className="relative z-10">{text}</span>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
      );
    }
    return (
      <Link href={href} className={`px-8 py-4 bg-white text-blue-600 rounded-xl hover:bg-blue-50 font-semibold text-lg transition-all shadow-lg ${className}`}>
        {text}
      </Link>
    );
  };

  return (
    <PageLayout showNavbar={true} maxWidth="6xl" padding={false}>

      {/* ═══ HERO with animated grid ═══ */}
      <section className="relative pt-12 sm:pt-20 pb-16 sm:pb-24 px-4 overflow-hidden">
        <GridBackground />
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-blue-500/15 text-blue-400 px-4 py-2 rounded-full text-sm font-medium mb-4 sm:mb-8 border border-blue-500/20 backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
            </span>
            {t('landing.hero.badge')}
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold mb-2 sm:mb-3 leading-tight">
            <AnimatedTagline text={t('landing.hero.tagline')} />
          </h1>
          
          {/* Platform badges */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-4 sm:mb-6">
            <div className="flex items-center gap-2 bg-gradient-to-r from-gray-800/80 to-gray-700/80 backdrop-blur-sm border border-gray-600/50 px-4 py-2 rounded-full text-white font-medium shadow-lg hover:border-gray-500/70 transition-all">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              iOS
            </div>
            {/* Hide Android badge on iOS app */}
            {!isIOSApp && (
              <div className="flex items-center gap-2 bg-gradient-to-r from-gray-800/80 to-gray-700/80 backdrop-blur-sm border border-gray-600/50 px-4 py-2 rounded-full text-white font-medium shadow-lg hover:border-gray-500/70 transition-all">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993.0001.5511-.4482.9997-.9993.9997m-5.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m-5.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997M6.046 10.8846c0-.9977.8059-1.8036 1.8036-1.8036.9977 0 1.8036.8059 1.8036 1.8036 0 .9977-.8059 1.8036-1.8036 1.8036-.9977 0-1.8036-.8059-1.8036-1.8036m5.046 0c0-.9977.8059-1.8036 1.8036-1.8036.9977 0 1.8036.8059 1.8036 1.8036 0 .9977-.8059 1.8036-1.8036 1.8036-.9977 0-1.8036-.8059-1.8036-1.8036m5.046 0c0-.9977.8059-1.8036 1.8036-1.8036.9977 0 1.8036.8059 1.8036 1.8036 0 .9977-.8059 1.8036-1.8036 1.8036-.9977 0-1.8036-.8059-1.8036-1.8036M7.849 9.081C6.947 8.179 6.935 6.667 7.849 5.765c.914-.902 2.426-.914 3.328 0 .902.914.914 2.426 0 3.328-.914.902-2.426.914-3.328 0m5.046 0C11.993 8.179 11.981 6.667 12.895 5.765c.914-.902 2.426-.914 3.328 0 .902.914.914 2.426 0 3.328-.914.902-2.426.914-3.328 0"/>
                </svg>
                Android
              </div>
            )}
            <div className="flex items-center gap-2 bg-gradient-to-r from-gray-800/80 to-gray-700/80 backdrop-blur-sm border border-gray-600/50 px-4 py-2 rounded-full text-white font-medium shadow-lg hover:border-gray-500/70 transition-all">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              Web
            </div>
          </div>
          
          <p className="text-lg sm:text-xl text-gray-300 mb-6 sm:mb-10 max-w-4xl mx-auto leading-relaxed">
            {t('landing.hero.subtitle')}
          </p>

          <div className="mt-8">
            <Link
              href="/sign-up"
              className="inline-block px-8 py-4 bg-blue-600 text-white text-lg rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              {t('landing.hero.cta')}
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ PROBLEM / SOLUTION ═══ */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-14">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('landing.problem.title')}</h2>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-stretch">
            <FadeIn>
              <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6 lg:p-8 h-full flex flex-col">
                <h3 className="text-xl font-semibold text-red-400 mb-4">{t('landing.problem.today')}</h3>
                <div className="mb-6">
                  <p className="text-gray-300 mb-2 text-sm lg:text-base">{t('landing.problem.subtitle')}</p>
                  <p className="text-gray-400 text-xs lg:text-sm">{t('landing.problem.description')}</p>
                </div>
                <div className="space-y-4 flex-1">
                  {((translations as any)?.landing?.problem?.todayItems || []).map((item: string, i: number) => (
                    <div key={i} className="flex items-start gap-3 text-gray-400">
                      <span className="text-red-400 mt-1 text-sm">✗</span>
                      <span className="text-sm lg:text-base leading-relaxed">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={100}>
              <div className="bg-green-500/5 border border-green-500/20 rounded-2xl p-6 lg:p-8 h-full flex flex-col">
                <h3 className="text-xl font-semibold text-green-400 mb-4">{t('landing.problem.withEkybot')}</h3>
                <p className="text-base lg:text-lg font-medium text-green-300 mb-6">{t('landing.problem.solutionTitle')}</p>
                <div className="space-y-4 flex-1">
                  {((translations as any)?.landing?.problem?.ekybotItems || []).map((item: string, i: number) => (
                    <div key={i} className="flex items-start gap-3 text-gray-300">
                      <span className="text-green-400 mt-1 text-sm">✓</span>
                      <span className="text-sm lg:text-base leading-relaxed">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          </div>

          {/* Description Ekybot */}
          <div className="mt-12">
            <FadeIn>
              <p className="text-lg text-gray-300 max-w-3xl mx-auto text-center leading-relaxed">
                {t('landing.hero.description')}
              </p>
            </FadeIn>
          </div>

          {/* ═══ ARCHITECTURE PIPELINE ═══ */}
          <div className="mt-16">
            <FadeIn>
              <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-8 max-w-6xl mx-auto">
                <h3 className="text-2xl font-bold text-white mb-8 text-center">{t('landing.newArchitecture.title')}</h3>
                <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-8">
                  {/* Step 1: Local */}
                  <div className="text-center w-full md:w-0 md:flex-1 md:min-w-0">
                    <div className="text-5xl lg:text-6xl mb-4">🖥️</div>
                    <h4 className="text-base lg:text-lg font-semibold text-blue-400 mb-2 min-h-[2rem]">{t('landing.newArchitecture.step1.title')}</h4>
                    <p className="text-gray-400 text-xs lg:text-sm leading-relaxed min-h-[3rem]">{t('landing.newArchitecture.step1.description')}</p>
                  </div>

                  {/* Arrow 1 */}
                  <div className="flex items-center justify-center shrink-0">
                    <div className="text-gray-500 text-2xl lg:text-3xl transform md:rotate-0 rotate-90">→</div>
                  </div>

                  {/* Step 2: Connection */}
                  <div className="text-center w-full md:w-0 md:flex-1 md:min-w-0">
                    <div className="text-5xl lg:text-6xl mb-4">🔗</div>
                    <h4 className="text-base lg:text-lg font-semibold text-green-400 mb-2 min-h-[2rem]">{t('landing.newArchitecture.step2.title')}</h4>
                    <p className="text-gray-400 text-xs lg:text-sm leading-relaxed min-h-[3rem]">{t('landing.newArchitecture.step2.description')}</p>
                  </div>

                  {/* Arrow 2 */}
                  <div className="flex items-center justify-center shrink-0">
                    <div className="text-gray-500 text-2xl lg:text-3xl transform md:rotate-0 rotate-90">→</div>
                  </div>

                  {/* Step 3: Mobile */}
                  <div className="text-center w-full md:w-0 md:flex-1 md:min-w-0">
                    <div className="text-5xl lg:text-6xl mb-4">📱</div>
                    <h4 className="text-base lg:text-lg font-semibold text-purple-400 mb-2 min-h-[2rem]">{t('landing.newArchitecture.step3.title')}</h4>
                    <p className="text-gray-400 text-xs lg:text-sm leading-relaxed min-h-[3rem]">{t('landing.newArchitecture.step3.description')}</p>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section className="py-20 px-4 bg-gray-800/30">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('landing.features.title')}</h2>
              <p className="text-lg text-gray-400 max-w-2xl mx-auto">{t('landing.features.subtitle')}</p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: '🤝', bg: 'bg-cyan-500/20', title: t('landing.features.collaboration.title'), desc: t('landing.features.collaboration.desc') },
              { icon: '🤖', bg: 'bg-blue-500/20', title: t('landing.features.multiAgent.title'), desc: t('landing.features.multiAgent.desc') },
              { icon: '💰', bg: 'bg-yellow-500/20', title: t('landing.features.costs.title'), desc: t('landing.features.costs.desc') },
              { icon: '🎯', bg: 'bg-orange-500/20', title: t('landing.features.tokenControl.title'), desc: t('landing.features.tokenControl.desc') },
              { icon: '⚡', bg: 'bg-purple-500/20', title: t('landing.features.models.title'), desc: t('landing.features.models.desc') },
              { icon: '🔐', bg: 'bg-green-500/20', title: t('landing.features.security.title'), desc: t('landing.features.security.desc') },
              { icon: '🧠', bg: 'bg-indigo-500/20', title: t('landing.features.memory.title'), desc: t('landing.features.memory.desc') },
              { icon: '📱', bg: 'bg-pink-500/20', title: t('landing.features.mobile.title'), desc: t('landing.features.mobile.desc') },
            ].map((f) => (
              <FadeIn key={f.title}>
                <div className="bg-gray-800/50 rounded-2xl p-6 hover:bg-gray-800 transition-all border border-gray-700/50 hover:border-gray-600 h-full group">
                  <div className={`w-12 h-12 ${f.bg} rounded-xl flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform`}>
                    {f.icon}
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                  <p className="text-gray-400 leading-relaxed text-sm">{f.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SCREENSHOTS SHOWCASE ═══ */}
      <section id="screenshots" className="py-20 px-4 bg-gradient-to-b from-gray-900 via-gray-800/50 to-gray-900">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold mb-4">
                {t('landing.screenshots.title')}{' '}
                <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  {t('landing.screenshots.titleHighlight')}
                </span>
              </h2>
              <p className="text-lg text-gray-400 max-w-2xl mx-auto">
                {t('landing.screenshots.subtitle')}
              </p>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            <FadeIn delay={0}>
              <PhoneMockup
                src="/screenshots/01-chat-general.png"
                alt={t('landing.screenshots.chat.title')}
                title={t('landing.screenshots.chat.title')}
                subtitle={t('landing.screenshots.chat.subtitle')}
                badge={t('landing.screenshots.chat.badge')}
                badgeColor="blue"
                locale={locale}
              />
            </FadeIn>
            <FadeIn delay={150}>
              <PhoneMockup
                src="/screenshots/02-agents.png"
                alt={t('landing.screenshots.agents.title')}
                title={t('landing.screenshots.agents.title')}
                subtitle={t('landing.screenshots.agents.subtitle')}
                badge={t('landing.screenshots.agents.badge')}
                badgeColor="purple"
                locale={locale}
              />
            </FadeIn>
            <FadeIn delay={300}>
              <PhoneMockup
                src="/screenshots/03-costs.png"
                alt={t('landing.screenshots.costs.title')}
                title={t('landing.screenshots.costs.title')}
                subtitle={t('landing.screenshots.costs.subtitle')}
                badge={t('landing.screenshots.costs.badge')}
                badgeColor="green"
                locale={locale}
              />
            </FadeIn>
          </div>
        </div>
      </section>



      {/* ═══ HOW IT WORKS ═══ */}
      <section id="how-it-works" className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('landing.howItWorks.title')}</h2>
              <p className="text-lg text-gray-400">{t('landing.howItWorks.subtitle')}</p>
            </div>
          </FadeIn>

          <div className="space-y-1">
            {[
              { step: '1', title: t('landing.howItWorks.step1.title'), desc: t('landing.howItWorks.step1.desc'), link: '/openclaw-install', linkText: t('landing.howItWorks.step1.link') },
              { step: '2', title: t('landing.howItWorks.step2.title'), desc: t('landing.howItWorks.step2.desc'), altDesc: t('landing.howItWorks.step2.altDesc'), link: t('landing.howItWorks.step2.skillLink'), linkText: 'Skill EkyBot Connector →' },
              { step: '3', title: t('landing.howItWorks.step3.title'), desc: t('landing.howItWorks.step3.desc') },
            ].map((s, i) => (
              <FadeIn key={s.step} delay={i * 100}>
                <div className="flex gap-6 items-start p-6 rounded-xl hover:bg-gray-800/30 transition-colors">
                  <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl flex items-center justify-center font-bold text-xl flex-shrink-0 shadow-lg shadow-blue-500/20">
                    {s.step}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-1">{s.title}</h3>
                    <p className="text-gray-400">{s.desc}</p>
                    {(s as any).altDesc && (
                      <p className="text-gray-400 mt-2">{(s as any).altDesc}</p>
                    )}
                    {(s as any).link && (
                      <Link href={(s as any).link} className="inline-block mt-2 text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors" target="_blank">
                        {(s as any).linkText}
                      </Link>
                    )}
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ OPENCLAW + EKYBOT COMBO ═══ */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-14">
              <div className="inline-flex items-center gap-2 bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-sm font-medium mb-4 border border-emerald-500/30">
                {t('landing.combo.badge')}
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                <span className="bg-gradient-to-r from-emerald-400 to-blue-400 bg-clip-text text-transparent">OpenClaw</span>
                {' '}+{' '}
                <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">EkyBot</span>
                {' '}{t('landing.combo.title')}
              </h2>
              <p className="text-lg text-gray-400 max-w-2xl mx-auto">
                {t('landing.combo.subtitle')}
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-2 gap-8">
            <FadeIn>
              <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 rounded-2xl border border-emerald-500/20 p-8 h-full">
                <div className="w-14 h-14 bg-emerald-500/20 rounded-xl flex items-center justify-center text-3xl mb-5">🐾</div>
                <h3 className="text-2xl font-bold mb-3 text-emerald-400">{t('landing.combo.openclaw.title')}</h3>
                <p className="text-gray-400 mb-5 leading-relaxed">
                  {t('landing.combo.openclaw.desc')}
                </p>
                <ul className="space-y-3 text-gray-300 text-sm">
                  {((translations as any)?.landing?.combo?.openclaw?.features || []).map((item: string, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-emerald-400 mt-0.5">▸</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/openclaw" className="inline-flex items-center gap-2 mt-6 text-emerald-400 hover:text-emerald-300 font-medium text-sm transition-colors">
                  {t('landing.combo.openclaw.link')}
                </Link>
              </div>
            </FadeIn>

            <FadeIn delay={150}>
              <div className="bg-gradient-to-br from-blue-500/10 to-indigo-500/5 rounded-2xl border border-blue-500/20 p-8 h-full">
                <div className="w-14 h-14 bg-blue-500/20 rounded-xl flex items-center justify-center mb-5">
                  <img src="/logo.png" alt="Ekybot" className="w-8 h-8 rounded-lg" />
                </div>
                <h3 className="text-2xl font-bold mb-3 text-blue-400">{t('landing.combo.ekybot.title')}</h3>
                <p className="text-gray-400 mb-5 leading-relaxed">
                  {t('landing.combo.ekybot.desc')}
                </p>
                <ul className="space-y-3 text-gray-300 text-sm">
                  {((translations as any)?.landing?.combo?.ekybot?.features || []).map((item: string, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-blue-400 mt-0.5">▸</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <AuthCTA className="mt-6 !text-sm !py-2 !px-5" label={t('landing.combo.ekybot.cta')} />
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Pricing section removed — see /pricing page */}

      {/* ═══ FAQ ═══ */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <div className="text-center mb-14">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('landing.faq.title')}</h2>
            </div>
          </FadeIn>

          <div className="space-y-4">
            {(() => {
              const faqData = (translations as any)?.landing?.faq || {};
              return ['cost', 'coding', 'security', 'models', 'whatIsOpenClaw']
                .filter(k => faqData[k])
                .map(k => ({ q: faqData[k].q, a: faqData[k].a }));
            })().map((faq: { q: string; a: string }) => (
              <FadeIn key={faq.q}>
                <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 hover:border-gray-600 transition-colors">
                  <h3 className="text-lg font-semibold mb-2">{faq.q}</h3>
                  <p className="text-gray-400 leading-relaxed">{faq.a}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CTA FINAL ═══ */}
      <section className="relative py-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-600" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4xKSIvPjwvc3ZnPg==')] opacity-30" />
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            {t('landing.cta.title')}
          </h2>
          <p className="text-xl text-blue-100 mb-10">
            {t('landing.cta.subtitle')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <AuthCTA primary={false} label={t('landing.cta.primary')} />
            <Link href="/contact" className="px-8 py-4 bg-transparent text-white rounded-xl hover:bg-white/10 font-semibold text-lg transition-all border border-white/30">
              {t('landing.cta.secondary')}
            </Link>
          </div>
          {/* Store badges */}
          <div className="flex items-center justify-center gap-4 mt-8">
            {/* App Store badge — uncomment when approved */}
            {/* <a href="https://apps.apple.com/app/ekybot/id6740091498" target="_blank" rel="noopener noreferrer">
              <img src="/app-store-badge.svg" alt="Download on the App Store" className="h-11 hover:opacity-80 transition-opacity" />
            </a> */}
            <a href="https://play.google.com/store/apps/details?id=com.ekybot.app" target="_blank" rel="noopener noreferrer">
              <img src="/google-play-badge.png" alt="Get it on Google Play" className="h-11 hover:opacity-80 transition-opacity" />
            </a>
          </div>
          <p className="mt-4 text-blue-200/60 text-sm">{t('landing.cta.madeIn')}</p>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-12 px-4 border-t border-gray-800">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🤖</span>
              <span className="font-bold text-xl">EkyBot</span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 md:gap-8 text-gray-400 text-sm">
              <Link href="/openclaw" className="hover:text-white transition-colors">{t('landing.footer.openclaw')}</Link>
              <Link href="/pricing" className="hover:text-white transition-colors">{t('landing.footer.pricing')}</Link>
              <Link href="/docs" className="hover:text-white transition-colors">{t('landing.footer.docs')}</Link>
              <Link href="/contact" className="hover:text-white transition-colors">{t('landing.footer.contact')}</Link>
              <Link href="/terms" className="hover:text-white transition-colors">{t('landing.footer.terms')}</Link>
              <Link href="/privacy" className="hover:text-white transition-colors">{t('landing.footer.privacy')}</Link>
              <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub</a>
            </div>

            <div className="flex items-center gap-3">
              {/* App Store badge — uncomment when approved */}
              <a href="https://play.google.com/store/apps/details?id=com.ekybot.app" target="_blank" rel="noopener noreferrer">
                <img src="/google-play-badge.png" alt="Google Play" className="h-8 hover:opacity-80 transition-opacity" />
              </a>
            </div>
            <div className="text-gray-500 text-sm">
              © 2026 EkyBot — Ekytec
            </div>
          </div>
        </div>
      </footer>

      {/* Glitch animation styles */}
      <style jsx global>{`
        @keyframes glitch-1 {
          0%, 100% { clip-path: inset(0 0 0 0); transform: translate(0); }
          20% { clip-path: inset(20% 0 60% 0); transform: translate(-2px, 2px); }
          40% { clip-path: inset(60% 0 10% 0); transform: translate(2px, -1px); }
          60% { clip-path: inset(40% 0 30% 0); transform: translate(-1px, 1px); }
          80% { clip-path: inset(80% 0 5% 0); transform: translate(1px, -2px); }
        }
        @keyframes glitch-2 {
          0%, 100% { clip-path: inset(0 0 0 0); transform: translate(0); }
          20% { clip-path: inset(60% 0 20% 0); transform: translate(2px, -2px); }
          40% { clip-path: inset(10% 0 60% 0); transform: translate(-2px, 1px); }
          60% { clip-path: inset(30% 0 40% 0); transform: translate(1px, -1px); }
          80% { clip-path: inset(5% 0 80% 0); transform: translate(-1px, 2px); }
        }
        .animate-glitch-1 { animation: glitch-1 3s infinite linear; }
        .animate-glitch-2 { animation: glitch-2 3s infinite linear; animation-delay: 0.1s; }
      `}</style>
    </PageLayout>
  );
}
