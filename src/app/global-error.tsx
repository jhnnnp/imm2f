"use client";

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: "#f6f3eb", color: "#343b31", fontFamily: "system-ui, sans-serif" }}>
        <main role="alert" style={{ maxWidth: 480, margin: "15vh auto", padding: 24 }}>
          <h1>잠시 문제가 생겼어요</h1>
          <p>다시 불러오면 우리의 공간으로 돌아갈 수 있어요.</p>
          <button type="button" onClick={retry} style={{ padding: "12px 20px", cursor: "pointer" }}>다시 불러오기</button>
        </main>
      </body>
    </html>
  );
}
