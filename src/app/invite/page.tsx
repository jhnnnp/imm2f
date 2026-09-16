import { AppShell } from "@/components/layout/AppShell";
import { InviteManager } from "@/features/auth/components/InviteManager";
import { getAppSession } from "@/features/auth/session";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function InvitePage() {
  const session = await getAppSession();
  if (session.mode === "guest") redirect("/login?next=/invite");
  if (session.mode !== "authenticated") {
    return (
      <AppShell>
        <div className="page-title-row">
          <div>
            <span className="eyebrow">TOGETHER</span>
            <h1>파트너 초대</h1>
            <p>계정을 만든 뒤 초대 링크를 전하면 둘이 같은 공간을 사용할 수 있어요.</p>
          </div>
        </div>
        <article className="paper-card invite-connected">
          <span className="eyebrow">START TOGETHER</span>
          <h2>먼저 내 공간을 만들어 주세요</h2>
          <p>로그인한 사용자에게만 안전한 일회용 초대 링크를 만들어요.</p>
          <div className="invite-link-row">
            <Link className="primary-button auth-button-link" href="/signup">공간 만들기</Link>
            <Link className="outline-button auth-button-link" href="/login?next=/invite">로그인</Link>
          </div>
        </article>
      </AppShell>
    );
  }
  if (session.mode === "authenticated" && session.partner) {
    return (
      <AppShell>
        <div className="page-title-row">
          <div>
            <span className="eyebrow">TOGETHER</span>
            <h1>이미 연결되어 있어요</h1>
            <p>{session.displayName}와 {session.partner.displayName}의 공간입니다. 장소·일정·추억이 같은 화면에서 쌓여요.</p>
          </div>
        </div>
        <article className="paper-card invite-connected">
          <span className="eyebrow">COUPLE</span>
          <h2>{session.displayName} &amp; {session.partner.displayName}</h2>
          <p>초대 링크는 이제 필요 없어요. 둘 중 한 명이 바꾼 내용이 바로 이 공간에 남습니다.</p>
        </article>
      </AppShell>
    );
  }
  return (
    <AppShell>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">TOGETHER</span>
          <h1>파트너 초대</h1>
          <p>링크를 전하면 같은 공간에서 장소를 함께 모을 수 있어요.</p>
        </div>
      </div>
      <InviteManager />
    </AppShell>
  );
}
