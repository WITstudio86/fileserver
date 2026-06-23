// src/app/page.tsx
'use client';
import { useState, useEffect } from 'react';
import Header from '@/components/Header';
import JoinModal from '@/components/JoinModal';

export default function HomePage() {
  const [showJoin, setShowJoin] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(false);
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLoading(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const handleStartService = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/token/create', { method: 'POST' });
      const data = await res.json();
      if (data.token) {
        window.location.href = `/service?token=${data.token}`;
      } else {
        alert('获取 Token 失败，请重试');
      }
    } catch (err) {
      alert('网络错误，请检查服务连接');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <main style={{ textAlign: 'center', padding: '60px 16px 60px' }}>
        {/* Hero */}
        <h1 style={{
          fontSize: 36, fontWeight: 800, marginBottom: 12,
          letterSpacing: '-0.5px', lineHeight: 1.2,
        }}>
          局域网文件共享
          <br />
          <span style={{ color: 'var(--accent)' }}>简单即连</span>
        </h1>
        <p style={{
          color: 'var(--muted)', fontSize: 17, maxWidth: 480,
          margin: '0 auto 40px', lineHeight: 1.6,
        }}>
          同一网络下，一端开启服务、选择文件夹，另一端输入 4 位码即可加入。
          无需安装任何客户端，浏览器就是全部。
        </p>

        {/* CTA Buttons */}
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginBottom: 56, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={handleStartService}
            disabled={loading}
            style={{ fontSize: 16, padding: '14px 32px', borderRadius: 10, gap: 8 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            {loading ? '正在生成...' : '开启服务'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowJoin(true)}
            type="button"
            style={{ fontSize: 16, padding: '14px 32px', borderRadius: 10, gap: 8 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            加入服务
          </button>
        </div>

        {/* Feature Cards */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 20, maxWidth: 600, margin: '0 auto',
        }}>
          {[
            {
              icon: (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              ),
              title: 'Token 保护',
              desc: '一服务一 Token，只有持有 Token 的人才能开启服务，安全可控。',
            },
            {
              icon: (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              ),
              title: '极速传输',
              desc: '同局域网内直接传输，不经过外网服务器，速度拉满。',
            },
            {
              icon: (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="1.5"/></svg>
              ),
              title: '4 位码加入',
              desc: '输入 4 位数字码即可加入服务，简单快捷，无需注册。',
            },
          ].map(({ icon, title, desc }) => (
            <div key={title} style={{
              textAlign: 'center',
              padding: '24px 16px',
              borderRadius: 12,
              background: '#f9fafb',
              border: '1px solid var(--border)',
            }}>
              <div style={{ color: 'var(--accent)', marginBottom: 12, display: 'inline-flex' }}>
                {icon}
              </div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{title}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div style={{
          maxWidth: 500, margin: '56px auto 0',
          padding: '28px 24px', borderRadius: 12,
          background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
          border: '1px solid #bfdbfe',
          textAlign: 'left',
        }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, textAlign: 'center' }}>
            三步开始
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { step: '1', text: '点击「开启服务」，选择要共享的文件夹，设置 4 位数字码' },
              { step: '2', text: '告诉局域网内的同事 / 朋友 4 位数字码' },
              { step: '3', text: '对方点击「加入服务」，输入数字码和昵称，即可浏览和下载文件' },
            ].map(({ step, text }) => (
              <div key={step} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: 'var(--accent)', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 1,
                }}>
                  {step}
                </span>
                <span style={{ fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {showJoin && <JoinModal onClose={() => setShowJoin(false)} />}
      </main>
    </>
  );
}
