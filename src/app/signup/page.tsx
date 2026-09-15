import type { Metadata } from "next";
import Link from "next/link";
import { AuthScreen } from "@/features/auth/components/AuthScreen";
import { SignupForm } from "@/features/auth/components/SignupForm";

export const metadata: Metadata = { title: "가입" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const params = await searchParams;
  const inviteToken = params.invite?.trim();
  return (
    <AuthScreen
      title={inviteToken ? "초대를 받아 공간을 연결해요" : "둘의 공간을 만들어요"}
      description={inviteToken ? "가입하면 초대한 사람과 같은 공간에 들어가요." : "이메일로 계정을 만들고, 파트너를 초대해 주세요."}
      footer={<p>이미 있나요? <Link href="/login">로그인</Link></p>}
    >
      <SignupForm inviteToken={inviteToken} />
    </AuthScreen>
  );
}
