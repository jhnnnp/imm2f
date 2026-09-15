import { AppShell } from "@/components/layout/AppShell";
import { InviteManager } from "@/features/auth/components/InviteManager";
import { getAppSession } from "@/features/auth/session";
import { redirect } from "next/navigation";

export default async function InvitePage() {
  const session = await getAppSession();
  if (session.mode === "guest") redirect("/login?next=/invite");
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
