import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import { getUser, toPublicUser } from '@/lib/db/queries';
import { SWRConfig } from 'swr';

// 全站读 cookies/session，强制动态渲染，避免生产 PPR 静态壳冲突
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '共桨 CoPaddle · AI 小组协作调度系统',
  description: '让多人协作变成一条可调度、可归因的流水线。'
};

export const viewport: Viewport = {
  maximumScale: 1
};

const manrope = Manrope({ subsets: ['latin'] });

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={manrope.className}
    >
      <head>
        {/* 首屏前应用已存主题，避免深色用户看到白闪 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('copaddle-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})()"
          }}
        />
      </head>
      <body className="min-h-[100dvh] bg-background text-foreground antialiased">
        <SWRConfig
          value={{
            fallback: {
              // 服务端预取的当前用户，客户端组件首次渲染即有数据。
              // 必须过 toPublicUser：这个对象会被序列化进 RSC 载荷。
              '/api/user': getUser().then((u) => (u ? toPublicUser(u) : null))
            }
          }}
        >
          {children}
        </SWRConfig>
      </body>
    </html>
  );
}
