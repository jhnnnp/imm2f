import type { Metadata } from "next";
import Link from "next/link";
import { AuthScreen } from "@/features/auth/components/AuthScreen";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { inviteTokenFromPath, signupHrefForInvite } from "@/features/auth/invitePath";

export const metadata: Metadata = { title: "로그인" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const nextPath = params.next?.startsWith("/") && !params.next.startsWith("//") ? params.next : "/";
  const inviteToken = inviteTokenFromPath(nextPath);
  return (
    <AuthScreen
      title="다시, 우리만의 공간으로"
      description={inviteToken ? "로그인하면 초대한 사람과 같은 공간으로 바로 연결돼요." : "우리만 들어갈 수 있는 기록 공간이에요."}
      footer={<p>처음인가요? <Link href={signupHrefForInvite(inviteToken)}>공간 만들기</Link></p>}
    >
      <LoginForm nextPath={nextPath} />
    </AuthScreen>
  );
}
