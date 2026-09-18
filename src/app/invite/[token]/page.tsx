import Link from "next/link";
import { AuthScreen } from "@/features/auth/components/AuthScreen";
import { InviteAccept } from "@/features/auth/components/InviteAccept";
import { getAppSession, getInvitePreview, isOwnCoupleInvite } from "@/features/auth/session";
import { withAndParticle } from "@/features/auth/koreanName";

export default async function InviteTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, session] = await Promise.all([getInvitePreview(token), getAppSession()]);

  if (!preview.valid) {
    return (
      <AuthScreen title="이 초대는 닫혔어요" description="링크가 만료되었거나 이미 사용된 초대예요." footer={<p><Link href="/">홈으로</Link></p>}>
        <p className="form-hint">새로운 링크를 요청해 주세요.</p>
      </AuthScreen>
    );
  }

  if (session.mode === "authenticated" && session.partner) {
    return (
      <AuthScreen title="이미 연결된 공간이 있어요" description="한 계정은 하나의 커플 공간에만 속할 수 있어요." footer={<p><Link href="/">홈으로</Link></p>}>
        <p className="form-hint">{session.displayName}님은 이미 {withAndParticle(session.partner.displayName)} 연결되어 있어요.</p>
      </AuthScreen>
    );
  }

  if (session.mode === "authenticated" && await isOwnCoupleInvite(token, session.userId)) {
    return (
      <AuthScreen title="이 링크는 내가 만든 초대예요" description="파트너가 이 링크를 열어야 같은 공간이 연결돼요." footer={<p><Link href="/invite">초대 화면으로</Link></p>}>
        <p className="form-hint">링크를 복사해 파트너에게 전해 주세요. 내가 수락할 수는 없어요.</p>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="우리의 공간으로 초대받았어요" description="같은 장소 기록, 같은 계획을 나누게 됩니다.">
      <InviteAccept token={token} inviterName={preview.inviterName} signedIn={session.mode === "authenticated"} />
    </AuthScreen>
  );
}
