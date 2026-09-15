import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { ReactNode } from "react";

export function AuthScreen({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer?: ReactNode }) {
  const configured = isSupabaseConfigured();
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="auth-brand"><span>✦</span> ONLY US</p>
        <h1>{title}</h1>
        <p className="auth-lead">{description}</p>
        {!configured && (
          <div className="inline-notice auth-setup" role="status">
            .env.local에 Supabase URL과 키를 넣고, SQL 마이그레이션을 실행하면 로그인이 열려요.
          </div>
        )}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
        {!configured && <p className="auth-footnote"><Link href="/">환경 변수 없이 프로토타입 둘러보기</Link></p>}
      </section>
    </main>
  );
}
