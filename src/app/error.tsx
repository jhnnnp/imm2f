"use client";

import Link from "next/link";

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <section className="empty-soft" role="alert">
      <h1>화면을 불러오지 못했어요</h1>
      <p>잠시 연결이 끊겼을 수 있어요. 다시 불러와 주세요.</p>
      <div className="dialog-actions">
        <button className="primary-button" type="button" onClick={retry}>다시 불러오기</button>
        <Link className="outline-button" href="/">홈으로 이동</Link>
      </div>
    </section>
  );
}
