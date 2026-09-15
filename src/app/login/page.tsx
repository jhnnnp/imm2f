import type { Metadata } from "next";
import Link from "next/link";
import { AuthScreen } from "@/features/auth/components/AuthScreen";
import { LoginForm } from "@/features/auth/components/LoginForm";

export const metadata: Metadata = { title: "로그인" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const nextPath = params.next?.startsWith("/") ? params.next : "/";
  return (
    <AuthScreen title="다시, 우리만의 공간으로" description="둘만 들어갈 수 있는 기록 공간이에요." footer={<p>처음인가요? <Link href="/signup">공간 만들기</Link></p>}>
      <LoginForm nextPath={nextPath} />
    </AuthScreen>
  );
}
